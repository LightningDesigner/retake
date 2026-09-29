// The timeline. Each timeline is a ribbon; a branch curves out of its parent at
// the moment it split and grows from there. The one you're on is bright up to
// the playhead. Only the playhead moves time: drag it. Dragging back pauses
// recording, leaves a ring at the last recorded moment and shows the past live;
// letting go builds that moment for real. While paused, hovering the timeline
// offers a + to start a new timeline from that moment.

const PAD = 10
const ROW = 16 // row pitch
const BAR = 8 // ribbon thickness
const TOP = 22 // room for the time chip
const BEND = 26 // how far a branch travels to reach its row
const timeChip = $(".time")
const plus = $(".plus")
let dragT = null
let liveNow = null
let pendingT = null
let pendingFork = null
let hoverT = null
let svgKey = ""
let shownSpan = null

// The view spans the recording, with headroom so the playhead has room to run.
function targetSpan(s) {
  const end = Math.max(...branches.map((b) => (b.id === activeId ? Math.max(b.end, s.end) : b.end)))
  const len = Math.max(end - s.start, 600)
  return { from: s.start, to: s.start + len * (s.recording ? 1.08 : 1) }
}
function easeSpan(s) {
  const t = targetSpan(s)
  if (!shownSpan || shownSpan.from !== t.from || dragT != null) shownSpan = t
  // Settle exactly once close, so a still timeline stops redrawing.
  else if (Math.abs(t.to - shownSpan.to) < 1) shownSpan = t
  else shownSpan = { from: t.from, to: shownSpan.to + (t.to - shownSpan.to) * 0.18 }
}
const span = () => shownSpan || { from: 0, to: 1 }
const geom = () => {
  const r = svg.getBoundingClientRect()
  return { w: r.width, h: r.height, left: r.left, top: r.top }
}
function xOf(t, g) {
  const { from, to } = span()
  return PAD + ((Math.min(Math.max(t, from), to) - from) / (to - from)) * (g.w - 2 * PAD)
}
function timeAt(clientX) {
  const g = geom()
  const { from, to } = span()
  return from + Math.min(1, Math.max(0, (clientX - g.left - PAD) / (g.w - 2 * PAD))) * (to - from)
}
const rowY = (b) => TOP + branches.indexOf(b) * ROW + BAR / 2

function ribbon(b, s, g, until) {
  const y = rowY(b)
  const parent = branches.find((p) => p.id === b.parentId)
  const x1 = xOf(until, g)
  if (!parent) return `M${xOf(s.start, g)} ${y} L${Math.max(x1, xOf(s.start, g) + 0.5)} ${y}`
  // The curve leads into the fork moment, so from its first instant a new
  // timeline already sits on its own row, under the playhead.
  const x0 = xOf(b.forkAt, g)
  const py = rowY(parent)
  const xs = Math.max(PAD, x0 - BEND)
  return `M${xs} ${py} C${xs + BEND * 0.55} ${py} ${x0 - BEND * 0.45} ${y} ${x0} ${y} L${Math.max(x1, x0 + 0.5)} ${y}`
}

// Before anything is recorded: a quiet ruler and a waiting record dot.
function emptyState(g) {
  let out = ""
  const y = TOP + BAR / 2
  for (let x = PAD, i = 0; x < g.w - PAD; x += 12, i++) {
    const major = i % 5 === 0
    const fade = Math.max(0, 1 - (x / g.w) * 0.9)
    out += `<line class="tick${major ? " major" : ""}" x1="${x}" x2="${x}" y1="${y - (major ? 6 : 3)}" y2="${y + (major ? 6 : 3)}" opacity="${fade.toFixed(2)}"/>`
  }
  out += `<line class="ghost-head" x1="${PAD}" x2="${PAD}" y1="${TOP - 8}" y2="${y + 12}"/><circle class="ghost-dot" cx="${PAD}" cy="${y}" r="4"/>`
  return out
}

function renderTimeline(s, shownT) {
  const g = geom()
  if (!g.w) return
  if (!s.started) {
    timeChip.textContent = ""
    plus.hidden = true
    return setSvg(emptyState(g))
  }
  easeSpan(s)
  const active = activeBranch()
  const activeEnd = Math.max(active.end, s.end)
  const xNow = xOf(shownT, g)
  let out = `<clipPath id="wb-past"><rect x="0" y="0" width="${xNow}" height="${g.h}"/></clipPath>`
  for (const b of branches) {
    if (b.id === activeId) continue
    const young = performance.now() - b.born < 800 ? ' grow" pathLength="1' : ""
    out += `<path class="ribbon other${young}" data-branch="${b.id}" stroke-width="${BAR}" d="${ribbon(b, s, g, b.end)}"><title>${esc(b.name)}</title></path>`
  }
  const d = ribbon(active, s, g, activeEnd)
  const young = active.parentId && performance.now() - active.born < 800 ? ' grow" pathLength="1' : ""
  out += `<path class="ribbon ahead${young}" stroke-width="${BAR}" d="${d}"/>`
  out += `<path class="ribbon past${young}" stroke-width="${BAR}" clip-path="url(#wb-past)" d="${d}"/>`
  // Every comment, from every timeline, as a small speech bubble sitting on
  // the ribbon that covers its moment (a note made before its timeline split
  // off sits on the parent's ribbon, where that moment is drawn).
  notes.forEach((n, i) => {
    let b = branches.find((x) => x.id === n.branchId)
    while (b && b.parentId && n.t < b.forkAt) b = branches.find((x) => x.id === b.parentId)
    if (!b) return
    const x = xOf(n.t, g)
    const y = rowY(b) - BAR / 2 - 3
    out += `<g class="note-mark${n.branchId === activeId ? " here" : ""}" data-note="${n.id}" transform="translate(${x} ${y})">
      <path d="M-6 -13 h12 a2.5 2.5 0 0 1 2.5 2.5 v5 a2.5 2.5 0 0 1 -2.5 2.5 h-3.5 l-2.5 3 l-2.5 -3 h-3.5 a2.5 2.5 0 0 1 -2.5 -2.5 v-5 a2.5 2.5 0 0 1 2.5 -2.5z"/>
      <text x="0" y="-5.6" text-anchor="middle">${i + 1}</text>
      <title>${esc(n.text)}</title></g>`
  })
  for (const m of markers) {
    const b = branches.find((x) => x.id === m.branchId)
    if (!b) continue
    const x = xOf(m.t, g)
    const y = rowY(b) - BAR / 2
    out += `<g data-marker="${m.id}"><line class="marker-pole" x1="${x}" x2="${x}" y1="${y - 12}" y2="${y}"/><path class="marker" d="M${x} ${y - 12} l7 2.5 -7 2.5z"/><rect x="${x - 3}" y="${y - 13}" width="12" height="14" fill="transparent" style="cursor:pointer"/><title>Marker · ${fmt(m.t - s.start)}</title></g>`
  }
  const yA = rowY(active)
  // What happened on this timeline: a spike per click or key, a band under the
  // ribbon wherever something was animating.
  const act = activityNow()
  for (const [a, b] of act.bands) {
    if (b < active.forkAt) continue
    const xa = xOf(Math.max(a, active.forkAt), g)
    out += `<rect class="band" x="${xa}" y="${yA + BAR / 2 + 3}" width="${Math.max(2, xOf(b, g) - xa)}" height="2" rx="1"/>`
  }
  for (const t of act.inputs) {
    if (t < active.forkAt) continue
    const x = xOf(t, g)
    out += `<line class="spike" x1="${x}" x2="${x}" y1="${yA - BAR / 2 - 7}" y2="${yA - BAR / 2 - 2}"/>`
  }
  const xEnd = xOf(activeEnd, g)
  if (xEnd - xNow > 8) out += `<circle class="stop" cx="${xEnd}" cy="${yA}" r="4.5"><title>Last recorded</title></circle>`
  out += `<line class="head" x1="${xNow}" x2="${xNow}" y1="${TOP - 6}" y2="${TOP + (branches.length - 1) * ROW + BAR + 4}"/>`
  out += `<circle class="knob-hit" cx="${xNow}" cy="${yA}" r="12"/><circle class="knob" cx="${xNow}" cy="${yA}" r="6.5"/>`
  setSvg(out)
  timeChip.textContent = fmt(shownT - s.start)
  timeChip.style.left = xNow + "px"
  // The + that starts a new timeline, offered only while time is still.
  const showPlus = hoverT != null && !s.recording && dragT == null && pendingFork == null
  plus.hidden = !showPlus
  if (showPlus) {
    plus.style.left = xOf(hoverT, g) + "px"
    plus.style.top = yA + 17 + "px"
  }
  checkPendingFork(s)
}

function setSvg(markup) {
  if (markup === svgKey) return
  svgKey = markup
  svg.innerHTML = markup
}

// Rows set the dock's height.
const neededHeight = () => Math.max(104, TOP + branches.length * ROW + 28)

// ---- a new timeline from a chosen moment -------------------------------------------

function newTimelineAt(t) {
  const s = state()
  if (!PT || !s || !s.started) return
  const here = s.previewing ? s.previewAt : s.now
  if (!s.previewing && Math.abs(t - here) < 25) {
    PT.pause()
    PT.forkHere()
    return
  }
  // Go to that moment first; the fork happens once it's built.
  pendingFork = t
  PT.seek(t)
}

function checkPendingFork(s) {
  if (pendingFork == null || building || !PT || s.seeking || s.previewing) return
  if (Math.abs(s.now - pendingFork) > 40) return
  pendingFork = null
  PT.pause()
  PT.forkHere()
}

// ---- pointer ----------------------------------------------------------------------

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

let activityMemo = { at: 0, value: { inputs: [], bands: [] } }
function activityNow() {
  if (!PT || !PT.activity) return activityMemo.value
  const now = performance.now()
  if (now - activityMemo.at > 120) {
    try {
      activityMemo = { at: now, value: PT.activity() }
    } catch {}
  }
  return activityMemo.value
}

// Within a few pixels of something that happened, land on it: just after an
// input or an animation's start (so its first frame shows), or on its end.
function snap(t) {
  const g = geom()
  const pxPerMs = (g.w - 2 * PAD) / (span().to - span().from)
  const act = activityNow()
  let best = null
  const consider = (c) => {
    const d = Math.abs(c - t) * pxPerMs
    if (d <= 7 && (!best || d < best.d)) best = { c, d }
  }
  for (const i of act.inputs) consider(i + 1)
  for (const [a, b] of act.bands) {
    consider(a + 1)
    consider(b)
  }
  return best ? best.c : t
}

const nearKnob = (clientX) => {
  const knob = svg.querySelector(".knob")
  const kr = knob && knob.getBoundingClientRect()
  return kr && Math.abs(clientX - (kr.left + kr.width / 2)) <= 12
}

// Where on the active timeline a new one could start.
function hoverTime(clientX) {
  const b = activeBranch()
  const s = last
  const t = timeAt(clientX)
  return Math.min(Math.max(t, Math.max(s.start, b.forkAt)), Math.max(b.end, s.end))
}

track.addEventListener("pointerdown", (e) => {
  const s = last
  if (!PT || !s || !s.started) return
  if (e.target === plus) return
  const branchEl = e.target.closest("[data-branch]")
  if (branchEl) {
    switchTo(Number(branchEl.dataset.branch), timeAt(e.clientX))
    return
  }
  const markerEl = e.target.closest("[data-marker]")
  if (markerEl) {
    const m = markers.find((x) => x.id === Number(markerEl.dataset.marker))
    if (!m) return
    // Right-click removes a marker; a click goes to it.
    if (e.button === 2) markers = markers.filter((x) => x !== m)
    else if (m.branchId !== activeId) switchTo(m.branchId, m.t)
    else PT.seek(m.t)
    return
  }
  if (e.target.closest("[data-note]") || !nearKnob(e.clientX)) return
  track.setPointerCapture(e.pointerId)
  document.body.classList.add("scrubbing")
  if (s.recording) PT.pause()
  liveNow = s.now
  dragT = s.previewing ? s.previewAt : s.now
  hoverT = null
})

track.addEventListener("pointermove", (e) => {
  if (dragT == null) {
    const s = last
    const onBranch = e.target.closest && e.target.closest("[data-branch]")
    // Near the playhead the + snaps to it: that's where you'd branch from after
    // dragging back. It sits below the ribbon so the handle stays draggable.
    if (e.target === plus) return
    if (!s || !s.started || s.recording || onBranch) {
      hoverT = null
      return
    }
    hoverT = nearKnob(e.clientX) ? (s.previewing ? s.previewAt : s.now) : hoverTime(e.clientX)
    return
  }
  const s = last
  const b = activeBranch()
  dragT = snap(Math.min(Math.max(timeAt(e.clientX), Math.max(s.start, b.forkAt)), Math.max(b.end, s.end)))
  if (pendingT == null) requestAnimationFrame(applyDrag)
  pendingT = dragT
})
track.addEventListener("contextmenu", (e) => {
  if (e.target.closest("[data-marker]")) e.preventDefault()
})
track.addEventListener("pointerleave", () => {
  if (dragT == null) hoverT = null
})

plus.addEventListener("click", (e) => {
  e.stopPropagation()
  if (hoverT != null) newTimelineAt(hoverT)
  hoverT = null
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
