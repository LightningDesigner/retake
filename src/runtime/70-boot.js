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

const pending = shell && shell.take()

if (pending) {
  rec = JSON.parse(pending.rec)
  // Web storage goes back to how it was when the history began.
  restoreStorage(real.local, rec.storage.local)
  restoreStorage(real.session, rec.storage.session)
  clock.rate = pending.rate || 1
} else {
  rec = newRecording()
  // Nothing shows on the timeline until Record is pressed.
  rec.start = null
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
  version: "0.2.0",
  now: () => clock.now,
  record,
  pause,
  preview,
  endPreview,
  seek: (t, andPlay) => rec.start != null && seek(Math.max(t, rec.start), andPlay ? play : undefined),
  // Start a new branch at this moment, even if nothing lies ahead yet.
  forkHere() {
    if (hasFuture()) return fork()
    if (shell && rec.start != null) shell.branchOff(JSON.stringify(rec), rec.end, clock.now)
  },
  setRate,
  history: () => rec,
  activity,
  // Jump into another branch's history (a JSON string from history()).
  load: (json, t) => rewind(t, false, json),
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

function boot() {
  observe()
  if (shell) shell.attach(PT)
  if (shell) W.addEventListener("blur", () => shell.meta(false))
  // Let the first render settle on real frames before time starts moving.
  real.raf(() =>
    real.raf(() => {
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
