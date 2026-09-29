// The timeline: one row per timeline (branch), labelled on the left. A branch's
// bar starts where it split off its parent, joined by a short curve. Only the
// playhead moves time: drag it (no click-to-seek). Dragging back pauses
// recording, leaves a ring at the last recorded moment and shows the past live
// as you go; letting go builds that moment for real.

const PAD = 8
const ROW = 18 // row pitch
const BAR = 10 // bar height
const TOP = 16 // room for the time chip
const labelsEl = $(".labels")
const timeChip = $(".time")
let dragT = null
let liveNow = null
let pendingT = null
let svgKey = ""
let labelsKey = ""
let shownSpan = null // eased span, so the scale glides instead of jumping

// The view spans the recording, with a little headroom at the right so the
// playhead has somewhere to run while recording.
function targetSpan(s) {
  const ends = branches.map((b) => (b.id === activeId ? Math.max(b.end, s.end) : b.end))
  const end = Math.max(...ends)
  const len = Math.max(end - s.start, 600)
  return { from: s.start, to: s.start + len * (s.recording ? 1.08 : 1) }
}
function easeSpan(s) {
  const t = targetSpan(s)
  if (!shownSpan || shownSpan.from !== t.from || dragT != null) shownSpan = t
  else shownSpan = { from: t.from, to: shownSpan.to + (t.to - shownSpan.to) * 0.18 }
  return shownSpan
}
const span = () => shownSpan || { from: 0, to: 1 }
const geom = () => {
  const r = svg.getBoundingClientRect()
  return { w: r.width, h: r.height, left: r.left }
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
const rowY = (i) => TOP + i * ROW
const rowOf = (b) => branches.indexOf(b)

function renderTimeline(s, shownT) {
  const g = geom()
  if (!g.w) return
  renderLabels(s)
  if (!s.started) {
    timeChip.textContent = ""
    return setSvg(`<rect class="row" x="${PAD}" y="${rowY(0)}" width="${g.w - 2 * PAD}" height="${BAR}" rx="${BAR / 2}"/>
      <text class="empty" x="${PAD + 4}" y="${rowY(0) + BAR + 14}">Press record to start</text>`)
  }
  easeSpan(s)
  const active = activeBranch()
  const activeEnd = Math.max(active.end, s.end)
  const xNow = xOf(shownT, g)
  let out = ""
  branches.forEach((b, i) => {
    const y = rowY(i)
    const isActive = b.id === activeId
    const end = isActive ? activeEnd : b.end
    const x0 = xOf(b.parentId ? b.forkAt : s.start, g)
    const x1 = Math.max(xOf(end, g), x0 + BAR)
    const young = performance.now() - b.born < 700
    out += `<rect class="row" x="${x0}" y="${y}" width="${x1 - x0}" height="${BAR}" rx="${BAR / 2}"/>`
    if (isActive) {
      out += `<rect class="bar-ahead" x="${x0}" y="${y}" width="${x1 - x0}" height="${BAR}" rx="${BAR / 2}"/>`
      out += `<rect class="bar-past active${young ? " grow" : ""}" x="${x0}" y="${y}" width="${Math.max(BAR, xNow - x0)}" height="${BAR}" rx="${BAR / 2}"/>`
    } else {
      out += `<rect class="bar-past${young ? " grow" : ""}" data-branch="${b.id}" x="${x0}" y="${y}" width="${x1 - x0}" height="${BAR}" rx="${BAR / 2}" style="cursor:pointer"><title>${esc(b.name)}</title></rect>`
    }
    const parent = branches.find((p) => p.id === b.parentId)
    if (parent) {
      const py = rowY(rowOf(parent)) + BAR / 2
      const cy = y + BAR / 2
      out += `<path class="fork${isActive ? " active" : ""}" d="M${x0} ${py} C${x0} ${(py + cy) / 2} ${x0} ${cy} ${x0 + 6} ${cy}"/>`
    }
  })
  for (const n of notes) {
    const b = branches.find((x) => x.id === n.branchId)
    if (b) out += `<circle class="note-dot" data-note="${n.id}" cx="${xOf(n.t, g)}" cy="${rowY(rowOf(b)) - 3}" r="3"><title>${esc(n.text)}</title></circle>`
  }
  const yA = rowY(rowOf(active)) + BAR / 2
  const xEnd = xOf(activeEnd, g)
  if (xEnd - xNow > 6) out += `<circle class="stop" cx="${xEnd}" cy="${yA}" r="4"><title>Last recorded</title></circle>`
  out += `<line class="head" x1="${xNow}" x2="${xNow}" y1="${TOP - 3}" y2="${rowY(branches.length - 1) + BAR + 3}"/>`
  out += `<circle class="knob-hit" cx="${xNow}" cy="${yA}" r="12"/><circle class="knob" cx="${xNow}" cy="${yA}" r="6"/>`
  setSvg(out)
  timeChip.textContent = fmt(shownT - s.start)
  timeChip.style.left = xNow + "px"
}

function setSvg(markup) {
  if (markup === svgKey) return
  svgKey = markup
  svg.innerHTML = markup
}

function renderLabels(s) {
  const key = branches.map((b) => b.id + b.name).join() + activeId + s.started
  if (key === labelsKey) return
  labelsKey = key
  const rows = branches.map(
    (b, i) =>
      `<button data-branch="${b.id}" class="${b.id === activeId ? "active" : ""}" style="top:${rowY(i) - 4}px" title="${esc(b.name)}">${esc(b.name)}</button>`,
  )
  if (s.started) rows.push(`<button class="add" data-a="new-branch" style="top:${rowY(branches.length) - 4}px">+ New timeline</button>`)
  labelsEl.innerHTML = rows.join("")
}

// Rows set the dock's height: a new timeline gets its own row.
const neededHeight = () => Math.max(84, rowY(branches.length + 1) + 12)

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
  if (e.target.closest("[data-note]") || !s.started) return
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
  const b = activeBranch()
  dragT = Math.min(Math.max(timeAt(e.clientX), Math.max(s.start, b.forkAt)), Math.max(b.end, s.end))
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

// A new timeline, starting at the moment on show. Notes made now belong to it.
function newTimeline() {
  const s = state()
  if (!PT || !s || !s.started) return
  if (s.previewing) {
    PT.seek(s.previewAt)
    setTimeout(newTimeline, 150)
    return
  }
  PT.pause()
  PT.forkHere()
}

// Acting on a scoped preview builds that moment for real.
window.__waybackShell.wake = () => {
  const s = state()
  if (s && s.previewing) PT.seek(s.previewAt)
}
