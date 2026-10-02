// Audio/video can't be scrubbed, so it only plays while the clock plays at
// normal pace. Elements the app wanted playing are resumed when the clock does.

const MP = HTMLMediaElement.prototype
const mediaOrig = { play: MP.play, pause: MP.pause }
const media = new Set()

// play() settles in real time (and autoplay may reject it), so its outcome is
// recorded and replayed like a network response.
MP.play = function () {
  media.add(this)
  const el = this
  return recordedAsync(() => {
    if (!clock.playing || clock.seeking) return Promise.resolve()
    return mediaOrig.play.call(el)
  }).then(() => {
    el.__ptWants = true
    // Where the media was when it started, on the virtual clock.
    el.__ptAt = clock.now
    el.__ptFrom = el.currentTime || 0
    mediaRun(el, el.__ptFrom, true)
  })
}
MP.pause = function () {
  if (this.__ptWants) mediaRun(this, this.currentTime || 0, false)
  this.__ptWants = false
  return mediaOrig.pause.call(this)
}

// Each element's runs on the virtual clock: { at, from, on } from `at` on, it
// played from `from` (on) or stood at it (off). The preview places media at
// the run in effect at its moment (F50), including media removed since.
function mediaRun(el, from, on) {
  const runs = el.__ptRuns || (el.__ptRuns = [])
  const last = runs[runs.length - 1]
  if (last && last.at === clock.now) runs.pop()
  runs.push({ at: clock.now, from, on, src: el.currentSrc || el.src || "" })
}

function syncMedia() {
  const live = clock.playing && !clock.seeking
  for (const el of media) {
    if (el.__ptAlign && el.readyState >= 1 && !clock.seeking && !previewing) alignMedia()
    // Removed media is kept (the DOM log keeps it too): a preview of a moment
    // when it was there puts it back, at its time then.
    if (!el.isConnected) {
      if (!el.paused) mediaOrig.pause.call(el)
      continue
    }
    if (!live && !el.paused) mediaOrig.pause.call(el)
    else if (live && el.__ptWants && el.paused) mediaOrig.play.call(el).catch(() => {})
    if (live && el.playbackRate !== clock.rate) el.playbackRate = clock.rate
  }
}

// After a seek, media the app had playing jumps to where it would be at this
// moment on the virtual clock.
function alignMedia(at = clock.now) {
  for (const el of media) {
    if (previewing && el.__ptRuns && el.__ptRuns.length) {
      placeMedia(el, at)
      continue
    }
    if (!el.__ptWants || el.__ptAt == null) continue
    // Too early to seek (no metadata yet): syncMedia does it once it can.
    if (el.readyState < 1) {
      el.__ptAlign = true
      continue
    }
    el.__ptAlign = false
    const t = el.__ptFrom + ((at - el.__ptAt) / 1000) * (el.playbackRate || 1)
    const end = Number.isFinite(el.duration) ? el.duration : Infinity
    try {
      el.currentTime = el.loop && Number.isFinite(end) && end > 0 ? t % end : Math.min(t, end)
    } catch {}
  }
}

// The preview: where it was at `at`, from its runs (before the first: where that one started).
function placeMedia(el, at) {
  if (el.readyState < 1) return
  const runs = el.__ptRuns
  let run = runs[0]
  for (const r of runs) if (r.at <= at) run = r
  const t = run.on && run.at <= at ? run.from + ((at - run.at) / 1000) * (el.playbackRate || 1) : run.from
  const end = Number.isFinite(el.duration) ? el.duration : Infinity
  try {
    el.currentTime = el.loop && Number.isFinite(end) && end > 0 ? t % end : Math.min(t, end)
  } catch {}
}

// ---- readiness events ------------------------------------------------------------
// A media file or image finishing loading is the network talking, in real
// time. Apps react to it (reveal UI on loadeddata, fade in on load), so the
// moment it happened is recorded, and on replay the real event is held back
// and the recorded one is dispatched at its virtual moment instead.
const READY = ["loadedmetadata", "loadeddata", "canplay", "canplaythrough", "playing", "load", "error"]
const readyTarget = (t) => t instanceof HTMLMediaElement || t instanceof HTMLImageElement
const delivered = new WeakMap() // element -> Set of types already given from the recording

function onReady(e) {
  if (!e.isTrusted || !rec || !readyTarget(e.target)) return
  const el = e.target
  const given = delivered.get(el)
  if (hasFuture() || clock.seeking) {
    e.stopImmediatePropagation() // the recording delivers it at its moment
    return
  }
  if (given && given.has(e.type)) {
    // Already delivered from the recording before we reached the live edge.
    given.delete(e.type)
    e.stopImmediatePropagation()
    return
  }
  const path = pathOf(el)
  if (e.type === "playing" && el instanceof HTMLMediaElement) startedAt(el, el.currentTime)
  if (path) recordEvent(e.type === "playing" ? { type: "ready", ev: e.type, path, ct: el.currentTime || 0 } : { type: "ready", ev: e.type, path })
}

// Media that starts by itself (autoplay) never calls play(): it's taken in
// when it starts, paused whenever the clock isn't playing at normal pace, and
// placed at its virtual time after a seek, like media the app played.
function startedAt(el, from) {
  media.add(el)
  el.__ptWants = true
  if (el.__ptAt == null) {
    el.__ptAt = clock.now
    el.__ptFrom = from || 0
    mediaRun(el, el.__ptFrom, true)
  }
}
document.addEventListener(
  "play",
  (e) => {
    const el = e.target
    if (!(el instanceof HTMLMediaElement)) return
    media.add(el)
    el.__ptWants = true
    if (!(clock.playing && !clock.seeking)) mediaOrig.pause.call(el)
  },
  true,
)
// On the document, not window: element load/error events don't reach window.
for (const type of READY) document.addEventListener(type, onReady, true)

function deliverReady(ev) {
  const el = resolvePath(ev.path)
  if (!el || !readyTarget(el)) return
  if (!delivered.has(el)) delivered.set(el, new Set())
  delivered.get(el).add(ev.ev)
  // The recorded moment it started playing (autoplay included).
  if (ev.ev === "playing" && el instanceof HTMLMediaElement) {
    el.__ptAt = null
    startedAt(el, ev.ct)
  }
  el.dispatchEvent(new Event(ev.ev))
}
