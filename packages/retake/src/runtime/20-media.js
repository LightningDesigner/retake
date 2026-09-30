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
  })
}
MP.pause = function () {
  this.__ptWants = false
  return mediaOrig.pause.call(this)
}

function syncMedia() {
  const live = clock.playing && !clock.seeking
  for (const el of media) {
    if (!el.isConnected && el.paused) {
      media.delete(el)
      continue
    }
    if (!live && !el.paused) mediaOrig.pause.call(el)
    else if (live && el.__ptWants && el.paused) mediaOrig.play.call(el).catch(() => {})
    if (live && el.playbackRate !== clock.rate) el.playbackRate = clock.rate
  }
}

// After a seek, media the app had playing jumps to where it would be at this
// moment on the virtual clock.
function alignMedia() {
  for (const el of media) {
    if (!el.__ptWants || el.__ptAt == null) continue
    const t = el.__ptFrom + ((clock.now - el.__ptAt) / 1000) * (el.playbackRate || 1)
    const end = Number.isFinite(el.duration) ? el.duration : Infinity
    try {
      el.currentTime = el.loop && Number.isFinite(end) && end > 0 ? t % end : Math.min(t, end)
    } catch {}
  }
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
  if (path) recordEvent({ type: "ready", ev: e.type, path })
}
// On the document, not window: element load/error events don't reach window.
for (const type of READY) document.addEventListener(type, onReady, true)

function deliverReady(ev) {
  const el = resolvePath(ev.path)
  if (!el || !readyTarget(el)) return
  if (!delivered.has(el)) delivered.set(el, new Set())
  delivered.get(el).add(ev.ev)
  el.dispatchEvent(new Event(ev.ev))
}
