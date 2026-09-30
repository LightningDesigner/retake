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
