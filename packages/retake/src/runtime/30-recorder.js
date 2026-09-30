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
  return {
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
  }
}

let rec = null
const cursor = { event: 0, frame: 0 }

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
  if (rec.clips) rec.clips = rec.clips.filter((c) => c.start <= clock.now)
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
