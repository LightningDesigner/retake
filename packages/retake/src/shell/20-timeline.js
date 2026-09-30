// The timeline. A ruler on top; under it one lane per timeline, each in its
// own colour. A timeline made with + grows out of its parent's lane at the
// moment it split, along a short curve in its colour. The active lane is in
// full colour (dimmer over its recorded future); the others are the same hue,
// faint; with more than four, the inactive ones fold down to thin lines.
// On the active lane: a faint, thicker block wherever something was
// animating (overlaps merged), and a small blue dot for each thing you did.
//
// The view is a window of time [from, to], with the start of the recording
// never right of the left edge. It follows the whole recording until you zoom
// (⌘-scroll or pinch, anchored on the cursor); F fits all again.

const PAD_L = 12
const PAD_R = 18
const RULER = 20 // ruler height
const LANE = 28 // lane pitch
const THIN = 8 // pitch of a folded lane
const BEND = 18 // how far a new lane travels to reach its row
const GROW_MS = 250
const BAND_GAP = 30 // animations closer than this merge into one block

// One colour per timeline, by id: distinct on dark glass, none of them the
// blue of interaction dots or the amber of notes.
const TL_COLORS = ["#a78bfa", "#2dd4bf", "#f472b6", "#bef264", "#fb923c", "#f87171"]
const colorOf = (b) => TL_COLORS[((b ? b.id : 1) - 1) % TL_COLORS.length]

const plus = $(".plus")
const tip = $(".tip")
const gutter = $(".gutter")
const readoutT = $(".readout .t")
const readoutPhase = $(".readout .phase")
const hintEl = $(".hint")
const playBtn = $('[data-a="play"]')

// ---- the view ---------------------------------------------------------------------

D.view = { from: 0, to: 1000, follow: true, target: null, at: 0 }
let svgKey = ""
let pendingFork = null
let flashUntil = 0

// Everything recorded, on every timeline, from its first moment.
function fullRange(s) {
  let end = s.end
  for (const b of D.branches) end = Math.max(end, b.id === D.activeId ? Math.max(b.end, s.end) : b.end)
  const len = Math.max(end - s.start, 1000)
  const live = s.playing && !s.future
  return { from: s.start, to: s.start + len * (live ? 1.08 : 1.03) }
}

// The start of the recording is pinned: the view never begins before it.
function pinStart(v, s) {
  if (!s || v.from >= s.start) return v
  return { from: s.start, to: s.start + (v.to - v.from) }
}

function setView(from, to, { animate = true } = {}) {
  const span = Math.max(to - from, 20)
  const mid = (from + to) / 2
  const r = pinStart({ from: mid - span / 2, to: mid + span / 2 }, D.last)
  D.view.follow = false
  if (animate) D.view.target = r
  else {
    D.view.from = r.from
    D.view.to = r.to
    D.view.target = null
  }
}
function fitAll() {
  D.view.follow = true
}
function fitRange(a, b) {
  const pad = Math.max((b - a) * 0.15, 10)
  setView(a - pad, b + pad)
}

// Eases toward the target in ~200ms, then settles exactly (so a still
// timeline stops redrawing).
function stepView(s) {
  const now = performance.now()
  const dt = Math.min(64, now - (D.view.at || now))
  D.view.at = now
  if (D.view.follow) D.view.target = fullRange(s)
  const t = D.view.target
  if (!t) {
    const p = pinStart(D.view, s)
    D.view.from = p.from
    D.view.to = p.to
    return
  }
  const span = D.view.to - D.view.from
  if (D.dragT != null && D.view.follow) {
    D.view.from = t.from
    D.view.to = t.to
    return
  }
  const k = 1 - Math.exp(-dt / 45)
  D.view.from += (t.from - D.view.from) * k
  D.view.to += (t.to - D.view.to) * k
  if (Math.abs(t.from - D.view.from) < span / 4000 && Math.abs(t.to - D.view.to) < span / 4000) {
    D.view.from = t.from
    D.view.to = t.to
    if (!D.view.follow) D.view.target = null
  }
}

const geom = () => {
  const r = svg.getBoundingClientRect()
  return { w: r.width, h: r.height, left: r.left, top: r.top }
}
const innerW = (g) => Math.max(1, g.w - PAD_L - PAD_R)
const pxPerMs = (g) => innerW(g) / (D.view.to - D.view.from)
const xOf = (t, g) => clamp(PAD_L + (t - D.view.from) * pxPerMs(g), -4000, g.w + 4000)
const timeAt = (clientX, g = geom()) => D.view.from + (clientX - g.left - PAD_L) / pxPerMs(g)
const r1 = (n) => Math.round(n * 10) / 10

// ---- lanes ------------------------------------------------------------------------

// Animation blocks: the active recording's clips merged where they overlap.
// Each keeps the clips it's made of, for its tooltip.
function animationBands(clips, s, active) {
  const items = clips
    .map((c, i) => ({ c, i, a: c.start, b: c.end == null ? s.end : c.end }))
    .filter((x) => x.b >= active.forkAt && x.a <= Math.max(active.end, s.end))
    .sort((x, y) => x.a - y.a)
  const bands = []
  for (const it of items) {
    const last = bands[bands.length - 1]
    if (last && it.a <= last.b + BAND_GAP) {
      last.b = Math.max(last.b, it.b)
      last.clips.push(it.i)
    } else bands.push({ a: Math.max(it.a, active.forkAt), b: it.b, clips: [it.i] })
  }
  return bands
}

// Where each lane sits, centred in the room the dock has (it doesn't change
// height for them: that would resize the app mid-recording).
function layoutLanes(g) {
  const avail = g.h - RULER - 4
  const fold = D.branches.length > 4 || D.branches.length * LANE > avail
  const used = D.branches.reduce((h, b) => h + (b.id === D.activeId || !fold ? LANE : THIN), 0)
  const lanes = new Map()
  let y = RULER + 4 + Math.max(0, Math.floor((avail - used) / 2))
  for (const b of D.branches) {
    const thin = fold && b.id !== D.activeId
    const pitch = thin ? THIN : LANE
    lanes.set(b.id, { y: Math.round(y + pitch / 2), thin })
    y += pitch
  }
  return lanes
}

const growth = (b) => {
  const p = clamp((performance.now() - b.born) / GROW_MS, 0, 1)
  return 1 - Math.pow(1 - p, 3)
}

function lanePath(b, g, lanes, s, until) {
  const L = lanes.get(b.id)
  const parent = branchById(b.parentId)
  const x1 = xOf(until, g)
  if (!parent || !lanes.get(parent.id)) {
    const x0 = xOf(b.parentId ? b.forkAt : s.start, g)
    return `M${r1(x0)} ${L.y} L${r1(Math.max(x1, x0 + 0.5))} ${L.y}`
  }
  // Out of the parent's lane at the exact moment it split, then along its own.
  const x0 = xOf(b.forkAt, g)
  const py = lanes.get(parent.id).y
  const xb = x0 + BEND
  return `M${r1(x0)} ${py} C${r1(x0 + BEND * 0.55)} ${py} ${r1(xb - BEND * 0.55)} ${L.y} ${r1(xb)} ${L.y} L${r1(Math.max(x1, xb))} ${L.y}`
}

// ---- the ruler --------------------------------------------------------------------

const STEPS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 15000, 30000, 60000, 120000, 300000, 600000]

function ruler(g, s, xNow) {
  const ppm = pxPerMs(g)
  const major = STEPS.find((st) => st * ppm >= 72) || STEPS[STEPS.length - 1]
  const minor = STEPS.slice().reverse().find((st) => st < major && major % st === 0 && st * ppm >= 7) || major
  const dec = major >= 1000 ? 0 : major >= 100 ? 1 : major >= 10 ? 2 : 3
  const label = (t) => {
    const ms = t - s.start
    if (major >= 60000) return `${Math.floor(ms / 60000)}:${String(Math.round((ms % 60000) / 1000)).padStart(2, "0")}`
    return (ms / 1000).toFixed(dec) + "s"
  }
  let out = `<line class="rule" x1="0" x2="${g.w}" y1="${RULER - 0.5}" y2="${RULER - 0.5}"/>`
  const first = Math.ceil((D.view.from - s.start) / minor) * minor + s.start
  for (let t = first, n = 0; t <= D.view.to && n < 800; t += minor, n++) {
    const rel = Math.round(t - s.start)
    if (rel < 0) continue
    const x = r1(xOf(t, g)) + 0.5
    const isMajor = rel % major === 0
    out += `<line class="tick${isMajor ? " major" : ""}" x1="${x}" x2="${x}" y1="${RULER - (isMajor ? 6 : 3)}" y2="${RULER - 0.5}"/>`
    // A label the playhead's cap would sit on is left out.
    if (isMajor && !(xNow != null && x + 3 < xNow + 8 && x + 36 > xNow - 8)) out += `<text class="tlabel" x="${x + 3}" y="${RULER - 8}">${label(t)}</text>`
  }
  return out
}

// ---- drawing ----------------------------------------------------------------------

// Things you did are blue dots on the lane; what the app did on its own
// (routes, fetches, reloads) is a small grey tick above it.
const INPUT_KINDS = new Set(["click", "key", "input", "submit"])

const NOTE_FILL = { pending: "var(--amber)", acknowledged: "var(--blue)", resolved: "var(--green)", dismissed: "var(--dim)" }

function renderTimeline(s, shownT) {
  const g = geom()
  if (!g.w || !g.h) return
  stepView(s)
  const active = activeBranch()
  const activeEnd = Math.max(active.end, s.end)
  const tl = timeline()
  const lanes = layoutLanes(g)
  D.lanes = lanes
  const bands = animationBands(tl.clips, s, active)
  D.bands = bands
  const A = lanes.get(active.id)
  const xNow = r1(xOf(shownT, g))

  let out = `<clipPath id="wb-past"><rect x="-4000" y="0" width="${xNow + 4000}" height="${g.h}"/></clipPath>`
  out += ruler(g, s, xNow)

  // Lanes: the others first, faint in their colours; then the active one.
  for (const b of D.branches) {
    if (b.id === D.activeId) continue
    const L = lanes.get(b.id)
    const d = lanePath(b, g, lanes, s, b.end)
    const p = growth(b)
    const grow = p < 0.999 ? ` pathLength="1" stroke-dasharray="${p.toFixed(3)} 2"` : ""
    out += `<path class="lane${L.thin ? " thin" : ""}" style="stroke:${colorOf(b)}"${grow} d="${d}"/>`
    out += `<path class="lane hit" data-branch="${b.id}" d="${d}"/>`
  }
  const color = colorOf(active)
  const d = lanePath(active, g, lanes, s, activeEnd)
  const p = growth(active)
  const grow = p < 0.999 ? ` pathLength="1" stroke-dasharray="${p.toFixed(3)} 2"` : ""
  // Animation blocks sit on the lane, under its line.
  bands.forEach((band, i) => {
    const x0 = r1(xOf(band.a, g))
    const w = r1(Math.max(3, xOf(band.b, g) - x0))
    const isHot = D.hot && D.hot.kind === "band" && D.hot.i === i
    out += `<rect class="band${isHot ? " hot" : ""}" style="fill:${color}" x="${x0}" y="${A.y - 4}" width="${w}" height="8" rx="4"/>`
  })
  out += `<path class="lane active ahead" style="stroke:${color}"${grow} d="${d}"/>`
  out += `<path class="lane active" style="stroke:${color}"${grow} clip-path="url(#wb-past)" d="${d}"/>`
  out += `<path class="lane hit" data-branch="${active.id}" data-active="1" d="${d}"/>`
  const xEnd = r1(xOf(activeEnd, g))
  if (xEnd - xNow > 6) out += `<circle class="lane-end" style="stroke:${color}" cx="${xEnd}" cy="${A.y}" r="3"><title>Last recorded</title></circle>`
  bands.forEach((band, i) => {
    const x0 = r1(xOf(band.a, g))
    out += `<rect class="band-hit" data-band="${i}" x="${x0}" y="${A.y - 6}" width="${r1(Math.max(6, xOf(band.b, g) - x0))}" height="12"/>`
  })

  // Markers.
  tl.markers.forEach((m, i) => {
    if (m.t < active.forkAt - 1 || m.t > activeEnd + 1) return
    const x = r1(xOf(m.t, g))
    const isHot = D.hot && D.hot.kind === "mark" && D.hot.i === i
    out += INPUT_KINDS.has(m.kind)
      ? `<circle class="mk-dot${isHot ? " hot" : ""}" cx="${x}" cy="${A.y}" r="${isHot ? 3.5 : 2.5}"/>`
      : `<line class="mk-tick${isHot ? " hot" : ""}" x1="${x + 0.5}" x2="${x + 0.5}" y1="${A.y - 11}" y2="${A.y - 6}"/>`
    out += `<rect class="mk-hit" data-mark="${i}" x="${x - 4}" y="${A.y - 12}" width="8" height="16"/>`
  })

  // Bookmarks, on the ruler.
  for (const m of D.markers) {
    if (m.branchId !== D.activeId) continue
    const x = r1(xOf(m.t, g))
    out += `<path class="bookmark" data-bookmark="${m.id}" d="M${x - 3} ${RULER - 1} l3 -4 3 4z"><title>Bookmark · ${fmt(m.t - s.start)}</title></path>`
  }

  // The + guide, then the playhead.
  const showPlus = D.hoverT != null && D.dragT == null && pendingFork == null
  if (showPlus) {
    const xg = r1(xOf(D.hoverT, g)) + 0.5
    out += `<line class="guide" x1="${xg}" x2="${xg}" y1="${RULER}" y2="${g.h}"/>`
  }
  out += `<line class="head" x1="${xNow + 0.5}" x2="${xNow + 0.5}" y1="0" y2="${g.h}"/>`
  out += `<path class="head-cap" d="M${xNow - 4} 0 h9 v4 l-4.5 4 l-4.5 -4z"/>`
  if (D.snapT != null && D.dragT != null) {
    const xs = r1(xOf(D.snapT, g)) + 0.5
    out += `<line class="snap" x1="${xs}" x2="${xs}" y1="${RULER}" y2="${g.h}"/><circle class="snap-dot" cx="${xs}" cy="${RULER - 0.5}" r="2.5"/>`
  }

  // Notes, drawn last so they stay clickable over the playhead. A note made
  // before its timeline split off sits on the parent's lane, where that
  // moment is drawn.
  D.notes.forEach((n, i) => {
    let b = branchById(n.branchId)
    while (b && b.parentId && n.t < b.forkAt - 30) b = branchById(b.parentId)
    const L = b && lanes.get(b.id)
    if (!L) return
    const x = r1(xOf(n.t, g))
    const fill = NOTE_FILL[n.status] || NOTE_FILL.pending
    if (L.thin) {
      out += `<g class="note-mark" data-note="${n.id}"><circle cx="${x}" cy="${L.y}" r="2.5" fill="${fill}"/><title>${esc(n.text)}</title></g>`
      return
    }
    const label = String(i + 1)
    const w = 8 + label.length * 5
    out += `<g class="note-mark" data-note="${n.id}" transform="translate(${x} ${L.y - 11})">
      <rect x="${-w / 2}" y="-6" width="${w}" height="12" rx="6" fill="${fill}"/>
      <text x="0" y="3" text-anchor="middle">${label}</text><title>${esc(n.text)}</title></g>`
  })
  setSvg(out)
  renderGutter(lanes)

  // The + to start a new timeline: only ever on the active lane, right where
  // the pointer is on it.
  plus.hidden = !showPlus
  if (showPlus) {
    plus.style.left = xOf(D.hoverT, g) + "px"
    plus.style.top = A.y + "px"
    plus.style.setProperty("--c", color)
  }
  checkPendingFork(s)
}

function setSvg(markup) {
  if (markup === svgKey) return
  svgKey = markup
  svg.innerHTML = markup
}

// Lane names, in the gutter beside their lanes, each with its colour.
let gutterKey = ""
const invalidateGutter = () => (gutterKey = "")
function renderGutter(lanes) {
  if (gutter.querySelector("input")) return // renaming
  const key = D.branches.map((b) => `${b.id}:${b.name}:${lanes.get(b.id).y}:${lanes.get(b.id).thin}:${b.id === D.activeId}`).join("|")
  if (key === gutterKey) return
  gutterKey = key
  gutter.innerHTML = D.branches
    .map((b) => {
      const L = lanes.get(b.id)
      const on = b.id === D.activeId
      const cls = `lane-name${on ? " active" : ""}${L.thin ? " thin" : ""}`
      const title = on ? `${b.name} · double-click to rename` : `${b.name} · click to select`
      return `<div class="${cls}" data-lane="${b.id}" style="top:${L.y}px;--c:${colorOf(b)}" title="${esc(title)}"><i></i><span>${esc(b.name)}</span></div>`
    })
    .join("")
}

// ---- the header ---------------------------------------------------------------------

function phaseOf(s) {
  if (D.dragT != null || s.previewing) return "Scrubbing"
  if (D.building) return `Building${buildProgress()}`
  if (s.seeking) return "Loading"
  if (s.playing) return s.future ? "Playing" : "Live"
  return "Paused"
}

// How far the frame being built behind the visible one has got: " 43%".
// The visible frame keeps showing the moment (as a preview) meanwhile.
function buildProgress() {
  try {
    const b = D.building.pt && D.building.pt.state()
    if (!b || b.target == null) return ""
    const pct = clamp((b.now - b.start) / Math.max(1, b.target - b.start), 0, 0.99)
    return ` ${Math.floor(pct * 100)}%`
  } catch {
    return ""
  }
}

function renderHead(s, shownT) {
  readoutT.textContent = fmt(shownT - s.start)
  const phase = phaseOf(s)
  if (readoutPhase.textContent !== phase) readoutPhase.textContent = phase
  readoutPhase.dataset.phase = phase.split(" ")[0].toLowerCase()
  playBtn.classList.toggle("playing", !!s.playing && D.dragT == null)
  playBtn.setAttribute("aria-label", s.playing ? "Pause" : "Play")
  if (performance.now() < flashUntil) return
  hintEl.classList.remove("warn")
  const text = s.started && !s.playing && D.dragT == null ? "Paused · + to branch" : ""
  if (hintEl.textContent !== text) hintEl.textContent = text
  hintEl.classList.toggle("show", !!text)
}

// A short message in the hint's place (a refused checkout, say).
function flash(msg) {
  flashUntil = performance.now() + 3500
  hintEl.textContent = msg
  hintEl.classList.add("show", "warn")
}

// ---- a new timeline from a chosen moment -------------------------------------------

function newTimelineAt(t) {
  const s = state()
  if (!D.PT || !s || !s.started) return
  const here = s.previewing ? s.previewAt : s.now
  if (!s.previewing && Math.abs(t - here) < 2) return forkNow()
  // Go to that moment first; the fork happens once it's built.
  pendingFork = t
  D.PT.seek(t)
}

// The new timeline is made and selected, paused at the moment it split off.
// Nothing plays until you press play.
function forkNow() {
  D.PT.pause()
  D.PT.forkHere()
}

function checkPendingFork(s) {
  if (pendingFork == null || D.building || !D.PT || s.seeking || s.previewing) return
  if (Math.abs(s.now - pendingFork) > 40) return
  pendingFork = null
  forkNow()
}
