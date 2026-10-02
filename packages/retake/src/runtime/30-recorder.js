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

// ---- frames take turns with the origin's storage ------------------------------------
// The visible frame, a frame being built behind it and a checkpoint all share
// the origin's web storage and cookies, and a frame that boots puts them back
// to its own segment's start. So whichever frame last ran app code "owns" them
// (shell.storageOwner): a frame keeps a copy of its own when it stops running
// app code, and puts that copy back before it runs app code again if another
// frame took over meanwhile. IndexedDB can't be put back synchronously: a frame
// of an app that uses it reports storageOk false, and the dock rebuilds rather
// than resume it.
const storageId = real.random()
let ownStorage = null
let idbOpened = false
function keepStorage() {
  if (shell && shell.storageOwner !== storageId) return
  ownStorage = { local: snapshotStorage(real.local), session: snapshotStorage(real.session), cookies: snapshotCookies() }
}
function takeStorage() {
  if (!shell || shell.storageOwner === storageId) return
  if (ownStorage) {
    restoreStorage(real.local, ownStorage.local)
    restoreStorage(real.session, ownStorage.session)
    restoreCookies(ownStorage.cookies)
  }
  shell.storageOwner = storageId
}
const usesIDB = () => idbOpened || segmentsOf().some((s) => s.idb && s.idb.length > 0)
const storageOk = () => !shell || shell.storageOwner === storageId || !usesIDB()

function newRecording() {
  return withPacking({
    v: 1,
    url: location.href,
    seed: Math.floor(real.random() * 2 ** 32),
    epoch: real.Date.now(),
    storage: { local: snapshotStorage(real.local), session: snapshotStorage(real.session) },
    // Replays run in a frame of this size, so layout matches (F18).
    viewport: { w: W.innerWidth, h: W.innerHeight },
    // Element paths start at an id and skip scripts (F51; see pathOf).
    pathV: 2,
    // The front server's kept copy of this page (F56; RT.docId).
    ...(RT.docId ? { doc: RT.docId } : {}),
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
// A packer keeps the tables, so events can be packed a slice at a time.
function packer(r) {
  const tables = { paths: [], strs: [] }
  const idx = { paths: new Map(), strs: new Map() }
  const ref = (kind, v) => {
    if (v == null) return v
    const key = typeof v === "string" ? v : Array.isArray(v) ? v.join(",") : "=" + v
    let i = idx[kind].get(key)
    if (i == null) {
      i = tables[kind].length
      tables[kind].push(v)
      idx[kind].set(key, i)
    }
    return i
  }
  // An event's time is usually exactly a frame boundary: store the frame's index.
  const frameAt = new Map()
  r.frames.forEach((f, i) => frameAt.set(f, i))
  let lastF = 0
  return {
    event(ev) {
      const out = { ...ev }
      out.y = ref("strs", out.type)
      delete out.type
      if ("path" in out) (out.p = ref("paths", out.path)), delete out.path
      if ("related" in out) (out.rp = ref("paths", out.related)), delete out.related
      if (out.css != null) (out.c = ref("strs", out.css)), delete out.css
      const fi = frameAt.get(out.t)
      if (fi != null) {
        out.f = fi - lastF
        lastF = fi
        delete out.t
      }
      return out
    },
    clip(c) {
      const out = { ...c }
      if (out.selector != null) (out.s = ref("strs", out.selector)), delete out.selector
      if (out.component != null) (out.co = ref("strs", out.component)), delete out.component
      if (out.label != null) (out.l = ref("strs", out.label)), delete out.label
      if (out.path != null) (out.p = ref("paths", out.path)), delete out.path
      return out
    },
    // Everything but the events, with the tables as they stand.
    head(events) {
      const out = {}
      for (const k of Object.keys(r)) out[k] = r[k]
      out.v = 3
      out.events = events
      if (r.clips) out.clips = r.clips.map((c) => this.clip(c))
      out.paths = tables.paths
      out.strs = tables.strs
      return out
    },
  }
}
function packRec(r) {
  const pk = packer(r)
  const events = r.events.map((ev) => pk.event(ev))
  return pk.head(events)
}
function unpackRec(o) {
  if (o && o.v === 2 && o.paths) {
    // v2: paths table only
    const table = o.paths
    o.events = o.events.map((ev) => {
      const out = { ...ev }
      if ("p" in out) (out.path = table[out.p]), delete out.p
      if ("rp" in out) (out.related = table[out.rp]), delete out.rp
      return out
    })
    delete o.paths
    o.v = 1
  } else if (o && o.v === 3) {
    const P = o.paths
    const S = o.strs
    let lastF = 0
    o.events = o.events.map((ev) => {
      const out = { ...ev }
      out.type = S[out.y]
      delete out.y
      if ("p" in out) (out.path = P[out.p]), delete out.p
      if ("rp" in out) (out.related = P[out.rp]), delete out.rp
      if ("c" in out) (out.css = S[out.c]), delete out.c
      if ("f" in out) {
        lastF += out.f
        out.t = o.frames[lastF]
        delete out.f
      }
      return out
    })
    if (o.clips) {
      o.clips = o.clips.map((c) => {
        const out = { ...c }
        if ("s" in out) (out.selector = S[out.s]), delete out.s
        if ("co" in out) (out.component = S[out.co]), delete out.co
        if ("l" in out) (out.label = S[out.l]), delete out.l
        if ("p" in out) (out.path = P[out.p]), delete out.p
        return out
      })
    }
    delete o.paths
    delete o.strs
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
  const first = { t: 0, ev: 0, fr: 0, url: r.url, storage: r.storage, cookies: r.cookies, idb: r.idb, seed: r.seed, doc: r.doc, docDebug: r.docDebug }
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

// The frame boundary whose recorded input (live, or replayed) is being handled:
// the DOM changes that follow are logged just after it (see logMutations).
// Moves, hovers, wheel and scroll don't count: they come every frame while the
// pointer moves, in between the frame's own work, which would be logged late.
let inputAt = null
const CONTINUOUS = /^(pointermove|mousemove|pointerover|pointerout|pointerenter|pointerleave|mouseover|mouseout|mouseenter|mouseleave|wheel|scroll|touchmove)$/
const markInput = (ev) => {
  if (!CONTINUOUS.test(ev.type)) inputAt = clock.now
}

function recordEvent(ev) {
  if (hasFuture()) return
  ev.t = clock.now
  markInput(ev)
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
