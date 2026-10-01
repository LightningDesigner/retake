// The recording: everything needed to rebuild the page at any moment by
// reloading and replaying — input events, fetch responses, the frame times the
// clock advanced through, the random seed, Date epoch and web storage.

function snapshotStorage(store) {
  const out = {}
  try {
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i)
      if (!k.startsWith(KEY)) out[k] = store.getItem(k)
    }
  } catch {}
  return out
}

function restoreStorage(store, snap) {
  try {
    for (let i = store.length - 1; i >= 0; i--) {
      const k = store.key(i)
      if (!k.startsWith(KEY)) store.removeItem(k)
    }
    for (const k in snap) store.setItem(k, snap[k])
  } catch {}
}

function newRecording() {
  return withPacking({
    v: 1,
    url: location.href,
    seed: Math.floor(real.random() * 2 ** 32),
    epoch: real.Date.now(),
    storage: { local: snapshotStorage(real.local), session: snapshotStorage(real.session) },
    // Replays run in a frame of this size, so layout matches (F18).
    viewport: { w: W.innerWidth, h: W.innerHeight },
    frames: [],
    events: [],
    fetches: [],
    end: 0,
  })
}

let rec = null
const cursor = { event: 0, frame: 0 }

// ---- compact serialisation ----------------------------------------------------------
// JSON.stringify(rec) writes a compact form (v: 2): every DOM path is stored
// once in a table and events refer to it by index, which on a deep DOM
// halves the size. readRec() takes either form back. The in-memory object
// (history()) keeps plain paths.
function packRec(r) {
  const table = []
  const index = new Map()
  const ref = (path) => {
    if (path == null) return path
    const key = Array.isArray(path) ? path.join(",") : "=" + path
    let i = index.get(key)
    if (i == null) {
      i = table.length
      table.push(path)
      index.set(key, i)
    }
    return i
  }
  const events = r.events.map((ev) => {
    if (ev.path === undefined && ev.related === undefined) return ev
    const out = { ...ev }
    if ("path" in out) {
      out.p = ref(out.path)
      delete out.path
    }
    if ("related" in out) {
      out.rp = ref(out.related)
      delete out.related
    }
    return out
  })
  const out = {}
  for (const k of Object.keys(r)) out[k] = r[k]
  out.v = 2
  out.events = events
  out.paths = table
  return out
}
function unpackRec(o) {
  if (o && o.v === 2 && o.paths) {
    const table = o.paths
    o.events = o.events.map((ev) => {
      if (ev.p === undefined && ev.rp === undefined) return ev
      const out = { ...ev }
      if ("p" in out) {
        out.path = table[out.p]
        delete out.p
      }
      if ("rp" in out) {
        out.related = table[out.rp]
        delete out.rp
      }
      return out
    })
    delete o.paths
    o.v = 1
  }
  return withPacking(o)
}
function withPacking(o) {
  if (o && typeof o === "object" && !Object.prototype.hasOwnProperty.call(o, "toJSON")) {
    Object.defineProperty(o, "toJSON", { value: function () { return packRec(this) }, enumerable: false, configurable: true })
  }
  return o
}
const readRec = (json) => unpackRec(typeof json === "string" ? JSON.parse(json) : json)

// Segments: a recording starts one on load, and another each time the app
// reloads itself. A moment is rebuilt from the start of its segment: that
// segment's URL, storage and seed, replaying only what came after it.
function segmentsOf(r = rec) {
  const first = { t: 0, ev: 0, fr: 0, url: r.url, storage: r.storage, cookies: r.cookies, idb: r.idb, seed: r.seed }
  return [first, ...(r.segments || [])]
}
function segmentIndex(t, r = rec) {
  if (typeof r === "string") r = readRec(r)
  let i = 0
  for (const s of r.segments || []) if (s.t <= t) i++
  return i
}
function segmentAt(t, r = rec) {
  return segmentsOf(r)[segmentIndex(t, r)]
}
// Does this page already show that URL (ignoring our own __wb parameter)?
function sameDocUrl(url) {
  try {
    const a = new URL(url, location.href)
    const b = new URL(location.href)
    for (const u of [a, b]) u.searchParams.delete("__wb")
    return a.origin === b.origin && a.pathname === b.pathname && a.search === b.search
  } catch {
    return true
  }
}

const hasFuture = () =>
  !!rec && (cursor.event < rec.events.length || cursor.frame < rec.frames.length)

// New input after going back starts a new future. The old one isn't lost: the
// dock keeps it as its own branch before we cut it off here.
function fork() {
  if (!hasFuture()) return
  if (shell && rec.start != null) shell.branchOff(JSON.stringify(rec), rec.end, clock.now)
  const cut = rec.events.slice(cursor.event)
  rec.events.length = cursor.event
  rec.frames.length = cursor.frame
  if (rec.routes) rec.routes = rec.routes.filter((r) => r.t <= clock.now)
  if (rec.reloads) rec.reloads = rec.reloads.filter((t) => t <= clock.now)
  if (rec.segments) rec.segments = rec.segments.filter((sg) => sg.t <= clock.now)
  if (rec.clips) rec.clips = rec.clips.filter((c) => c.start <= clock.now)
  cutActivity(clock.now)
  netFork(cut)
  rec.end = clock.now
  PT.emit()
}

function recordEvent(ev) {
  if (hasFuture()) return
  ev.t = clock.now
  const last = rec.events[rec.events.length - 1]
  // Collapse pointer moves within one frame; only the latest position matters.
  if (ev.type === "pointermove" && last && last.type === "pointermove" && last.t === ev.t && last.path + "" === ev.path + "") {
    rec.events[rec.events.length - 1] = ev
  } else {
    rec.events.push(ev)
  }
  cursor.event = rec.events.length
}

function recordFrame(t) {
  if (!hasFuture() && t > (rec.frames[rec.frames.length - 1] ?? -1)) {
    rec.frames.push(t)
    cursor.frame = rec.frames.length
  }
  if (t > rec.end) rec.end = t
}

// ---- other real-time promises (e.g. media.play()) ----------------------------
// Their outcome and the moment they settle are recorded, keyed by call order,
// and replayed identically.

let asyncSeq = 0
const pendingAsync = new Map()
const settledEarly = new Map()

function recordedAsync(realCall) {
  const i = asyncSeq++
  const replayable = hasFuture() && rec.events.some((e, j) => j >= cursor.event && e.type === "async" && e.i === i)
  if (replayable) {
    if (settledEarly.has(i)) return asyncOutcome(settledEarly.get(i))
    return new Promise((resolve, reject) => pendingAsync.set(i, { resolve, reject }))
  }
  if (hasFuture() || (rec.start != null && !clock.playing)) return realCall()
  return realCall().then(
    (value) => {
      recordEvent({ type: "async", i, ok: true })
      return value
    },
    (err) => {
      recordEvent({ type: "async", i, ok: false, name: err && err.name, message: err && err.message })
      throw err
    },
  )
}

function asyncOutcome(ev) {
  return ev.ok ? Promise.resolve() : Promise.reject(new DOMException(ev.message || "", ev.name || "Error"))
}

function settleAsync(ev) {
  const p = pendingAsync.get(ev.i)
  if (!p) return settledEarly.set(ev.i, ev)
  pendingAsync.delete(ev.i)
  asyncOutcome(ev).then(p.resolve, p.reject)
}
