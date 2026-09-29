// Loop a moment: replay a short stretch on repeat, e.g. while tuning an
// animation. The loop button takes the last 3 seconds; shift-drag on the
// scrubber picks any range.

let loop = null // { from, to }
const loopEl = $(".loop-range")

function toggleLoop() {
  if (loop) {
    loop = null
    return
  }
  const s = PT && PT.state()
  if (!s) return
  const to = s.now
  loop = { from: Math.max(s.start, to - 3000), to }
  PT.seek(loop.from, true)
}

function startLoopSelect(e) {
  track.setPointerCapture(e.pointerId)
  const a = timeAt(e.clientX)
  loop = { from: a, to: a }
  const move = (ev) => {
    const b = timeAt(ev.clientX)
    loop = { from: Math.min(a, b), to: Math.max(a, b) }
  }
  const up = () => {
    track.removeEventListener("pointermove", move)
    track.removeEventListener("pointerup", up)
    if (loop.to - loop.from < 200) loop = null
    else PT.seek(loop.from, true)
    refocus()
  }
  track.addEventListener("pointermove", move)
  track.addEventListener("pointerup", up)
}

function renderLoop(s) {
  $('[data-a="loop"]').classList.toggle("on", !!loop)
  loopEl.style.display = loop ? "" : "none"
  if (!loop) return
  loopEl.style.left = pct(s, loop.from)
  loopEl.style.width = `${(frac(s, loop.to) - frac(s, loop.from)) * 100}%`
  // Back to the start of the range whenever playback runs past its end.
  if (PT && !stash && s.playing && !s.seeking && s.now >= loop.to) PT.seek(loop.from, true)
}
