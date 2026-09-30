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
    frames: [],
    events: [],
    fetches: [],
    end: 0,
  }
}

let rec = null
const cursor = { event: 0, frame: 0 }
const usedFetches = new Set()

const hasFuture = () =>
  !!rec && (cursor.event < rec.events.length || cursor.frame < rec.frames.length)

// New input after going back starts a new future. The old one isn't lost: the
// dock keeps it as its own branch before we cut it off here.
function fork() {
  if (!hasFuture()) return
  if (shell && rec.start != null) shell.branchOff(JSON.stringify(rec), rec.end, clock.now)
  rec.events.length = cursor.event
  rec.frames.length = cursor.frame
  rec.fetches = rec.fetches.map((f, i) => (usedFetches.has(i) ? f : null))
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

// ---- fetch ------------------------------------------------------------------

const pendingFetches = new Map() // recording index -> { resolve, reject }
const deliveredEarly = new Set()

function fetchKey(input, init) {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url, location.href)
  const method = ((init && init.method) || (input && input.method) || "GET").toUpperCase()
  return `${method} ${url.origin === location.origin ? url.pathname + url.search : url.href}`
}

function toResponse(f) {
  if (f.error) return Promise.reject(new TypeError(f.error))
  const noBody = [101, 204, 205, 304].includes(f.status)
  return Promise.resolve(
    new Response(noBody ? null : f.body, { status: f.status, statusText: f.statusText, headers: f.headers }),
  )
}

function deliverFetch(i) {
  const p = pendingFetches.get(i)
  if (!p) return deliveredEarly.add(i)
  pendingFetches.delete(i)
  toResponse(rec.fetches[i]).then(p.resolve, p.reject)
}

W.fetch = function (input, init) {
  if (isExempt()) return real.fetch(input, init)
  const key = fetchKey(input, init)
  const i = rec.fetches.findIndex((f, j) => f && f.key === key && !usedFetches.has(j))
  if (i >= 0 && hasFuture()) {
    usedFetches.add(i)
    if (deliveredEarly.delete(i)) return toResponse(rec.fetches[i])
    return new Promise((resolve, reject) => pendingFetches.set(i, { resolve, reject }))
  }
  // Paused (trying things out, unrecorded): just go live.
  if (rec.start != null && !clock.playing) return real.fetch(input, init)
  // Not in the recording (or nothing left to replay): go live and record it.
  fork()
  const idx = rec.fetches.length
  const entry = { key, t0: clock.now }
  rec.fetches.push(entry)
  usedFetches.add(idx)
  return real
    .fetch(input, init)
    .then(async (res) => {
      entry.status = res.status
      entry.statusText = res.statusText
      entry.headers = [...res.headers]
      entry.body = await res.text()
    })
    .catch((err) => {
      entry.error = String((err && err.message) || err)
    })
    .then(() => {
      recordEvent({ type: "fetch", i: idx })
      return toResponse(entry)
    })
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
  if (rec.start != null && !clock.playing) return realCall()
  fork()
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
