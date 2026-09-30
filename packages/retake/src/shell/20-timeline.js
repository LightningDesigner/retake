// The timeline, drawn on one canvas. A ruler on top; under it one lane per
// timeline, each in its own colour. A timeline made by Control-clicking the
// track grows out of its parent's lane at the moment it split, along a short
// curve. The active lane is in full colour (dimmer over its recorded future);
// the others are the same hue, faint, and show only their line.
//
// What's drawn on the active lane, in three layers:
//  1. your actions: small blue marks (clicks, keys, submits, routes); a burst
//     of typing is one short blue bar.
//  2. a quiet waveform of how much the screen changed (timeline().activity),
//     just under the lane: steady ambient motion is nearly flat, real changes
//     are bumps.
//  3. on demand, while ⌘ is held over an element in the app: that element's
//     own animations, as bright capsules ("lens"); everything else dims.
//
// The view is a window of time [from, to], never starting before the
// recording. While playing, it follows: the playhead stays near the right
// edge and the track scrolls with time. Zooming or scrolling by hand stops
// that ("Live →" brings it back). Paused, nothing moves by itself.
// Drawing only happens when something visible changed.

const PAD_L = 12
const PAD_R = 18
const RULER = 20 // ruler height
const LANE = 32 // row height
const MIN_PITCH = 10 // lanes closer than this can't be told apart
const BEND = 18 // how far a new lane travels to reach its row
const GROW_MS = 250
const FOLLOW_AT = 0.85 // where the playhead sits while following
const WAVE_H = 10 // waveform height under the active lane

// One colour per timeline, by id: distinct on dark glass, none of them the
// blue of actions or the amber of notes.
const TL_COLORS = ["#a78bfa", "#2dd4bf", "#f472b6", "#bef264", "#fb923c", "#f87171"]
const colorOf = (b) => TL_COLORS[((b ? b.id : 1) - 1) % TL_COLORS.length]
const INK = { blue: "#60a5fa", white: "#ffffff", dim: "rgba(255,255,255,0.4)", faint: "rgba(255,255,255,0.16)", hair: "rgba(255,255,255,0.08)", page: "#16161a", lens: "#fde68a" }
const NOTE_FILL = { pending: "#ffb224", acknowledged: "#60a5fa", resolved: "#4cc38a", dismissed: "rgba(255,255,255,0.4)" }
const MONO = '10px "Geist Mono", ui-monospace, "SF Mono", Menlo, monospace'

const tip = $("#wb-tip")
const gutter = $(".gutter")
const liveBtn = $(".live-btn")
const readoutT = $(".readout .t")
const readoutPhase = $(".readout .phase")
const hintEl = $(".hint")
const playBtn = $('[data-a="play"]')
const ctx = cv.getContext("2d")

// ---- the view ---------------------------------------------------------------------

// fit: show everything; followSpan: the window's width while following;
// detached: the user moved the view while it was following.
D.view = { from: 0, to: 1000, fit: true, target: null, at: 0, followSpan: 20000, detached: false, wasPlaying: false }
let sceneKey = ""
let pendingFork = null
let flashUntil = 0

// Everything recorded, on every timeline, from its first moment.
function fullRange(s) {
  let end = s.end
  for (const b of D.branches) end = Math.max(end, b.id === D.activeId ? Math.max(b.end, s.end) : b.end)
  const len = Math.max(end - s.start, 1000)
  return { from: s.start, to: s.start + len * 1.03 }
}

// While following: the playhead at FOLLOW_AT of the width, or, early on, the
// recording from its start.
function followRange(s, now) {
  // Early on the window only grows to fit (the playhead at FOLLOW_AT of it);
  // once it reaches the chosen width, the track scrolls.
  const span = clamp((now - s.start) / FOLLOW_AT, 2000, D.view.followSpan)
  let to = now + span * (1 - FOLLOW_AT)
  let from = to - span
  if (from < s.start) {
    from = s.start
    to = from + span
  }
  return { from, to }
}

// The start of the recording is pinned: the view never begins before it.
function pinStart(v, s) {
  if (!s || v.from >= s.start) return v
  return { from: s.start, to: s.start + (v.to - v.from) }
}

// The user set the view (zoom, pan, fit a clip): stop following.
function setView(from, to, { animate = true } = {}) {
  const span = Math.max(to - from, 20)
  const mid = (from + to) / 2
  const r = pinStart({ from: mid - span / 2, to: mid + span / 2 }, D.last)
  D.view.fit = false
  D.view.followSpan = r.to - r.from
  if (D.last && D.last.playing) D.view.detached = true
  if (animate) D.view.target = r
  else {
    D.view.from = r.from
    D.view.to = r.to
    D.view.target = null
  }
}
function fitAll() {
  D.view.fit = true
  D.view.detached = false
  if (D.last) D.view.followSpan = Math.max(4000, fullRange(D.last).to - D.last.start)
}
function fitRange(a, b) {
  const pad = Math.max((b - a) * 0.15, 10)
  setView(a - pad, b + pad)
}
function followLive() {
  D.view.detached = false
  D.view.fit = false
}

// Where the view is going this frame, then eased toward it in ~200ms (a
// followed view moves with time exactly, so it stays smooth).
function stepView(s) {
  const now = performance.now()
  const dt = Math.min(64, now - (D.view.at || now))
  D.view.at = now
  const v = D.view
  // Started playing: follow again. Paused: stay exactly where it is.
  if (s.playing && !v.wasPlaying) v.detached = false
  if (!s.playing && v.wasPlaying) {
    v.fit = false
    v.target = null
  }
  v.wasPlaying = !!s.playing
  const following = s.playing && !v.detached && D.dragT == null
  if (following) v.target = followRange(s, s.now)
  else if (v.fit) v.target = fullRange(s)
  const t = v.target
  if (!t) {
    const p = pinStart(v, s)
    v.from = p.from
    v.to = p.to
    return
  }
  const span = v.to - v.from
  const k = following && Math.abs(t.to - t.from - span) < 1 ? 1 : 1 - Math.exp(-dt / 45)
  v.from += (t.from - v.from) * k
  v.to += (t.to - v.to) * k
  if (Math.abs(t.from - v.from) < span / 4000 && Math.abs(t.to - v.to) < span / 4000) {
    v.from = t.from
    v.to = t.to
    if (!v.fit && !following) v.target = null
  }
}

const geom = () => {
  const r = cv.getBoundingClientRect()
  return { w: r.width, h: r.height, left: r.left, top: r.top }
}
const innerW = (g) => Math.max(1, g.w - PAD_L - PAD_R)
const pxPerMs = (g) => innerW(g) / (D.view.to - D.view.from)
const xOf = (t, g) => clamp(PAD_L + (t - D.view.from) * pxPerMs(g), -4000, g.w + 4000)
const timeAt = (clientX, g = geom()) => D.view.from + (clientX - g.left - PAD_L) / pxPerMs(g)
const r1 = (n) => Math.round(n * 10) / 10

// ---- lanes ------------------------------------------------------------------------

// Where each lane sits: rows from right under the ruler, any spare height
// below them. When they don't fit at full height, they close up evenly
// ("compact": names become dots).
function layoutLanes(g) {
  const avail = g.h - RULER - 4
  const n = D.branches.length
  const compact = n * LANE > avail
  const pitch = compact ? Math.max(MIN_PITCH, Math.floor(avail / n)) : LANE
  D.compact = compact
  const lanes = new Map()
  let y = RULER + 4
  for (const b of D.branches) {
    lanes.set(b.id, { y: Math.round(y + pitch / 2) + 0.5, thin: compact })
    y += pitch
  }
  return lanes
}

const growth = (b) => {
  const p = clamp((performance.now() - b.born) / GROW_MS, 0, 1)
  return 1 - Math.pow(1 - p, 3)
}

// A lane: straight from its start, or out of its parent's lane at the exact
// moment it split, along a short curve, then along its own row.
function laneShape(b, g, lanes, s, until) {
  const L = lanes.get(b.id)
  const parent = branchById(b.parentId)
  const x1 = xOf(until, g)
  if (!parent || !lanes.get(parent.id)) {
    const x0 = xOf(b.parentId ? b.forkAt : s.start, g)
    return { x0, py: L.y, xb: x0, y: L.y, x1: Math.max(x1, x0 + 0.5) }
  }
  const x0 = xOf(b.forkAt, g)
  return { x0, py: lanes.get(parent.id).y, xb: x0 + BEND, y: L.y, x1: Math.max(x1, x0 + BEND) }
}
function tracePath(p) {
  ctx.beginPath()
  ctx.moveTo(p.x0, p.py)
  if (p.xb !== p.x0) ctx.bezierCurveTo(p.x0 + BEND * 0.55, p.py, p.xb - BEND * 0.55, p.y, p.xb, p.y)
  ctx.lineTo(p.x1, p.y)
}
// Drawn partway while it grows (the first 250ms of a new timeline).
function strokeLane(p, color, alpha, width, grow = 1) {
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.lineCap = "round"
  if (grow < 0.999) {
    const len = Math.abs(p.xb - p.x0) + Math.abs(p.y - p.py) + (p.x1 - p.xb)
    ctx.setLineDash([len * grow, len * 2])
  }
  tracePath(p)
  ctx.stroke()
  ctx.restore()
}

// ---- the ruler --------------------------------------------------------------------

const STEPS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 15000, 30000, 60000, 120000, 300000, 600000]

function drawRuler(g, s, xNow) {
  const ppm = pxPerMs(g)
  const major = STEPS.find((st) => st * ppm >= 72) || STEPS[STEPS.length - 1]
  const minor = STEPS.slice().reverse().find((st) => st < major && major % st === 0 && st * ppm >= 7) || major
  const dec = major >= 1000 ? 0 : major >= 100 ? 1 : major >= 10 ? 2 : 3
  const label = (t) => {
    const ms = t - s.start
    if (major >= 60000) return `${Math.floor(ms / 60000)}:${String(Math.round((ms % 60000) / 1000)).padStart(2, "0")}`
    return (ms / 1000).toFixed(dec) + "s"
  }
  ctx.fillStyle = INK.hair
  ctx.fillRect(0, RULER - 1, g.w, 1)
  ctx.font = MONO
  ctx.textBaseline = "alphabetic"
  const labels = []
  const first = Math.ceil((D.view.from - s.start) / minor) * minor + s.start
  for (let t = first, n = 0; t <= D.view.to && n < 800; t += minor, n++) {
    const rel = Math.round(t - s.start)
    if (rel < 0) continue
    const x = Math.round(xOf(t, g)) + 0.5
    const isMajor = rel % major === 0
    ctx.fillStyle = isMajor ? INK.dim : INK.faint
    ctx.fillRect(x - 0.5, RULER - (isMajor ? 6 : 3), 1, isMajor ? 5 : 2)
    // A label the playhead's cap would sit on is left out.
    if (isMajor && !(x + 3 < xNow + 8 && x + 36 > xNow - 8)) {
      ctx.fillStyle = INK.dim
      ctx.fillText(label(t), x + 3, RULER - 8)
      labels.push(label(t))
    }
  }
  return labels
}

// ---- layers on the active lane ---------------------------------------------------

// Things you did: blue. The app's own doings (fetches, reloads) aren't shown.
const ACTION_KINDS = new Set(["click", "key", "input", "submit", "route"])

// First marker at or after t (markers are in time order).
function firstFrom(list, t) {
  let lo = 0
  let hi = list.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (list[mid].t < t) lo = mid + 1
    else hi = mid
  }
  return lo
}

function drawActions(g, markers, y, lo, hi, dim) {
  const out = []
  const from = D.view.from - 2000 // a typing bar can start before the view
  ctx.save()
  ctx.globalAlpha = dim ? 0.35 : 1
  ctx.fillStyle = INK.blue
  for (let i = firstFrom(markers, from); i < markers.length; i++) {
    const m = markers[i]
    if (m.t > D.view.to) break
    if (!ACTION_KINDS.has(m.kind) || m.t < lo - 1 || m.t > hi + 1) continue
    const x = xOf(m.t, g)
    if (m.kind === "input" && m.end != null && m.end > m.t) {
      // A burst of typing: one short bar.
      const x1 = Math.max(x + 3, xOf(m.end, g))
      if (x1 < 0 || x > g.w) continue
      roundRect(x, y - 1.5, x1 - x, 3, 1.5)
      ctx.fill()
      out.push({ i, kind: "typing", x, x1 })
    } else {
      if (x < -4 || x > g.w + 4) continue
      ctx.beginPath()
      ctx.arc(x, y, 2.5, 0, Math.PI * 2)
      ctx.fill()
      out.push({ i, kind: m.kind, x })
    }
  }
  ctx.restore()
  return out
}

// timeline().activity: { step, values[, t0] } (0..1 per step of `step` ms
// from t0, or from the recording's start). Anything else: nothing drawn.
function activityOf(tl, s) {
  const a = tl.activity
  if (!a || !Array.isArray(a.values) || !(a.step > 0)) return null
  return { step: a.step, values: a.values, t0: a.t0 != null ? a.t0 : s.start }
}

// A filled waveform under the lane, the max of each pixel's slice of time.
function drawWave(g, act, y, color, lo, hi, dim) {
  const xa = Math.max(0, Math.floor(xOf(Math.max(lo, act.t0), g)))
  const xb = Math.min(g.w, Math.ceil(xOf(Math.min(hi, act.t0 + act.values.length * act.step), g)))
  if (xb <= xa) return 0
  const top = y + 3
  ctx.save()
  ctx.globalAlpha = dim ? 0.12 : 0.3
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.moveTo(xa, top)
  let cols = 0
  for (let x = xa; x <= xb; x++) {
    const i0 = Math.max(0, Math.floor((timeAt(x + geom().left) - act.t0) / act.step))
    const i1 = Math.min(act.values.length - 1, Math.floor((timeAt(x + 1 + geom().left) - act.t0) / act.step))
    let v = 0
    for (let i = i0; i <= i1; i++) v = Math.max(v, act.values[i] || 0)
    ctx.lineTo(x, top + clamp(v, 0, 1) * WAVE_H)
    cols++
  }
  ctx.lineTo(xb, top)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
  return cols
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath()
  ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h)
}

// The lens: the hovered element's own animations, as bright capsules.
function drawLens(g, clips, y) {
  const out = []
  ctx.save()
  ctx.font = '500 10px Geist, ui-sans-serif, system-ui, sans-serif'
  ctx.textBaseline = "middle"
  for (const c of clips) {
    const end = c.end == null ? (D.last ? D.last.end : c.start) : c.end
    if (end < D.view.from || c.start > D.view.to) continue
    const x0 = xOf(c.start, g)
    const x1 = Math.max(x0 + 6, xOf(end, g))
    ctx.fillStyle = INK.lens
    roundRect(x0, y - 7, x1 - x0, 14, 7)
    ctx.fill()
    const label = `${clipName(c)} · ${msWord(end - c.start)}`
    if (ctx.measureText(label).width + 12 <= x1 - x0) {
      ctx.fillStyle = INK.page
      ctx.fillText(label, x0 + 6, y + 0.5)
    }
    out.push({ clip: c, x0, x1, y })
  }
  ctx.restore()
  return out
}

// ---- drawing ------------------------------------------------------------------------

function sizeCanvas(g) {
  const dpr = window.devicePixelRatio || 1
  const W = Math.round(g.w * dpr)
  const H = Math.round(g.h * dpr)
  if (cv.width !== W || cv.height !== H) {
    cv.width = W
    cv.height = H
    sceneKey = ""
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
}

function renderTimeline(s, shownT) {
  const g = geom()
  if (!g.w || !g.h) return
  stepView(s)
  const active = activeBranch()
  const activeEnd = Math.max(active.end, s.end)
  const tl = timeline()
  const lanes = layoutLanes(g)
  D.lanes = lanes
  renderGutter(lanes)
  const following = s.playing && !D.view.detached
  liveBtn.hidden = !(s.playing && !s.future && D.view.detached)
  checkPendingFork(s)

  const lensClips = D.lens ? D.lens.clips : null
  const growing = D.branches.some((b) => performance.now() - b.born < GROW_MS + 20)
  const act = activityOf(tl, s)
  // Only draw when something that shows has changed.
  const key = [
    g.w, g.h, D.view.from.toFixed(2), D.view.to.toFixed(2), shownT.toFixed(2), D.activeId, activeEnd.toFixed(1),
    D.branches.map((b) => `${b.id}.${b.end.toFixed(0)}.${b.forkAt}`).join(","),
    tl.markers.length, act ? act.values.length : -1, D.notes.map((n) => `${n.id}.${n.status}.${n.branchId}`).join(","),
    D.markers.length, lensClips ? D.lens.key : "", D.branchT, D.snapT, D.dragT, growing ? performance.now() : 0,
  ].join("|")
  if (key === sceneKey) return
  sceneKey = key
  const t0 = performance.now()
  sizeCanvas(g)
  ctx.clearRect(0, 0, g.w, g.h)
  const xNow = Math.round(xOf(shownT, g))
  const labels = drawRuler(g, s, xNow)
  const dim = !!lensClips
  const scene = { lanes: [], actions: [], waveCols: 0, capsules: [], notes: [], bookmarks: [], labels, following }

  // Lanes: the others first, faint in their colours; then the active one.
  for (const b of D.branches) {
    if (b.id === D.activeId) continue
    const p = laneShape(b, g, lanes, s, b.end)
    strokeLane(p, colorOf(b), dim ? 0.15 : 0.3, D.compact ? 1.5 : 2, growth(b))
    scene.lanes.push({ id: b.id, y: p.y, x0: p.x0, x1: p.x1, color: colorOf(b), active: false })
  }
  const color = colorOf(active)
  const A = lanes.get(active.id)
  const p = laneShape(active, g, lanes, s, activeEnd)
  const lo = active.forkAt
  if (act) scene.waveCols = drawWave(g, act, A.y, color, lo, activeEnd, dim)
  // Past full, recorded future dimmer.
  strokeLane(p, color, dim ? 0.2 : 0.45, 2, growth(active))
  ctx.save()
  ctx.beginPath()
  ctx.rect(-10, 0, xNow + 10, g.h)
  ctx.clip()
  strokeLane(p, color, dim ? 0.45 : 1, 2, growth(active))
  ctx.restore()
  scene.lanes.push({ id: active.id, y: p.y, x0: p.x0, x1: p.x1, color, active: true })
  const xEnd = xOf(activeEnd, g)
  if (xEnd - xNow > 6 && xEnd < g.w) {
    ctx.fillStyle = INK.page
    ctx.strokeStyle = color
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.arc(xEnd, A.y, 3, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
  }
  scene.actions = drawActions(g, tl.markers, A.y, lo, activeEnd, dim)
  if (lensClips) scene.capsules = drawLens(g, lensClips, A.y)

  // Bookmarks, on the ruler.
  ctx.fillStyle = "#f2f2f5"
  for (const m of D.markers) {
    if (m.branchId !== D.activeId || m.t < D.view.from || m.t > D.view.to) continue
    const x = xOf(m.t, g)
    ctx.beginPath()
    ctx.moveTo(x - 3, RULER - 1)
    ctx.lineTo(x, RULER - 5)
    ctx.lineTo(x + 3, RULER - 1)
    ctx.fill()
    scene.bookmarks.push({ id: m.id, x })
  }

  // Control held over the track: where a click would branch the active
  // timeline, in its colour, with the time.
  if (D.branchT != null && D.dragT == null && pendingFork == null) {
    const xg = Math.round(xOf(D.branchT, g)) + 0.5
    ctx.fillStyle = color
    ctx.fillRect(xg - 0.5, RULER, 1, g.h - RULER)
    const lx = clamp(xg + 6, 2, g.w - 58)
    roundRect(lx, RULER + 3, 54, 14, 7)
    ctx.fill()
    ctx.fillStyle = INK.page
    ctx.font = '500 9px "Geist Mono", ui-monospace, Menlo, monospace'
    ctx.textAlign = "center"
    ctx.fillText(fmt(D.branchT - s.start), lx + 27, RULER + 13)
    ctx.textAlign = "start"
    scene.guide = { x: xg, t: D.branchT }
  }

  // Playhead.
  ctx.fillStyle = INK.white
  ctx.fillRect(xNow, 0, 1, g.h)
  ctx.beginPath()
  ctx.moveTo(xNow - 4, 0)
  ctx.lineTo(xNow + 5, 0)
  ctx.lineTo(xNow + 5, 4)
  ctx.lineTo(xNow + 0.5, 8)
  ctx.lineTo(xNow - 4, 4)
  ctx.fill()
  scene.playhead = xNow
  if (D.snapT != null && D.dragT != null) {
    const xs = Math.round(xOf(D.snapT, g)) + 0.5
    ctx.save()
    ctx.strokeStyle = INK.white
    ctx.setLineDash([1, 2])
    ctx.beginPath()
    ctx.moveTo(xs, RULER)
    ctx.lineTo(xs, g.h)
    ctx.stroke()
    ctx.restore()
  }

  // Notes, last, so they stay on top. A note made before its timeline split
  // off sits on the parent's lane, where that moment is drawn.
  D.notes.forEach((n, i) => {
    let b = branchById(n.branchId)
    while (b && b.parentId && n.t < b.forkAt - 30) b = branchById(b.parentId)
    const L = b && lanes.get(b.id)
    if (!L || n.t < D.view.from || n.t > D.view.to) return
    const x = xOf(n.t, g)
    ctx.fillStyle = NOTE_FILL[n.status] || NOTE_FILL.pending
    if (L.thin) {
      ctx.beginPath()
      ctx.arc(x, L.y, 3, 0, Math.PI * 2)
      ctx.fill()
      scene.notes.push({ id: n.id, x, y: L.y, r: 5 })
      return
    }
    const label = String(i + 1)
    const w = 8 + label.length * 5
    roundRect(x - w / 2, L.y - 17, w, 12, 6)
    ctx.fill()
    ctx.fillStyle = INK.page
    ctx.font = '600 8px "Geist Mono", ui-monospace, Menlo, monospace'
    ctx.textAlign = "center"
    ctx.fillText(label, x, L.y - 8)
    ctx.textAlign = "start"
    scene.notes.push({ id: n.id, x, y: L.y - 11, r: 7 })
  })
  scene.drawMs = performance.now() - t0
  D.scene = scene
  D.draws = (D.draws || 0) + 1
}

// What's under a point on the track: a note, a lens capsule, a bookmark, or
// a lane (by id).
function hitAt(clientX, clientY) {
  const g = geom()
  const x = clientX - g.left
  const y = clientY - g.top
  const sc = D.scene
  if (!sc) return null
  for (const n of sc.notes) if (Math.abs(x - n.x) <= n.r && Math.abs(y - n.y) <= n.r) return { kind: "note", id: n.id }
  for (const c of sc.capsules) if (x >= c.x0 - 2 && x <= c.x1 + 2 && Math.abs(y - c.y) <= 8) return { kind: "capsule", clip: c.clip }
  if (y < RULER) for (const b of sc.bookmarks) if (Math.abs(x - b.x) <= 5) return { kind: "bookmark", id: b.id }
  let best = null
  for (const l of sc.lanes) {
    const d = Math.abs(y - l.y)
    if (d <= 8 && x >= l.x0 - 4 && x <= l.x1 + 4 && (!best || d < best.d)) best = { kind: "lane", id: l.id, active: l.active, d }
  }
  return best
}

// Lane names, in the gutter beside their lanes, each with its colour.
let gutterKey = ""
const invalidateGutter = () => (gutterKey = "")
function renderGutter(lanes) {
  if (gutter.querySelector("input")) return // renaming
  const key = D.compact + D.branches.map((b) => `${b.id}:${b.name}:${lanes.get(b.id).y}:${b.id === D.activeId}`).join("|")
  if (key === gutterKey) return
  gutterKey = key
  // Short dock: just the colour dots (the name shows on hover).
  gutter.classList.toggle("dots", !!D.compact)
  gutter.innerHTML = D.branches
    .map((b) => {
      const L = lanes.get(b.id)
      const on = b.id === D.activeId
      const cls = `lane-name${on ? " active" : ""}`
      const title = D.compact ? ` title="${esc(b.name)}"` : ""
      return `<div class="${cls}" data-lane="${b.id}" style="top:${L.y}px;--c:${colorOf(b)}"${title}><i></i><span>${esc(b.name)}</span></div>`
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
  // The hint area is only for a short warning (see flash()).
  if (performance.now() < flashUntil) return
  if (hintEl.textContent) hintEl.textContent = ""
  hintEl.classList.remove("show", "warn")
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
