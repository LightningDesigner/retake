// Boot. The prototype runs inside the dock's frame; `shell` is the dock in the
// parent window. A rewind leaves the history with the shell and reloads this
// frame, so on boot we either pick that up or begin a fresh history.

const shell = (() => {
  try {
    return W.parent !== W && W.parent.__waybackShell ? W.parent.__waybackShell : null
  } catch {
    return null
  }
})()

// A full reload of this frame (Vite's full-reload after an edit HMR can't
// apply, or the app calling location.reload()) keeps the recording: on the way
// out it's left on the shell object, keyed by our iframe element, and picked
// up here. A frame the dock is replacing (removed from the page) leaves nothing.
function takeResume() {
  try {
    const r = shell && shell.__resume
    if (r && r.frame === W.frameElement) {
      shell.__resume = null
      return r.payload
    }
  } catch {}
  return null
}
const pending = (shell && shell.take()) || takeResume()

// Time doesn't start until state is in place (IndexedDB is async).
let stateReady
if (pending) {
  rec = JSON.parse(pending.rec)
  // Web storage, cookies and IndexedDB go back to how they were when the
  // history began.
  restoreStorage(real.local, rec.storage.local)
  restoreStorage(real.session, rec.storage.session)
  restoreCookies(rec.cookies)
  stateReady = rec.idb != null ? withIDBGate(() => restoreIDB(rec.idb)) : Promise.resolve()
  clock.rate = pending.rate || 1
} else {
  rec = newRecording()
  // Recording is always on from page load (CONTRACT.md).
  rec.start = 0
  rec.cookies = snapshotCookies()
  stateReady = withIDBGate(async () => {
    const snap = await snapshotIDB()
    if (snap) rec.idb = snap // empty too: a replay then clears databases made later
  })
}
epoch = rec.epoch
seedRandom(rec.seed)

// Record starts the timeline, or resumes it from where it last got to.
function record() {
  if (previewing) endPreview()
  // Back in time? Record carries on from the end of this timeline, not here.
  if (hasFuture()) return seek(rec.end, play)
  if (rec.start == null) rec.start = clock.now
  play()
}

Object.assign(PT, {
  version: "0.4.0",
  now: () => clock.now,
  record,
  // Play from here: replays the recorded future, then carries on live.
  play: () => {
    if (previewing) endPreview()
    play()
  },
  pause,
  preview,
  endPreview,
  // Going to a moment ends a live preview first (the dock does this itself,
  // but API and MCP callers shouldn't have to).
  seek: (t, andPlay) => {
    if (rec.start == null) return false
    if (previewing) endPreview()
    return seek(Math.max(t, rec.start), andPlay ? play : undefined)
  },
  // Start a new branch at this moment, even if nothing lies ahead yet.
  // The new timeline starts paused at this moment; recording into it starts
  // when the user presses Play.
  forkHere() {
    pause()
    if (hasFuture()) return fork()
    if (shell && rec.start != null) shell.branchOff(JSON.stringify(rec), rec.end, clock.now)
  },
  isPaused: () => !clock.playing,
  // fn({ playing, now }) whenever play state changes; returns an unsubscribe.
  onPlayState(fn) {
    playListeners.add(fn)
    return () => playListeners.delete(fn)
  },
  setRate,
  history: () => rec,
  activity,
  // Jump into another branch's history (a JSON string from history()).
  load: (json, t) => rewind(t, false, json),
  // Checkpoints: a frame already rebuilt to some moment can take a newer copy
  // of the same recording (one that only grew after that moment) and seek
  // forward in place, instead of a rebuild from zero. Returns false (and
  // changes nothing) if the recording doesn't continue this frame's past.
  adopt(json, t, andPlay) {
    const no = (why) => {
      PT.adoptRefused = why
      return false
    }
    let next
    try {
      next = typeof json === "string" ? JSON.parse(json) : json
    } catch {
      return no("not JSON")
    }
    if (!next || clock.seeking || previewing) return no("busy")
    if (next.seed !== rec.seed || next.epoch !== rec.epoch) return no("a different recording")
    if (next.events.length < cursor.event || next.frames.length < cursor.frame) return no("shorter than this frame's past")
    const same = (a, b) => a === b || (!!a && !!b && a.t === b.t && a.type === b.type)
    for (let i = Math.max(0, cursor.event - 64); i < cursor.event; i++) if (!same(next.events[i], rec.events[i])) return no(`event ${i} differs`)
    if (cursor.frame && next.frames[cursor.frame - 1] !== rec.frames[cursor.frame - 1]) return no("frames differ")
    if (t < clock.now) return no("that moment is behind this frame")
    PT.adoptRefused = null
    rec = next
    seek(t, andPlay ? play : undefined)
    PT.emit()
    return true
  },
  state: () => ({
    recording: rec.start != null && clock.playing,
    booted: clock.booted,
    started: rec.start != null,
    previewing,
    previewAt,
    start: rec.start ?? 0,
    now: clock.now,
    end: Math.max(rec.end, clock.now),
    target: seekTarget,
    playing: clock.playing,
    seeking: clock.seeking,
    rate: clock.rate,
    future: hasFuture(),
  }),
  timeline,
  clipAt,
  isInteractive,
  setToolActive,
  debug: () => ({
    ...stats,
    appMessages,
    timers: timers.size,
    dom: domLog.length,
    anims: animLog.map((e) => ({ target: e.target.id || e.target.getAttribute("class"), vStart: Math.round(e.vStart), vEnd: e.vEnd && Math.round(e.vEnd), state: stateOf(e.anim), kf: e.keyframes.length, fill: e.timing.fill })),
  }),
})

// Alt+P record/pause while focus is inside the prototype.
PT.shortcut = function (e) {
  if (!e.altKey || e.metaKey || e.ctrlKey || e.code !== "KeyP") return false
  e.preventDefault()
  e.stopImmediatePropagation()
  if (e.type === "keydown" && !e.repeat) clock.playing && rec.start != null ? pause() : record()
  return true
}

// A reload (or navigation) fires beforeunload first; a frame the dock removes
// doesn't. Only a reload leaves its recording on the shell to resume.
let unloading = false
W.addEventListener("beforeunload", () => (unloading = true))
W.addEventListener("pagehide", () => {
  try {
    if (!unloading || !shell || !rec || rec.start == null || clock.seeking) return
    const el = W.frameElement
    if (!el || !el.isConnected) return
    rec.reloads = [...(rec.reloads || []), clock.now]
    shell.__resume = { frame: el, payload: { rec: JSON.stringify(rec), target: clock.now, play: clock.playing, rate: clock.rate, reloaded: true } }
  } catch {}
})

function boot() {
  observe()
  if (shell) shell.attach(PT)
  if (shell) W.addEventListener("blur", () => shell.meta && shell.meta(false))
  // Let the first render settle on real frames before time starts moving.
  real.raf(() =>
    real.raf(async () => {
      await stateReady
      clock.booted = true
      if (pending) {
        seekTarget = pending.target
        afterSeek = pending.play ? play : null
      } else {
        play()
      }
    }),
  )
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true })
else boot()
drive()
