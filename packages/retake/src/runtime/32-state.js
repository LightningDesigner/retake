// State that outlives a reload besides web storage: cookies and IndexedDB.
// A recording snapshots both when it starts; a rebuild puts them back before
// the app can read them, so a replay starts from the same place.
//
// IndexedDB also answers in real time, so outstanding IndexedDB work counts as
// "the app is busy" (see settle() in 00-core): time only moves on once it's
// done, while recording and while replaying alike.

// ---- cookies ---------------------------------------------------------------------

// (Retake's own cookies, `__retake…`, aren't the app's.)
const ownCookie = (part) => /^\s*__retake/.test(part)
function snapshotCookies() {
  try {
    return document.cookie
      .split(";")
      .filter((p) => p.trim() && !ownCookie(p))
      .join(";")
      .trim()
  } catch {
    return ""
  }
}

function restoreCookies(snap) {
  if (snap == null) return
  try {
    const expire = "=; expires=Thu, 01 Jan 1970 00:00:00 GMT"
    const paths = ["/", location.pathname.replace(/[^/]*$/, "") || "/"]
    for (const part of document.cookie.split(";")) {
      const name = part.split("=")[0].trim()
      if (!name || ownCookie(part)) continue
      for (const p of paths) document.cookie = `${name}${expire}; path=${p}`
      document.cookie = `${name}${expire}`
    }
    for (const part of snap.split(";")) {
      const s = part.trim()
      if (s) document.cookie = `${s}; path=/`
    }
  } catch {}
}

// ---- values that survive JSON --------------------------------------------------------

function encodeValue(v) {
  if (v === undefined) return { $u: 1 }
  if (v === null || typeof v === "boolean" || typeof v === "string") return v
  if (typeof v === "number") return Number.isFinite(v) ? v : { $n: String(v) }
  if (typeof v === "bigint") return { $bi: String(v) }
  if (v instanceof Date) return { $d: v.getTime() }
  if (v instanceof ArrayBuffer) return { $ab: toB64(new Uint8Array(v)) }
  if (ArrayBuffer.isView(v)) return { $ta: v.constructor.name, b: toB64(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)) }
  if (v instanceof Map) return { $map: [...v].map(([k, x]) => [encodeValue(k), encodeValue(x)]) }
  if (v instanceof Set) return { $set: [...v].map(encodeValue) }
  if (Array.isArray(v)) return v.map(encodeValue)
  if (typeof Blob !== "undefined" && v instanceof Blob) throw new Error("blobs in IndexedDB aren't snapshotted")
  const out = {}
  for (const k of Object.keys(v)) out[k] = encodeValue(v[k])
  return Object.keys(out).some((k) => k.startsWith("$")) ? { $o: out } : out
}

function decodeValue(v) {
  if (v === null || typeof v !== "object") return v
  if (Array.isArray(v)) return v.map(decodeValue)
  if ("$u" in v) return undefined
  if ("$n" in v) return Number(v.$n)
  if ("$bi" in v) return BigInt(v.$bi)
  if ("$d" in v) return new Date(v.$d)
  if ("$ab" in v) return fromB64(v.$ab).buffer
  if ("$ta" in v) {
    const bytes = fromB64(v.b)
    const C = W[v.$ta] || Uint8Array
    return new C(bytes.buffer, 0, bytes.byteLength / (C.BYTES_PER_ELEMENT || 1))
  }
  if ("$map" in v) return new Map(v.$map.map(([k, x]) => [decodeValue(k), decodeValue(x)]))
  if ("$set" in v) return new Set(v.$set.map(decodeValue))
  const src = "$o" in v ? v.$o : v
  const out = {}
  for (const k of Object.keys(src)) out[k] = decodeValue(src[k])
  return out
}

// ---- IndexedDB -------------------------------------------------------------------------

const idbF = W.indexedDB
const IDBF = W.IDBFactory && IDBFactory.prototype
const realOpen = IDBF && IDBF.open
const realDelete = IDBF && IDBF.deleteDatabase
let idbBusy = 0 // open requests + live transactions
// Dev tools' own databases (Next 16 keeps its debug channel in one) aren't the
// app's state: not snapshotted, restored or waited for.
const DEV_DB = /^__next/
const devDb = (name) => DEV_DB.test(String(name || ""))
let idbGate = null // while snapshotting/restoring, the app's opens wait here

// A request still blocked (another tab holding the database) after 3s gives up.
const promisify = (req) =>
  new Promise((resolve, reject) => {
    let timer = null
    req.onsuccess = () => {
      real.clearTimeout(timer)
      resolve(req.result)
    }
    req.onerror = () => {
      real.clearTimeout(timer)
      reject(req.error)
    }
    req.onblocked = () => {
      timer = real.setTimeout(() => reject(new Error("IndexedDB is held open elsewhere (another tab?)")), 3000)
    }
  })

async function snapshotIDB() {
  if (!idbF || !idbF.databases) return null
  const list = await idbF.databases()
  const out = []
  for (const info of list) {
    if (!info.name || devDb(info.name)) continue
    const db = await promisify(realOpen.call(idbF, info.name))
    try {
      const names = [...db.objectStoreNames]
      const stores = []
      if (names.length) {
        const tx = db.transaction(names, "readonly")
        for (const name of names) {
          const st = tx.objectStore(name)
          const meta = {
            name,
            keyPath: st.keyPath,
            autoIncrement: st.autoIncrement,
            indexes: [...st.indexNames].map((n) => {
              const ix = st.index(n)
              return { name: n, keyPath: ix.keyPath, unique: ix.unique, multiEntry: ix.multiEntry }
            }),
            records: [],
          }
          await new Promise((resolve, reject) => {
            const cur = st.openCursor()
            cur.onsuccess = () => {
              const c = cur.result
              if (!c) return resolve(undefined)
              meta.records.push([encodeValue(c.primaryKey), encodeValue(c.value)])
              c.continue()
            }
            cur.onerror = () => reject(cur.error)
          })
          stores.push(meta)
        }
      }
      out.push({ name: info.name, version: db.version, stores })
    } finally {
      db.close()
    }
  }
  return out
}

async function restoreIDB(snap) {
  if (!idbF || !snap) return
  const keep = new Set(snap.map((d) => d.name))
  if (idbF.databases) {
    for (const info of await idbF.databases()) {
      if (info.name && !keep.has(info.name) && !devDb(info.name)) await promisify(realDelete.call(idbF, info.name)).catch(() => {})
    }
  }
  for (const d of snap) {
    await promisify(realDelete.call(idbF, d.name)).catch(() => {})
    const req = realOpen.call(idbF, d.name, d.version)
    req.onupgradeneeded = () => {
      const db = req.result
      for (const s of d.stores) {
        const st = db.createObjectStore(s.name, { keyPath: s.keyPath, autoIncrement: s.autoIncrement })
        for (const ix of s.indexes) st.createIndex(ix.name, ix.keyPath, { unique: ix.unique, multiEntry: ix.multiEntry })
      }
    }
    const db = await promisify(req)
    try {
      const names = d.stores.map((s) => s.name)
      if (names.length) {
        await new Promise((resolve, reject) => {
          const tx = db.transaction(names, "readwrite")
          for (const s of d.stores) {
            const st = tx.objectStore(s.name)
            for (const [k, v] of s.records) (s.keyPath == null ? st.put(decodeValue(v), decodeValue(k)) : st.put(decodeValue(v)))
          }
          tx.oncomplete = resolve
          tx.onerror = () => reject(tx.error)
          tx.onabort = () => reject(tx.error)
        })
      }
    } finally {
      db.close()
    }
  }
}

// An open request that starts once the gate lifts. It is a real EventTarget
// dressed as an IDBOpenDBRequest (so `instanceof IDBRequest` holds), relaying
// the real request's events.
function deferredOpen(start) {
  idbBusy++
  let counted = true
  const uncount = () => {
    if (counted) idbBusy--
    counted = false
  }
  const fake = new EventTarget()
  Object.setPrototypeOf(fake, IDBOpenDBRequest.prototype)
  const props = { result: undefined, error: null, readyState: "pending", source: null, transaction: null }
  for (const k of Object.keys(props)) Object.defineProperty(fake, k, { get: () => props[k], configurable: true })
  const handlers = {}
  for (const type of ["success", "error", "upgradeneeded", "blocked"]) {
    Object.defineProperty(fake, "on" + type, { get: () => handlers[type] || null, set: (fn) => (handlers[type] = fn), configurable: true })
    EventTarget.prototype.addEventListener.call(fake, type, (e) => handlers[type] && handlers[type].call(fake, e))
  }
  idbGate.then(() => {
    const req = start()
    for (const type of ["success", "error", "upgradeneeded", "blocked"]) {
      req.addEventListener(type, (e) => {
        props.readyState = req.readyState
        try {
          props.result = req.result
        } catch {}
        props.error = req.readyState === "done" ? req.error : null
        props.transaction = req.transaction
        const ev = type === "upgradeneeded" || type === "blocked" ? new IDBVersionChangeEvent(type, { oldVersion: e.oldVersion, newVersion: e.newVersion }) : new Event(type, { cancelable: type === "error", bubbles: type === "error" })
        if (type !== "upgradeneeded") uncount()
        EventTarget.prototype.dispatchEvent.call(fake, ev)
        if (ev.defaultPrevented) e.preventDefault()
      })
    }
  })
  return fake
}

// A frame being replaced by a rebuild lets go of its databases when the new
// frame asks to reset them (otherwise the reset waits on this frame forever).
function releaseOnRebuild(req) {
  req.addEventListener("success", () => {
    const db = req.result
    if (db && db.addEventListener) {
      db.addEventListener("versionchange", () => {
        try {
          if (shell && shell.rebuilding) db.close()
        } catch {}
      })
    }
  })
  return req
}

function trackOpen(req) {
  releaseOnRebuild(req)
  idbBusy++
  let done = false
  const end = () => {
    if (!done) idbBusy--
    done = true
  }
  req.addEventListener("success", end)
  req.addEventListener("error", end)
  req.addEventListener("blocked", end)
  return req
}

if (IDBF) {
  IDBF.open = function (...args) {
    if (isExempt() || devDb(args[0])) return realOpen.apply(this, args)
    idbOpened = true // this app keeps state in IndexedDB (see storageOk in 30-recorder)
    if (idbGate) return deferredOpen(() => trackOpen(realOpen.apply(idbF, args)))
    return trackOpen(realOpen.apply(this, args))
  }
  IDBF.deleteDatabase = function (...args) {
    if (idbGate) return deferredOpen(() => trackOpen(realDelete.apply(idbF, args)))
    return trackOpen(realDelete.apply(this, args))
  }
  const realTx = IDBDatabase.prototype.transaction
  IDBDatabase.prototype.transaction = function (...args) {
    const tx = realTx.apply(this, args)
    idbBusy++
    let done = false
    const end = () => {
      if (!done) idbBusy--
      done = true
    }
    tx.addEventListener("complete", end)
    tx.addEventListener("abort", end)
    tx.addEventListener("error", end)
    return tx
  }
}

// Run `work` (a snapshot or a restore) with the app's IndexedDB opens held.
function withIDBGate(work) {
  if (!IDBF) return Promise.resolve()
  let lift
  idbGate = new Promise((r) => (lift = r))
  const gate = idbGate
  return work()
    .catch((err) => console.warn("[retake] IndexedDB snapshot/restore failed:", err && err.message))
    .finally(() => {
      if (idbGate === gate) idbGate = null
      lift()
    })
}

// Service workers keep their own caches and answer requests outside the
// recording; say so once.
try {
  if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
    navigator.serviceWorker.getRegistrations().then((regs) => {
      if (regs.length) console.warn("[retake] this page has a service worker; responses it serves from its cache aren't rewound (Cache API isn't snapshotted)")
    })
  }
} catch {}
