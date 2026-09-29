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
  // The timeline is visible from the moment it's switched on.
  rec.start = shell && shell.enabled ? 0 : null
}
epoch = rec.epoch
seedRandom(rec.seed)

// Switching off lets the prototype run normally: live, 1×, no alternate future.
function setEnabled(on) {
  if (on && rec.start == null) rec.start = clock.now
  if (!on) {
    rec.start = null
    fork()
    setRate(1)
    play()
  }
  PT.emit()
}

Object.assign(PT, {
  version: "0.2.0",
  now: () => clock.now,
  play,
  pause,
  seek: (t) => rec.start != null && seek(Math.max(t, rec.start)),
  setRate,
  setEnabled,
  mark: (label) => addMarker(label, "app"),
  history: () => rec,
  // Jump into another branch's history (a JSON string from history()).
  load: (json, t) => rewind(t, false, json),
  state: () => ({
    enabled: rec.start != null,
    start: rec.start ?? 0,
    now: clock.now,
    end: Math.max(rec.end, clock.now),
    target: seekTarget,
    playing: clock.playing,
    seeking: clock.seeking,
    rate: clock.rate,
    future: hasFuture(),
    markers: rec.markers,
  }),
  debug: () => ({ ...stats, appMessages, timers: timers.size, anims: managed.size }),
})

const addManualMarker = () => addMarker(`Marker ${rec.markers.filter((m) => m.src === "user").length + 1}`, "user")
PT.addMarker = addManualMarker

// Alt+P play/pause and Alt+M marker, while focus is inside the prototype.
PT.shortcut = function (e) {
  if (!e.altKey || e.metaKey || e.ctrlKey || rec.start == null) return false
  if (e.code !== "KeyP" && e.code !== "KeyM") return false
  e.preventDefault()
  e.stopImmediatePropagation()
  if (e.type !== "keydown" || e.repeat) return true
  if (e.code === "KeyP") clock.playing ? pause() : play()
  else addManualMarker()
  return true
}

function boot() {
  if (shell) shell.attach(PT)
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
