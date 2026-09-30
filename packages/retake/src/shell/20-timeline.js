// The timeline. A ruler on top; under it one lane per timeline. A timeline made
// with + grows out of its parent's lane at the moment it split, along a short
// curve. The active lane is white (bright up to the playhead, dimmer over the
// recorded future), the others grey; with more than four, the inactive ones
// fold down to thin lines. Under the active lane, every animation or
// transition is a thin bar from its start to its end (overlaps stack); above
// it, small ticks mark what happened: clicks, keys, routes, fetches.
//
// The view is a window of time [from, to]. It follows the whole recording
// until you zoom (⌘-scroll or pinch, anchored on the cursor); F fits all again.

const PAD_L = 12
const PAD_R = 18
const RULER = 18 // ruler height
const LANE = 20 // lane pitch
const THIN = 7 // pitch of a folded lane
const CLIP_ROW = 3 // clip bar pitch
const MAX_CLIP_ROWS = 4
const BEND = 16 // how far a new lane travels to reach its row
const GROW_MS = 250

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

// Everything recorded, on every timeline.
function fullRange(s) {
  let end = s.end
  for (const b of D.branches) end = Math.max(end, b.id === D.activeId ? Math.max(b.end, s.end) : b.end)
  const len = Math.max(end - s.start, 1000)
  const live = s.playing && !s.future
  return { from: s.start, to: s.start + len * (live ? 1.08 : 1.03) }
}

function setView(from, to, { animate = true } = {}) {
  const span = Math.max(to - from, 20)
  const mid = (from + to) / 2
  const r = { from: mid - span / 2, to: mid + span / 2 }
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
  if (!t) return
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

// Rows for the active lane's clips: overlapping clips stack.
// `items` are { c, i }: a clip and its index in timeline().clips.
function packClips(items, g, s) {
  const rows = []
  const out = []
  const sorted = items.slice().sort((a, b) => a.c.start - b.c.start)
  for (const { c, i } of sorted) {
    const x0 = xOf(c.start, g)
    const x1 = Math.max(x0 + 2, xOf(c.end == null ? s.end : c.end, g))
    let row = rows.findIndex((end) => end + 2 <= x0)
    if (row < 0) {
      row = rows.length < MAX_CLIP_ROWS ? rows.length : MAX_CLIP_ROWS - 1
      if (row === rows.length) rows.push(0)
    }
    rows[row] = Math.max(rows[row], x1)
    out.push({ c, i, x0, x1, row })
  }
  return { bars: out, rows: rows.length }
}

// Where each lane sits. Folded lanes are thin; the active one has room under
// it for its clips.
function layoutLanes(g, clipRows) {
  const top = RULER + 6
  const avail = g.h - top - 4
  const activeH = LANE + clipRows * CLIP_ROW
  const full = D.branches.length * LANE + clipRows * CLIP_ROW
  const fold = D.branches.length > 4 || full > avail
  const lanes = new Map()
  let y = top
  for (const b of D.branches) {
    const active = b.id === D.activeId
    const thin = fold && !active
    const pitch = thin ? THIN : active ? activeH : LANE
    lanes.set(b.id, { y: Math.round(thin ? y + THIN / 2 : y + 11) + 0.5, thin })
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

function ruler(g, s) {
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
    out += `<line class="tick${isMajor ? " major" : ""}" x1="${x}" x2="${x}" y1="${RULER - (isMajor ? 7 : 3)}" y2="${RULER - 0.5}"/>`
    if (isMajor) out += `<text class="tlabel" x="${x + 3}" y="${RULER - 8}">${label(t)}</text>`
  }
  return out
}

// ---- drawing ----------------------------------------------------------------------

const MARK_GLYPH = {
  click: (x, y) => `<line class="mk" x1="${x}" x2="${x}" y1="${y - 5}" y2="${y}"/>`,
  key: (x, y) => `<line class="mk" x1="${x}" x2="${x}" y1="${y - 5}" y2="${y}"/><circle class="mk-dot" cx="${x}" cy="${y - 6.5}" r="1"/>`,
  input: (x, y) => `<line class="mk" x1="${x}" x2="${x}" y1="${y - 3}" y2="${y}"/>`,
  submit: (x, y) => `<rect class="mk-dot" x="${x - 1.5}" y="${y - 5}" width="3" height="3"/>`,
  route: (x, y) => `<path class="mk-dot" d="M${x} ${y - 6} l2 2 -2 2 -2 -2z"/>`,
  fetch: (x, y) => `<circle class="mk-dot" cx="${x}" cy="${y - 3.5}" r="1.5"/>`,
  reload: (x, y) => `<line class="mk" x1="${x}" x2="${x}" y1="${y - 8}" y2="${y}"/>`,
}

const NOTE_FILL = { pending: "var(--amber)", acknowledged: "var(--blue)", resolved: "var(--green)", dismissed: "var(--dim)" }


function renderTimeline(s, shownT) {
  const g = geom()
  if (!g.w || !g.h) return
  stepView(s)
  const active = activeBranch()
  const activeEnd = Math.max(active.end, s.end)
  const tl = timeline()
  const clips = tl.clips.map((c, i) => ({ c, i })).filter(({ c }) => (c.end == null ? s.end : c.end) >= active.forkAt && c.start <= activeEnd)
  const packed = packClips(clips, g, s)
  D.clipBars = packed.bars
  const lanes = layoutLanes(g, packed.rows)
  D.lanes = lanes
  D.clipRows = packed.rows
  const A = lanes.get(active.id)
  const xNow = r1(xOf(shownT, g))

  let out = `<clipPath id="wb-past"><rect x="-4000" y="0" width="${xNow + 4000}" height="${g.h}"/></clipPath>`
  out += ruler(g, s)
  if (D.hoverX != null && D.dragT == null) out += `<line class="hover-line" x1="${D.hoverX}" x2="${D.hoverX}" y1="${RULER}" y2="${g.h}"/>`

  // Lanes: the others first, then the active one on top.
  for (const b of D.branches) {
    if (b.id === D.activeId) continue
    const L = lanes.get(b.id)
    const d = lanePath(b, g, lanes, s, b.end)
    const p = growth(b)
    const grow = p < 0.999 ? ` pathLength="1" stroke-dasharray="${p.toFixed(3)} 2"` : ""
    out += `<path class="lane${L.thin ? " thin" : ""}"${grow} d="${d}"/>`
    out += `<path class="lane hit" data-branch="${b.id}" d="${d}"><title>${esc(b.name)}</title></path>`
  }
  const d = lanePath(active, g, lanes, s, activeEnd)
  const p = growth(active)
  const grow = p < 0.999 ? ` pathLength="1" stroke-dasharray="${p.toFixed(3)} 2"` : ""
  out += `<path class="lane active ahead"${grow} d="${d}"/>`
  out += `<path class="lane active"${grow} clip-path="url(#wb-past)" d="${d}"/>`
  out += `<path class="lane hit" data-branch="${active.id}" data-active="1" d="${d}"/>`
  const xEnd = r1(xOf(activeEnd, g))
  if (xEnd - xNow > 6) out += `<circle class="lane-end active" cx="${xEnd}" cy="${A.y}" r="2.5"><title>Last recorded</title></circle>`

  // Clips under the active lane.
  for (const bar of packed.bars) {
    const y = A.y + 5 + bar.row * CLIP_ROW
    const isHot = D.hot && D.hot.kind === "clip" && D.hot.i === bar.i
    const cls = `clip${bar.c.end == null ? " running" : ""}${isHot ? " hot" : ""}`
    out += `<rect class="${cls}" x="${r1(bar.x0)}" y="${y}" width="${r1(bar.x1 - bar.x0)}" height="2"/>`
    out += `<rect class="clip-hit" data-clip="${bar.i}" x="${r1(bar.x0)}" y="${y - 0.5}" width="${r1(Math.max(4, bar.x1 - bar.x0))}" height="${CLIP_ROW}"/>`
  }

  // Markers above it.
  tl.markers.forEach((m, i) => {
    if (m.t < active.forkAt - 1 || m.t > activeEnd + 1) return
    const x = r1(xOf(m.t, g)) + 0.5
    const glyph = (MARK_GLYPH[m.kind] || MARK_GLYPH.click)(x, A.y - 3)
    const isHot = D.hot && D.hot.kind === "mark" && D.hot.i === i
    out += isHot ? glyph.replace(/class="(mk[-\w]*)"/g, 'class="$1 hot"') : glyph
    out += `<rect class="mk-hit" data-mark="${i}" x="${x - 3.5}" y="${A.y - 11}" width="7" height="9"/>`
  })

  // Bookmarks, on the ruler.
  for (const m of D.markers) {
    if (m.branchId !== D.activeId) continue
    const x = r1(xOf(m.t, g))
    out += `<path class="bookmark" data-bookmark="${m.id}" d="M${x - 3} ${RULER - 1} l3 -4 3 4z"><title>Bookmark · ${fmt(m.t - s.start)}</title></path>`
  }

  // Playhead.
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
      out += `<g class="note-mark" data-note="${n.id}"><circle cx="${x}" cy="${L.y}" r="2" fill="${fill}"/><title>${esc(n.text)}</title></g>`
      return
    }
    const label = String(i + 1)
    const w = 6 + label.length * 5
    out += `<g class="note-mark" data-note="${n.id}" transform="translate(${x} ${L.y - 7})">
      <rect x="${-w / 2}" y="-6" width="${w}" height="11" rx="2" fill="${fill}" stroke="var(--bg)"/>
      <text x="0" y="2.5" text-anchor="middle" fill="var(--bg)">${label}</text><title>${esc(n.text)}</title></g>`
  })
  setSvg(out)
  renderGutter(lanes)

  // The + that starts a new timeline, offered on the active lane in the past.
  const showPlus = D.hoverT != null && D.dragT == null && pendingFork == null && !isInteractive(s)
  plus.hidden = !showPlus
  if (showPlus) {
    plus.style.left = xOf(D.hoverT, g) + "px"
    // Below the clip rows, so it never covers a clip.
    plus.style.top = A.y + 16 + packed.rows * CLIP_ROW + "px"
  }
  checkPendingFork(s)
}

function setSvg(markup) {
  if (markup === svgKey) return
  svgKey = markup
  svg.innerHTML = markup
}

// Lane names, in the gutter beside their lanes.
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
      const cls = `lane-name${b.id === D.activeId ? " active" : ""}${L.thin ? " thin" : ""}`
      return `<div class="${cls}" data-lane="${b.id}" style="top:${L.y}px" title="${esc(b.name)} · double-click to rename">${esc(b.name)}</div>`
    })
    .join("")
}

// ---- the header ---------------------------------------------------------------------

function phaseOf(s) {
  if (D.dragT != null || s.previewing) return "SCRUBBING"
  if (D.building) return `BUILDING${buildProgress()}`
  if (s.seeking) return "LOADING"
  if (s.playing) return s.future ? "PLAYING" : "LIVE"
  return "PAUSED"
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
  readoutPhase.textContent = phase
  readoutPhase.classList.toggle("past", phase !== "LIVE" && !isInteractive(s))
  playBtn.classList.toggle("playing", !!s.playing && D.dragT == null)
  playBtn.setAttribute("aria-label", s.playing ? "Pause" : "Play")
  if (performance.now() < flashUntil) return
  hintEl.classList.remove("warn")
  const past = s.started && !isInteractive(s)
  const text = past
    ? s.future || s.previewing || D.dragT != null
      ? "Viewing the past · press <kbd>+</kbd> to try something else from here"
      : "Paused · press <kbd>space</kbd> to go on"
    : ""
  if (hintEl.innerHTML !== text) hintEl.innerHTML = text
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

function forkNow() {
  D.PT.pause()
  D.PT.forkHere()
  // The new timeline is live from here.
  D.PT.record()
}

function checkPendingFork(s) {
  if (pendingFork == null || D.building || !D.PT || s.seeking || s.previewing) return
  if (Math.abs(s.now - pendingFork) > 40) return
  pendingFork = null
  forkNow()
}
