// The timeline: one bright line for the timeline you're on, and every other
// branch growing off it where it split, in the spirit of the TVA's branch
// screens. Only the playhead moves time: drag it (no click-to-seek). Dragging
// back pauses recording, leaves a stop at the last recorded moment and shows
// the past live as you go; letting go builds that moment for real.

const PAD = 10
let dragT = null
let liveNow = null
let pendingT = null
let svgKey = ""

function span(s) {
  const ends = branches.map((b) => (b.id === activeId ? Math.max(b.end, s.end) : b.end))
  const from = s.start
  return { from, to: Math.max(from + 4000, ...ends) }
}
const geom = () => {
  const r = svg.getBoundingClientRect()
  return { w: r.width, h: r.height, left: r.left }
}
function xOf(t, s, g) {
  const { from, to } = span(s)
  return PAD + ((Math.min(Math.max(t, from), to) - from) / (to - from)) * (g.w - 2 * PAD)
}
function timeAt(clientX) {
  const s = last
  const g = geom()
  const { from, to } = span(s)
  return from + Math.min(1, Math.max(0, (clientX - g.left - PAD) / (g.w - 2 * PAD))) * (to - from)
}

// Timeline 1 runs through the middle; each branch gets its own row,
// alternating above and below.
function laneY(b, g) {
  const i = branches.indexOf(b)
  if (i <= 0) return g.h / 2
  const rows = Math.ceil((branches.length - 1) / 2)
  const gap = Math.min(9, (g.h / 2 - 3) / rows)
  return g.h / 2 + (i % 2 ? -1 : 1) * Math.ceil(i / 2) * gap
}

function branchPath(b, s, g, until) {
  const y = laneY(b, g)
  const end = xOf(until, s, g)
  const parent = branches.find((p) => p.id === b.parentId)
  if (!parent) return `M${xOf(s.start, s, g)} ${y} L${Math.max(end, xOf(s.start, s, g) + 0.1)} ${y}`
  const x0 = xOf(b.forkAt, s, g)
  const y0 = laneY(parent, g)
  const bend = Math.min(26, Math.max(10, Math.abs(y - y0) * 2.4))
  return `M${x0} ${y0} C${x0 + bend * 0.6} ${y0} ${x0 + bend * 0.4} ${y} ${x0 + bend} ${y} L${Math.max(end, x0 + bend)} ${y}`
}

function renderTimeline(s, shownT) {
  const g = geom()
  if (!g.w) return
  let out = ""
  if (!s.started) {
    out += `<text class="empty" x="${PAD}" y="${g.h / 2 + 4}">Press record to start the timeline</text>`
    return setSvg(out)
  }
  const active = activeBranch()
  const activeEnd = Math.max(active.end, s.end)
  const xNow = xOf(shownT, s, g)
  // Other branches first, then the one you're on over them.
  for (const b of branches) {
    if (b.id === activeId) continue
    const grow = performance.now() - b.born < 900 ? ' grow" pathLength="1' : ""
    const d = branchPath(b, s, g, b.end)
    out += `<path class="branch${grow}" d="${d}"/><path class="hit" data-branch="${b.id}" d="${d}"><title>${esc(b.name)}</title></path>`
  }
  const grow = performance.now() - active.born < 900 && active.parentId ? ' grow" pathLength="1' : ""
  out += `<clipPath id="wb-past"><rect x="0" y="0" width="${xNow}" height="${g.h}"/></clipPath>`
  out += `<path class="branch active ahead" d="${branchPath(active, s, g, activeEnd)}"/>`
  out += `<path class="branch active${grow}" clip-path="url(#wb-past)" d="${branchPath(active, s, g, activeEnd)}"/>`
  // Notes sit on their branch like little tags.
  for (const n of notes) {
    const b = branches.find((x) => x.id === n.branchId)
    if (!b) continue
    out += `<rect class="notebox" data-note="${n.id}" x="${xOf(n.t, s, g) - 3}" y="${laneY(b, g) - 3}" width="6" height="6"><title>${esc(n.text)}</title></rect>`
  }
  const yA = laneY(active, g)
  const xEnd = xOf(activeEnd, s, g)
  if (xEnd - xNow > 4) out += `<circle class="stop" cx="${xEnd}" cy="${yA}" r="3.5"><title>Last recorded</title></circle>`
  out += `<line class="head" x1="${xNow}" x2="${xNow}" y1="0" y2="${g.h}"/>`
  out += `<circle class="knob-hit" cx="${xNow}" cy="${yA}" r="12"/><circle class="knob" cx="${xNow}" cy="${yA}" r="5.5"/>`
  setSvg(out)
}

function setSvg(markup) {
  if (markup === svgKey) return
  svgKey = markup
  svg.innerHTML = markup
}

// ---- dragging the playhead -------------------------------------------------------

function applyDrag() {
  const t = pendingT
  pendingT = null
  if (t == null || !PT) return
  const s = PT.state()
  if (t < liveNow - 1) {
    PT.preview(t, scopeEl)
  } else {
    if (s.previewing) PT.endPreview()
    // Ahead of the live moment there may be recorded future to walk into.
    if (t > liveNow + 1 && s.future) {
      PT.seek(t)
      liveNow = t
    }
  }
}

track.addEventListener("pointerdown", (e) => {
  const s = last
  if (!PT || !s) return
  const branchEl = e.target.closest("[data-branch]")
  if (branchEl) {
    switchTo(Number(branchEl.dataset.branch), timeAt(e.clientX))
    return
  }
  if (e.target.closest("[data-note]")) return
  if (!s.started) return
  const knob = svg.querySelector(".knob")
  const kr = knob && knob.getBoundingClientRect()
  if (!kr || Math.abs(e.clientX - (kr.left + kr.width / 2)) > 12) return
  track.setPointerCapture(e.pointerId)
  document.body.classList.add("scrubbing")
  if (s.recording) PT.pause()
  liveNow = s.now
  dragT = s.previewing ? s.previewAt : s.now
})

track.addEventListener("pointermove", (e) => {
  if (dragT == null) return
  const s = last
  const end = Math.max(activeBranch().end, s.end)
  dragT = Math.min(Math.max(timeAt(e.clientX), Math.max(s.start, activeBranch().forkAt)), end)
  if (pendingT == null) requestAnimationFrame(applyDrag)
  pendingT = dragT
})

function endDrag() {
  if (dragT == null) return
  const t = dragT
  dragT = null
  document.body.classList.remove("scrubbing")
  if (!PT) return
  pendingT = t
  applyDrag()
  // Unscoped, build the moment for real so it can be used straight away; a
  // scoped preview stays a picture until you act on it or press record.
  if (t < liveNow - 1 && !scopeEl) PT.seek(t)
  refocus()
}
track.addEventListener("pointerup", endDrag)
track.addEventListener("pointercancel", endDrag)

// Acting on a scoped preview builds that moment for real.
window.__waybackShell.wake = () => {
  const s = state()
  if (s && s.previewing) PT.seek(s.previewAt)
}
