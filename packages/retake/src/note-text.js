// A note as text for a coding agent, written once for both readers: the dock's
// "Copy for agent" (core.js inlines this file into the dock, `export`s
// stripped) and `retake mcp` (get_note, get_animation, list_notes). Plain
// functions, no DOM, no Node.
//
// The words it uses (CONTRACT.md "Note"):
//   recording time  ms on the recording's clock, shown as 00:01.23 from its start
//   local time      ms on one animation's own clock: 0 = the end of its delay
//   progress        local / duration (0-1, linear); eased = after the effect's easing
//   segment         the two keyframes the eased progress is between
// Keyframe offsets apply to the eased progress, so a keyframe's local time goes
// through the inverse of the effect's easing (localOfOffset).

const FRAME = 1000 / 60

/** ms → "00:10.91" */
const clockText = (ms) => {
  const s = Math.max(0, Number(ms) || 0) / 1000
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${(s % 60).toFixed(2).padStart(5, "0")}`
}
/** ms → "200ms" / "1210ms" (local times stay in ms: what CSS, WAAPI and Motion write) */
const msText = (ms) => `${Math.round(Number(ms) || 0)}ms`
const num = (v, d = 2) => {
  const n = Number(v)
  if (!Number.isFinite(n)) return String(v)
  const s = n.toFixed(d)
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") || "0" : s
}
const pct = (p) => `${num((Number(p) || 0) * 100, 1)}%`
const kebab = (p) => String(p).replace(/[A-Z]/g, (c) => "-" + c.toLowerCase()).replace(/^webkit-/, "-webkit-")

// ---- easing -------------------------------------------------------------------------
// CSS easing functions, evaluated without a browser (the MCP server has none):
// linear, ease*, cubic-bezier(), steps(), step-start/end, linear(…).

const NAMED = { ease: [0.25, 0.1, 0.25, 1], "ease-in": [0.42, 0, 1, 1], "ease-out": [0, 0, 0.58, 1], "ease-in-out": [0.42, 0, 0.58, 1] }

function bezier(x1, y1, x2, y2) {
  const at = (a, b, t) => 3 * a * (1 - t) * (1 - t) * t + 3 * b * (1 - t) * t * t + t * t * t
  return (x) => {
    if (x <= 0) return 0
    if (x >= 1) return 1
    let lo = 0
    let hi = 1
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2
      if (at(x1, x2, mid) < x) lo = mid
      else hi = mid
    }
    return at(y1, y2, (lo + hi) / 2)
  }
}

function steps(n, pos) {
  const jumps = pos === "jump-none" ? n - 1 : pos === "jump-both" ? n + 1 : n
  const start = pos === "start" || pos === "jump-start" || pos === "jump-both"
  return (x) => {
    if (x >= 1) return 1
    let step = Math.floor(x * n)
    if (start) step += 1
    return Math.min(Math.max(step / Math.max(jumps, 1), 0), 1)
  }
}

// linear(0, 0.25 40%, 1): points with optional input percentages.
function linearFn(body) {
  const pts = []
  for (const part of body.split(/,(?![^(]*\))/)) {
    const bits = part.trim().split(/\s+/)
    const y = Number(bits[0])
    const xs = bits.slice(1).map((b) => parseFloat(b) / 100)
    if (!xs.length) pts.push({ y, x: null })
    for (const x of xs) pts.push({ y, x })
  }
  if (!pts.length) return (x) => x
  if (pts[0].x == null) pts[0].x = 0
  if (pts[pts.length - 1].x == null) pts[pts.length - 1].x = 1
  for (let i = 1; i < pts.length; i++) if (pts[i].x != null && pts[i].x < pts[i - 1].x) pts[i].x = pts[i - 1].x
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].x != null) continue
    let j = i
    while (pts[j].x == null) j++
    const a = pts[i - 1].x
    const step = (pts[j].x - a) / (j - i + 1)
    for (let k = i; k < j; k++) pts[k].x = a + step * (k - i + 1)
  }
  return (x) => {
    if (x <= pts[0].x) return pts[0].y
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]
      const b = pts[i]
      if (x <= b.x) return b.x === a.x ? b.y : a.y + ((x - a.x) / (b.x - a.x)) * (b.y - a.y)
    }
    return pts[pts.length - 1].y
  }
}

const easings = new Map()
/** An easing string → x ↦ y. Anything it can't read is linear. */
export function easingFn(easing) {
  const e = String(easing || "linear").trim()
  if (easings.has(e)) return easings.get(e)
  let fn = (x) => x
  let m
  if (NAMED[e]) fn = bezier(...NAMED[e])
  else if ((m = /^cubic-bezier\(([^)]*)\)$/.exec(e))) {
    const [a, b, c, d] = m[1].split(",").map(Number)
    if ([a, b, c, d].every(Number.isFinite)) fn = bezier(a, b, c, d)
  } else if ((m = /^steps\(\s*(\d+)\s*(?:,\s*([\w-]+)\s*)?\)$/.exec(e))) fn = steps(Number(m[1]), m[2] || "end")
  else if (e === "step-start") fn = steps(1, "start")
  else if (e === "step-end") fn = steps(1, "end")
  else if ((m = /^linear\((.*)\)$/.exec(e))) fn = linearFn(m[1])
  easings.set(e, fn)
  return fn
}
const isLinear = (e) => !e || e === "linear" || e === "linear(0, 1)" || e === "cubic-bezier(0, 0, 1, 1)"

// ---- an animation's own clock -----------------------------------------------------------

const iterCount = (t) => (t.iterations === "infinite" || t.iterations === Infinity ? Infinity : t.iterations == null ? 1 : Number(t.iterations))

/**
 * Where recording time T falls on the animation's own clock.
 * @param {any} anim { timing: { delay, duration, iterations, direction, easing, playbackRate, start, activeStart }, keyframes }
 * @param {number} T
 */
export function pointOf(anim, T) {
  const t = anim.timing || {}
  const rate = Number(t.playbackRate) || 1
  const delay = Number(t.delay) || 0
  const dur = Math.max(Number(t.duration) || 0, 0)
  const activeStart = t.activeStart != null ? Number(t.activeStart) : (Number(t.start) || 0) + delay / rate
  const iters = iterCount(t)
  const local = (T - activeStart) * rate
  const activeDur = dur * iters
  let phase = "active"
  let iteration = 0
  let iterLocal = local
  if (local < 0) {
    phase = "delay"
    iterLocal = 0
  } else if (local >= activeDur && Number.isFinite(activeDur)) {
    phase = "after"
    iteration = Math.max(0, Math.ceil(iters) - 1)
    iterLocal = activeDur - iteration * dur
  } else if (dur > 0) {
    iteration = Math.floor(local / dur)
    iterLocal = local - iteration * dur
  }
  const dir = t.direction || "normal"
  const reversed = dir === "reverse" || (dir === "alternate" && iteration % 2 === 1) || (dir === "alternate-reverse" && iteration % 2 === 0)
  const directed = reversed ? dur - iterLocal : iterLocal
  const progress = dur > 0 ? Math.min(Math.max(directed / dur, 0), 1) : 1
  const eased = easingFn(t.easing)(progress)
  return { T: Math.round(T * 10) / 10, local: Math.round(local * 10) / 10, iteration, phase, progress: round(progress, 4), eased: round(eased, 4), segment: segmentOf(anim.keyframes, eased) }
}
const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d

/** The keyframe pair an eased progress is between: { index, fromOffset, toOffset, easing, progress }. */
export function segmentOf(keyframes, eased) {
  const kf = (keyframes || []).filter((k) => k && k.offset != null)
  if (kf.length < 2) return null
  const x = Math.min(Math.max(eased, 0), 1)
  let i = 0
  while (i < kf.length - 2 && x >= kf[i + 1].offset) i++
  const a = kf[i].offset
  const b = kf[i + 1].offset
  const easing = kf[i].easing || "linear"
  return { index: i, fromOffset: a, toOffset: b, easing, progress: round(b > a ? (x - a) / (b - a) : 1, 4) }
}

/**
 * Numeric keyframe values at recording time T (Motion keyframes read off its
 * props: x, y, scale, rotate, opacity), through each segment's easing.
 * @returns {Record<string, string>}
 */
export function valuesAt(anim, T) {
  const p = pointOf(anim, T)
  const kf = (anim.keyframes || []).filter((k) => k && k.offset != null)
  const s = p.segment
  if (!s || kf.length < 2) return {}
  const a = kf[s.index].values || {}
  const b = kf[s.index + 1].values || {}
  const y = easingFn(s.easing)(Math.min(Math.max(s.progress, 0), 1))
  const out = {}
  for (const k of Object.keys(a)) {
    const va = Number(a[k])
    const vb = Number(b[k] != null ? b[k] : a[k])
    if (Number.isFinite(va) && Number.isFinite(vb)) out[k] = num(va + (vb - va) * y, 2)
  }
  return out
}

/** Local ms at which the effect reaches a keyframe offset (through the inverse of its easing; first iteration). */
export function localOfOffset(anim, offset) {
  const t = anim.timing || {}
  const dur = Number(t.duration) || 0
  const f = easingFn(t.easing)
  if (isLinear(t.easing)) return offset * dur
  let lo = 0
  let hi = 1
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2
    if (f(mid) < offset) lo = mid
    else hi = mid
  }
  return ((lo + hi) / 2) * dur
}

/** Recording time of a local time (first iteration). */
export const recordingOf = (anim, local) => {
  const t = anim.timing || {}
  const rate = Number(t.playbackRate) || 1
  const activeStart = t.activeStart != null ? Number(t.activeStart) : (Number(t.start) || 0) + (Number(t.delay) || 0) / rate
  return activeStart + local / rate
}

// ---- reading numbers the user typed ------------------------------------------------------
// "at 100ms", "200–400 ms", "between 200 and 400", "after 300", "from 1s to 1.5s",
// "20%–40%", "first 300ms", "last 200 ms". With a primary animation they are its
// local time; without, recording time from the note's moment.

const unitMs = (v, u) => (/^s/.test(u || "") && !/^ms/.test(u || "") ? Number(v) * 1000 : Number(v))
/**
 * @param {string} text
 * @param {any} [primary] the note's primary animation (with timing)
 * @returns {{ text: string, reading: "local" | "recording", from: number, to: number | null } | null}
 */
export function readAsked(text, primary) {
  const s = String(text || "")
  const N = "(\\d+(?:\\.\\d+)?)"
  const U = "\\s*(ms|milliseconds?|s|secs?|seconds?)?"
  const dur = primary && primary.timing ? Number(primary.timing.duration) || 0 : 0
  /** @type {"local" | "recording"} */
  const reading = primary ? "local" : "recording"
  const make = (m, from, to) => ({ text: m[0].trim(), reading, from: Math.round(from), to: to == null ? null : Math.round(to) })
  let m
  if ((m = new RegExp(`${N}\\s*%\\s*(?:-|–|—|to)\\s*${N}\\s*%`, "i").exec(s)) && dur) return make(m, (Number(m[1]) / 100) * dur, (Number(m[2]) / 100) * dur)
  if ((m = new RegExp(`between\\s+${N}${U}\\s+and\\s+${N}${U}`, "i").exec(s))) return make(m, unitMs(m[1], m[2] || m[4]), unitMs(m[3], m[4] || m[2]))
  if ((m = new RegExp(`from\\s+${N}${U}\\s+to\\s+${N}${U}`, "i").exec(s))) return make(m, unitMs(m[1], m[2] || m[4]), unitMs(m[3], m[4] || m[2]))
  if ((m = new RegExp(`${N}${U}\\s*(?:-|–|—|to)\\s*${N}${U}`, "i").exec(s)) && (m[2] || m[4])) return make(m, unitMs(m[1], m[2] || m[4]), unitMs(m[3], m[4] || m[2]))
  if ((m = new RegExp(`first\\s+${N}${U}`, "i").exec(s))) return make(m, 0, unitMs(m[1], m[2]))
  if ((m = new RegExp(`last\\s+${N}${U}`, "i").exec(s)) && dur) return make(m, dur - unitMs(m[1], m[2]), dur)
  if ((m = new RegExp(`after\\s+${N}\\s*%`, "i").exec(s)) && dur) return make(m, (Number(m[1]) / 100) * dur, dur)
  if ((m = new RegExp(`after\\s+${N}${U}`, "i").exec(s)) && (m[2] || primary)) return make(m, unitMs(m[1], m[2]), dur || null)
  if ((m = new RegExp(`at\\s+${N}\\s*%`, "i").exec(s)) && dur) return make(m, (Number(m[1]) / 100) * dur, null)
  if ((m = new RegExp(`(?:at|@)\\s*${N}${U}`, "i").exec(s)) && (m[2] || primary)) return make(m, unitMs(m[1], m[2]), null)
  return null
}

// ---- describing ----------------------------------------------------------------------------

const KIND_WORD = {
  "css-animation": "CSS animation",
  "css-transition": "CSS transition",
  waapi: "element.animate()",
  js: "script-driven motion (inline style writes)",
  "scroll-driven": "scroll-driven animation",
  smil: "SVG (SMIL) animation",
}
const LIB_WORD = { motion: "Motion (framer-motion)", gsap: "GSAP", anime: "anime.js", "react-spring": "react-spring" }
/** "@keyframes rise", "opacity transition", "element.animate()" … */
const animTitle = (a) => {
  if (a.kind === "css-animation") return `@keyframes ${a.name || "?"}`
  if (a.kind === "css-transition") return `${a.name || "transition"}`
  if (a.kind === "js" && a.motionKeyframes) return `Motion keyframes (${a.name || "values"}) from the motion element's animate / transition props, run from script`
  if (a.kind === "js") return `${a.lib && a.lib !== "raf" ? `${LIB_WORD[a.lib] || a.lib}, ` : ""}${KIND_WORD.js}`
  if (a.kind === "waapi" && a.lib) return `${LIB_WORD[a.lib] || a.lib} animation (it runs as element.animate())`
  return a.name && a.kind !== "waapi" ? `${a.name} (${KIND_WORD[a.kind] || a.kind})` : KIND_WORD[a.kind] || a.name || "animation"
}
const whereText = (d) => (d && d.file ? `${d.file}${d.line ? ":" + d.line : ""}` : null)
// A computed transform (always a matrix) read the way it would be written:
// matrix(1, 0, 0, 1, 19.72, 0) → translate(19.7px, 0px).
function prettyTransform(v) {
  const m = /^matrix\(([^)]*)\)$/.exec(String(v).trim())
  if (!m) return String(v)
  const [a, b, c, d, e, f] = m[1].split(",").map(Number)
  if (![a, b, c, d, e, f].every(Number.isFinite)) return String(v)
  const parts = []
  if (e || f) parts.push(`translate(${num(e, 1)}px, ${num(f, 1)}px)`)
  const rot = (Math.atan2(b, a) * 180) / Math.PI
  if (Math.abs(rot) >= 0.05) parts.push(`rotate(${num(rot, 1)}deg)`)
  const sx = Math.hypot(a, b)
  const sy = (a * d - b * c) / (sx || 1)
  if (Math.abs(sx - 1) >= 0.001 || Math.abs(sy - 1) >= 0.001) parts.push(Math.abs(sx - sy) < 0.001 ? `scale(${num(sx, 3)})` : `scale(${num(sx, 3)}, ${num(sy, 3)})`)
  return parts.length ? parts.join(" ") : "none (identity)"
}
const pretty = (k, x) => (/^(transform|webkitTransform)$/.test(k) ? prettyTransform(x) : /^opacity$/.test(k) && Number.isFinite(Number(x)) ? num(x, 3) : x)
const valuesText = (v, max = 6) => {
  const e = Object.entries(v || {}).slice(0, max)
  return e.length ? e.map(([k, x]) => `${kebab(k)} ${pretty(k, x)}`).join("; ") : ""
}
const boxText = (g) => {
  if (!g || !g.page) return ""
  const p = g.page
  return `box x ${Math.round(p.x)} y ${Math.round(p.y)} ${Math.round(p.w)}×${Math.round(p.h)}`
}
const deltaText = (g, g0) => {
  if (!g || !g0 || !g.page || !g0.page) return ""
  const dx = Math.round(g.page.x - g0.page.x)
  const dy = Math.round(g.page.y - g0.page.y)
  return dx || dy ? ` (Δ ${dx >= 0 ? "+" : ""}${dx}, ${dy >= 0 ? "+" : ""}${dy} from the range start)` : ""
}
const pointLine = (label, p, g0) => {
  const bits = [valuesText(p.values), boxText(p.geometry) + deltaText(p.geometry, g0)].filter(Boolean)
  return `${label}: ${bits.join(" · ") || "(values not sampled)"}`
}

// ---- which animation a note is about ------------------------------------------------------
// An element can carry dozens of clips at one moment: instant ones (0ms, or
// keyframes that don't change anything: a library setting a value through an
// animation) say nothing about its motion. Repeats of one animation (the same
// @keyframes started again on scroll) are one animation with several runs.

/** Seen as motion? false for 0ms (under a frame) or keyframes that all have the same values. */
export function isInstant(a) {
  if (!a) return false
  const t = a.timing || {}
  const it = iterCount(t)
  if ((Number(t.duration) || 0) * (it === Infinity ? 1 : it) < 1) return true
  const kf = (a.keyframes || []).filter((k) => k && k.values)
  return kf.length >= 2 && kf.every((k) => JSON.stringify(k.values) === JSON.stringify(kf[0].values))
}
// The more of these an animation has, the likelier it is what the user looked at.
const weightOf = (a) => (isInstant(a) ? 0 : 1 + (iterCount(a.timing || {}) > 1 ? 2 : 0) + ((a.keyframes || []).length > 2 ? 1 : 0) + Math.min((Number((a.timing || {}).duration) || 0) / 1000, 2))
/** The same animation on the same element (another run of it). */
export const animKey = (a) => [a.kind, a.name, a.selector || "", a.relation || "on"].join("|")

/**
 * Repeats folded into one entry: the first (or the primary) keeps them as
 * `runs` [{ id, start, end }], in order.
 * @param {any[]} anims
 */
export function collapseAnims(anims) {
  const list = anims || []
  const lead = new Map() // key → the entry that speaks for it (the primary, else the first)
  for (const a of list) {
    const k = animKey(a)
    if (!lead.has(k) || (a.primary && !lead.get(k).primary)) lead.set(k, a)
  }
  const out = []
  const done = new Set()
  for (const a of list) {
    const k = animKey(a)
    if (done.has(k)) continue
    done.add(k)
    const same = list.filter((x) => animKey(x) === k)
    const me = lead.get(k)
    const runs = same.flatMap((x) => (x.runs && x.runs.length ? x.runs : [{ id: x.id, start: (x.timing || {}).start, end: (x.timing || {}).end }]))
    const uniq = runs.filter((r, i) => runs.findIndex((y) => y.id === r.id && y.start === r.start) === i).sort((x, y) => (x.start || 0) - (y.start || 0))
    out.push(uniq.length > 1 ? { ...me, runs: uniq } : me)
  }
  return out
}

/** The animation an element note is about first, or null (an instant one only if nothing else). */
export const primaryOf = (note) => {
  const anims = (note && note.anims) || []
  const p = anims.find((a) => a.primary) || anims[0] || null
  if (!p || !isInstant(p)) return p
  const better = anims.filter((a) => !isInstant(a)).sort((x, y) => weightOf(y) - weightOf(x))[0]
  return better || p
}

/** The element block: page, element, selector, component, source, classes, box. */
export function elementBlock(note, ctx = {}) {
  const el = note.el || {}
  const tg = note.target || {}
  const lines = []
  if (el.page) lines.push(`Page: ${el.page}`)
  const label = tg.tag || el.label
  const text = tg.text != null ? tg.text : el.text
  if (label) lines.push(`Element: ${label}${text ? ` "${text}"` : ""}${tg.shadowHost ? ` (inside ${tg.shadowHost}'s shadow root)` : ""}`)
  const sel = tg.selector || note.selector || el.selector
  if (sel) lines.push(`Selector: ${sel}${tg.matches > 1 ? ` (matches ${tg.matches} elements; this is the ${ordinal(tg.index || 1)})` : tg.matches === 1 ? " (1 match)" : ""}`)
  const comps = el.components && el.components.length ? el.components : note.component ? [note.component] : []
  if (comps.length) lines.push(`Component: ${comps.join(" < ")}`)
  if (ctx.sourceLine) lines.push(ctx.sourceLine)
  else {
    const src = (tg.source && tg.source.file ? tg.source : null) || note.source
    if (src && src.file) {
      const how = src.confidence === "owner" ? " (its component's call site)" : src.confidence === "exact" ? " (the element's JSX)" : ""
      lines.push(src.compiled ? `Source: not mapped (only a compiled bundle); find it by the component and selector` : `Source: ${src.file}${src.line ? ":" + src.line : ""}${how}`)
    } else if (src && src.confidence === "unknown") lines.push(`Source: unknown${src.component ? ` (server component ${src.component})` : ""}`)
  }
  if (el.cssSource && el.cssSource.file) lines.push(`CSS: ${el.cssSource.file}${el.cssSource.line ? ":" + el.cssSource.line : ""}`)
  const classes = note.classes || el.classes
  if (classes && classes.length) lines.push(`Classes: ${[].concat(classes).join(" ")}`)
  if (ctx.computed) lines.push(ctx.computed)
  // The box where the note is: the primary animation's point (or range start), sampled there; else as picked.
  const pa = primaryOf(note)
  const pp = pa && (pa.from || pa.at)
  const g = (pp && pp.geometry && pp.geometry.page ? pp.geometry : null) || tg.geometry
  if (g && g.page) {
    const at = note.range ? ` at the range start` : ""
    const tr = g.transform && g.transform !== "none" ? `; transform ${prettyTransform(g.transform)}` : ""
    const vp = g.view && g.scroll ? ` (page px; viewport ${Math.round(g.view.w)}×${Math.round(g.view.h)}, scrolled ${Math.round(g.scroll.x)}, ${Math.round(g.scroll.y)})` : " (page px)"
    lines.push(`Box${at}: x ${Math.round(g.page.x)} y ${Math.round(g.page.y)}, ${Math.round(g.page.w)}×${Math.round(g.page.h)}${vp}${tr}${g.opacity != null && Number(g.opacity) !== 1 ? `; opacity ${num(g.opacity)}` : ""}`)
    if (tr && g.decomposed && (g.decomposed.tx || g.decomposed.ty)) lines.push(`  (layout position = this box minus the translate ${num(g.decomposed.tx, 1)}, ${num(g.decomposed.ty, 1)})`)
  } else if (note.rect) lines.push(`Box: ${Math.round(note.rect.w)}×${Math.round(note.rect.h)} at (${Math.round(note.rect.x)}, ${Math.round(note.rect.y)}) in the viewport`)
  return lines
}
const ordinal = (n) => `${n}${n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th"}`

function timingLine(a) {
  const t = a.timing || {}
  if (a.kind === "js" && a.motionKeyframes) return `${msText(t.duration)}, delay ${msText(t.delay)}, ${iterCount(t) === Infinity ? "looping" : `${num(iterCount(t))} iteration${iterCount(t) === 1 ? "" : "s"}`}; each segment has its own ease (below; Motion applies a single ease to every segment); local 0 placed from its first style write${a.leadMs ? ` (${num(a.leadMs, 1)}ms before it)` : ""}, ±1 frame`
  if (a.kind === "js") return `${msText(t.duration)} of inline style writes (the curve is in the script: Retake saw the values it wrote, not its easing)`
  const iters = iterCount(t)
  const bits = [
    `${msText(t.duration)}`,
    `delay ${msText(t.delay)}`,
    iters === Infinity ? "looping" : `${num(iters)} iteration${iters === 1 ? "" : "s"}`,
    t.direction && t.direction !== "normal" ? `direction ${t.direction}` : null,
    `fill ${t.fill || "none"}`,
    `easing ${t.easing || "linear"} on the whole effect`,
    t.playbackRate && Number(t.playbackRate) !== 1 ? `playback rate ${t.playbackRate}` : null,
  ].filter(Boolean)
  return bits.join(", ")
}

function keyframeLines(a) {
  const kf = a.keyframes || []
  if (!kf.length) return []
  if (a.kind === "js" && !a.motionKeyframes) {
    const side = (v) => Object.entries(v || {}).map(([k, x]) => `${kebab(k)}: ${x || "(not set)"}`).join("; ") || "?"
    return [`  inline style: ${side(kf[0].values)} → ${side(kf[kf.length - 1].values)} (first and last write)`]
  }
  const out = [`  keyframes (offset · values · easing to the next)${a.approx ? ", only the first and last were recorded" : ""}:`]
  kf.forEach((k, i) => out.push(`    ${num(k.offset, 3).padEnd(5)} ${valuesText(k.values, 8).padEnd(40)} ${i < kf.length - 1 ? k.easing || "linear" : ""}`.trimEnd()))
  return out
}

const segText = (s) => (s ? `segment ${num(s.fromOffset, 3)} → ${num(s.toOffset, 3)} (${s.easing})` : "")

// ---- an exact edit -------------------------------------------------------------------------
// The keyframes again on plain time (the effect's easing moved into them),
// with the note's point or range edges as keyframes of their own. Each piece
// keeps the exact part of the curve it had (part of a cubic-bezier is a
// cubic-bezier; anything else is written as linear() stops), so the motion
// outside the asked part stays what it was and only the marked piece changes.

const bezierOf = (e) => {
  const s = String(e || "linear").trim()
  if (isLinear(s)) return [0, 0, 1, 1]
  if (NAMED[s]) return NAMED[s]
  const m = /^cubic-bezier\(([^)]*)\)$/.exec(s)
  const v = m ? m[1].split(",").map(Number) : []
  return v.length === 4 && v.every(Number.isFinite) ? v : null
}
// A computed value as something to write back: a transform's matrix as translate/rotate/scale.
const cssValue = (k, v) => {
  if (!/^(transform|webkitTransform)$/.test(k)) return pretty(k, v)
  const s = prettyTransform(v)
  return s === "none (identity)" ? "translate(0px, 0px)" : s
}
const isSteps = (e) => /^(steps\(|step-)/.test(String(e || "").trim())

// The part of a cubic-bezier timing curve between inputs xa and xb, as a timing curve of its own.
function subCurve(p, xa, xb) {
  if (xb - xa < 1e-6) return "linear"
  const X = [0, p[0], p[2], 1]
  const Y = [0, p[1], p[3], 1]
  const at = (c, t) => (1 - t) ** 3 * c[0] + 3 * (1 - t) ** 2 * t * c[1] + 3 * (1 - t) * t * t * c[2] + t ** 3 * c[3]
  const tOf = (x) => {
    if (x <= 0) return 0
    if (x >= 1) return 1
    let lo = 0
    let hi = 1
    for (let i = 0; i < 50; i++) {
      const mid = (lo + hi) / 2
      if (at(X, mid) < x) lo = mid
      else hi = mid
    }
    return (lo + hi) / 2
  }
  // de Casteljau: [left, right] of control points c split at t.
  const split = (c, t) => {
    const l = (a, b) => a + (b - a) * t
    const a1 = l(c[0], c[1]), b1 = l(c[1], c[2]), c1 = l(c[2], c[3])
    const a2 = l(a1, b1), b2 = l(b1, c1)
    const m = l(a2, b2)
    return [[c[0], a1, a2, m], [m, b2, c1, c[3]]]
  }
  const ta = tOf(xa)
  const tb = tOf(xb)
  let cx = split(X, tb)[0]
  let cy = split(Y, tb)[0]
  const s = tb > 0 ? ta / tb : 0
  cx = split(cx, s)[1]
  cy = split(cy, s)[1]
  const dx = cx[3] - cx[0]
  const dy = cy[3] - cy[0]
  if (Math.abs(dy) < 1e-9 || dx < 1e-9) return "linear"
  const q = [(cx[1] - cx[0]) / dx, (cy[1] - cy[0]) / dy, (cx[2] - cx[0]) / dx, (cy[2] - cy[0]) / dy]
  if (Math.abs(q[0] - q[1]) < 1e-3 && Math.abs(q[2] - q[3]) < 1e-3) return "linear"
  return `cubic-bezier(${q.map((v) => num(v, 4)).join(", ")})`
}
// Any curve on [0, 1] as linear() stops, as few as keep it within 0.2% of its rise.
function stopsCurve(f) {
  for (const n of [8, 12, 16, 24, 32]) {
    const ys = Array.from({ length: n + 1 }, (_, i) => f(i / n))
    let worst = 0
    for (let i = 0; i < n; i++) worst = Math.max(worst, Math.abs(f((i + 0.5) / n) - (ys[i] + ys[i + 1]) / 2))
    if (worst <= 0.002 || n === 32) return `linear(${ys.map((y) => num(y, 4)).join(", ")})`
  }
  return "linear"
}

/**
 * The keyframes with the note's point or range edges put in, on plain time: [{ offset, values, easing, mark }],
 * or null when it can't be written exactly (steps(), several iterations, reversed, nothing sampled).
 * @param {any} a an anims[] entry with keyframes, timing and at or from/to
 */
export function splitKeyframes(a) {
  const t = a.timing || {}
  const kf = (a.keyframes || []).filter((k) => k && k.offset != null)
  const dur = Number(t.duration) || 0
  if (kf.length < 2 || dur <= 0) return null
  if (isSteps(t.easing) || kf.some((k) => isSteps(k.easing))) return null
  const edges = (a.from && a.to ? [[a.from, "from"], [a.to, "to"]] : a.at ? [[a.at, "at"]] : []).filter(([p]) => p && p.phase !== "delay" && p.values && Object.keys(p.values).length)
  if (!edges.length) return null
  // A loop (or a reversed run): the keyframes are the same on every iteration,
  // so a point or a range inside one iteration is written on them (progress is
  // already counted the way that iteration runs).
  const loop = iterCount(t) !== 1 || (t.direction && t.direction !== "normal")
  if (loop && new Set(edges.map(([p]) => p.iteration || 0)).size > 1 && !wrapOf(a)) return null
  const E = easingFn(t.easing)
  const effectCurve = bezierOf(t.easing)
  const timeOf = (o) => localOfOffset(a, o) / dur
  /** @type {{ offset: number, eased: number, values: any, seg: number, mark: string | null }[]} */
  const stops = kf.map((k, i) => ({ offset: timeOf(k.offset), eased: k.offset, values: k.values || {}, seg: Math.min(i, kf.length - 2), mark: null }))
  for (const [p, mark] of edges) {
    const q = Math.min(Math.max(Number(p.progress) || 0, 0), 1)
    const near = stops.find((s) => Math.abs(s.offset - q) < 5e-4)
    if (near) {
      near.mark = near.mark ? `${near.mark}+${mark}` : mark
      continue
    }
    const e = E(q)
    let seg = 0
    while (seg < kf.length - 2 && e >= kf[seg + 1].offset) seg++
    const values = {}
    for (const [k, v] of Object.entries(p.values)) values[k] = cssValue(k, v)
    stops.push({ offset: q, eased: e, values, seg, mark })
  }
  stops.sort((x, y) => x.offset - y.offset)
  return stops.map((s, i) => {
    const next = stops[i + 1]
    /** @type {string | null} */
    let easing = null
    if (next) {
      const k = kf[s.seg]
      const o0 = kf[s.seg].offset
      const o1 = kf[s.seg + 1].offset
      const segOf = (p) => (o1 > o0 ? (E(p) - o0) / (o1 - o0) : 0)
      const kCurve = bezierOf(k.easing)
      const effectLinear = isLinear(t.easing)
      const kLinear = isLinear(k.easing)
      const whole = Math.abs(segOf(s.offset)) < 1e-6 && Math.abs(segOf(next.offset) - 1) < 1e-6
      if (effectLinear && kLinear) easing = "linear"
      else if (effectLinear && whole) easing = k.easing || "linear"
      else if (effectLinear && kCurve) easing = subCurve(kCurve, segOf(s.offset), segOf(next.offset))
      else if (kLinear && effectCurve) easing = subCurve(effectCurve, s.offset, next.offset)
      else {
        const kf2 = easingFn(k.easing)
        const y0 = kf2(segOf(s.offset))
        const y1 = kf2(segOf(next.offset))
        easing = Math.abs(y1 - y0) < 1e-9 ? "linear" : stopsCurve((u) => (kf2(segOf(s.offset + u * (next.offset - s.offset))) - y0) / (y1 - y0))
      }
    }
    return { offset: Math.round(s.offset * 10000) / 10000, values: s.values, easing, mark: s.mark }
  })
}

// A range on a loop that crosses the end of one iteration: which parts of the
// keyframes it covers, in words (null when it doesn't cross, or crosses more).
function wrapOf(a) {
  if (!a.from || !a.to) return null
  const i0 = a.from.iteration || 0
  const i1 = a.to.iteration || 0
  if (i1 !== i0 + 1) return null
  const dir = (a.timing || {}).direction || "normal"
  const rev = (i) => dir === "reverse" || (dir === "alternate" && i % 2 === 1) || (dir === "alternate-reverse" && i % 2 === 0)
  const [r0, r1] = [rev(i0), rev(i1)]
  if (!r0 && !r1) return "from the range start mark to 100% and from 0% to the range end mark (the range crosses the end of an iteration)"
  if (r0 && r1) return "from the range start mark down to 0% and from 100% down to the range end mark (the range crosses the end of an iteration)"
  return r1 ? "from each mark up to 100% (the range crosses the turn at 100%)" : "from 0% up to each mark (the range crosses the turn at 0%)"
}

// A range's marked stops hold today's values at its edges: an agent that
// changes them changes the motion outside the range too (F139).
const KEEP_MARKS = "and keep the marked stops as they are (they hold today's values at the range edges; changing one moves the motion outside the range too; for a new value right at an edge, add a stop 0.01% inside the mark: a jump there)"
const MARK_WORD = { from: "range start", to: "range end", at: "the note's point", "from+to": "range" }
const markText = (s, a) => {
  if (!s.mark) return ""
  const p = s.mark.startsWith("to") ? a.to : s.mark.startsWith("at") ? a.at : a.from
  if (p && p.phase === "after") return ` ← its end state (the note is ${msText(p.local - (Number((a.timing || {}).duration) || 0) * iterCount(a.timing || {}))} after it ended)`
  return ` ← ${MARK_WORD[s.mark] || s.mark}, local ${msText(p && p.local)}`
}
const jsValue = (v) => JSON.stringify(String(v))

// A CSS transition's timing function as linear() stops, with the note's
// point or range edges as stops of their own: [{ x, y, mark }]. Each stop is
// "output (0 = the start value, 1 = the end value) at input %".
function transitionStops(a) {
  const t = a.timing || {}
  const E = easingFn(t.easing)
  if (isSteps(t.easing)) return null
  const edges = (a.from && a.to ? [[a.from, "from"], [a.to, "to"]] : a.at ? [[a.at, "at"]] : []).filter(([p]) => p && p.phase === "active" || (p && p.phase === "after"))
  const marks = edges.map(([p, mark]) => ({ x: p.phase === "after" ? 1 : Math.min(Math.max(Number(p.progress) || 0, 0), 1), mark }))
  const cuts = [...new Set([0, 1, ...marks.map((m) => Math.round(m.x * 10000) / 10000)])].sort((x, y) => x - y)
  const out = []
  for (let i = 0; i < cuts.length - 1; i++) {
    const a0 = cuts[i]
    const a1 = cuts[i + 1]
    let n = 2
    for (; n < 24; n += 2) {
      let worst = 0
      for (let k = 0; k < n; k++) {
        const xa = a0 + ((a1 - a0) * k) / n
        const xb = a0 + ((a1 - a0) * (k + 1)) / n
        worst = Math.max(worst, Math.abs(E((xa + xb) / 2) - (E(xa) + E(xb)) / 2))
      }
      if (worst <= 0.002) break
    }
    for (let k = i === 0 ? 0 : 1; k <= n; k++) out.push({ x: a0 + ((a1 - a0) * k) / n, y: 0 })
  }
  for (const s of out) {
    s.y = E(s.x)
    const m = marks.find((m) => Math.abs(m.x - s.x) < 1e-4)
    s.mark = m ? m.mark : null
  }
  return out
}

/** The exact-edit block for an animation (CSS @keyframes, element.animate(), Motion, a CSS transition), or []. */
export function editPlan(a) {
  if (a.kind === "css-transition" && !a.approx) {
    const stops = transitionStops(a)
    const kf = a.keyframes || []
    if (!stops || kf.length < 2) return []
    const t = a.timing || {}
    const prop = String(a.name || "").replace(/ transition$/, "") || "the property"
    const v0 = valuesText(kf[0].values)
    const v1 = valuesText(kf[kf.length - 1].values)
    const where = a.rule && a.rule.file ? ` (the rule ${a.rule.selector || ""} at ${whereText(a.rule)})` : ""
    const lines = [`Exact edit (CSS transition): the same timing as now (${t.easing}) written as linear() stops, with the note's ${a.from && a.to ? "range edges" : "point"} as stops of their own (marked below). Each stop is "output input%": output 0 = the start value (${v0}), 1 = the end value (${v1}); input = local / duration. Use it as the timing function of ${prop} only${where}, keep the other properties' transitions as they are, then change only the stops ${a.from && a.to ? `between the marks, ${KEEP_MARKS}` : "at the mark"}. A jump is two stops at the same input%.`]
    lines.push(`  ${prop} ${msText(t.duration)}${Number(t.delay) ? ` ${msText(t.delay)}` : ""} linear(${stops.map((s) => `${num(s.y, 4)} ${num(s.x * 100, 2)}%`).join(", ")})   (its entry in the transition list)`)
    for (const s of stops.filter((x) => x.mark)) {
      const p = s.mark === "to" ? a.to : s.mark === "at" ? a.at : a.from
      lines.push(`  marked: ${num(s.y, 4)} ${num(s.x * 100, 2)}% = ${MARK_WORD[s.mark] || s.mark}, local ${msText(p && p.local)}${p && p.values ? ` (${valuesText(p.values)})` : ""}`)
    }
    return lines
  }
  if (a.approx) return []
  if (!["css-animation", "waapi", "js"].includes(a.kind) || (a.kind === "js" && a.lib !== "motion")) return []
  const stops = splitKeyframes(a)
  if (!stops) return []
  const t = a.timing || {}
  const range = a.from && a.to
  const what = range ? `${wrapOf(a) || "between the two marked keyframes"}, ${KEEP_MARKS}` : "at the marked keyframe (and as little around it as the request allows)"
  const lines = []
  const loopNote = iterCount(t) !== 1 || (t.direction && t.direction !== "normal") ? ` The keyframes run on every iteration, so it repeats on every iteration${t.direction && t.direction !== "normal" ? ` (direction ${t.direction})` : ""}.` : ""
  const easedNote = (isLinear(t.easing) ? "" : ` The effect's easing (${t.easing}) is moved into the keyframes, so offsets are plain time: local ms / ${msText(t.duration)}.`) + loopNote
  if (a.kind === "css-animation") {
    const shared = a.shared && a.shared.length
    const last = String(a.selector || "").split(/\s*>\s*|\s+/).pop() || ""
    const nth = (/:nth-[\w-]+\((\d+)\)/.exec(last) || [])[1] || ""
    const name = shared ? `${a.name}-${(last.replace(/:[\w-]+(\([^)]*\))?/g, "").split(/[.#[\]=]+/).filter(Boolean).pop() || "own").replace(/[^\w-]/g, "")}${nth}` : a.name
    lines.push(`Exact edit: the same motion as now, with the note's ${range ? "range edges" : "point"} as stops of their own (marked).${easedNote} ${shared ? `Add these as @keyframes ${name} and point only this element at it (${a.selector || "its selector"} { animation-name: ${name} }); @keyframes ${a.name} is shared.` : `Replace @keyframes ${a.name} with them.`} Then change only what is ${what}:`)
    lines.push(`  @keyframes ${name} {`)
    for (const s of stops) {
      const decl = Object.entries(s.values).map(([k, v]) => `${kebab(k)}: ${v}`)
      if (s.easing) decl.push(`animation-timing-function: ${s.easing}`)
      lines.push(`    ${num(s.offset * 100, 2)}% { ${decl.join("; ")} }${markText(s, a) ? ` /*${markText(s, a)} */` : ""}`)
    }
    lines.push("  }")
  } else if (a.lib === "motion") {
    const props = [...new Set(stops.flatMap((s) => Object.keys(s.values)))]
    lines.push(`Exact edit (Motion): the same motion as now, with the note's ${range ? "range edges" : "point"} as keyframes of their own.${isLinear(t.easing) ? "" : ` The single ease (${t.easing}) becomes one ease per segment, so times are plain time: local ms / ${msText(t.duration)}.`}${loopNote} Then change only what is ${what} (marked: ${stops.map((s, i) => (s.mark ? `index ${i}` : null)).filter(Boolean).join(", ")}):`)
    lines.push(`  animate={{ ${props.map((p) => `${p}: [${stops.map((s) => (s.values[p] == null ? "null" : /^-?[\d.]+$/.test(String(s.values[p])) ? String(s.values[p]) : jsValue(s.values[p]))).join(", ")}]`).join(", ")} }}   (other values in animate as they are)`)
    const ease = stops.slice(0, -1).map((s) => {
      const e = s.easing || "linear"
      return e === "linear" ? '"linear"' : /^cubic-bezier/.test(e) ? `[${e.slice(13, -1)}]` : jsValue(e)
    })
    const own = `{ duration: ${num(t.duration / 1000, 3)}, delay: ${num((Number(t.delay) || 0) / 1000, 3)}, times: [${stops.map((s) => num(s.offset, 4)).join(", ")}], ease: [${ease.join(", ")}] }`
    lines.push(`  transition={{ ...the transition as it is, ${props.length === 1 ? props[0] : `${props.join(" and ")} each`}: ${own} }}   (a transition of ${props.length === 1 ? "its" : "their"} own, so other values keep their times)`)
  } else {
    lines.push(`Exact edit (element.animate): the same motion as now, with the note's ${range ? "range edges" : "point"} as keyframes of their own (marked).${easedNote} Then change only what is ${what}:`)
    lines.push("  [")
    for (const s of stops) lines.push(`    { offset: ${num(s.offset, 4)}, ${Object.entries(s.values).map(([k, v]) => `${k}: ${jsValue(v)}`).join(", ")}${s.easing ? `, easing: ${jsValue(s.easing)}` : ""} },${markText(s, a) ? ` //${markText(s, a)}` : ""}`)
    const its = iterCount(t)
    const more = `${its !== 1 ? `, iterations: ${its === Infinity ? "Infinity" : num(its)}` : ""}${t.direction && t.direction !== "normal" ? `, direction: ${jsValue(t.direction)}` : ""}`
    lines.push(`  ], { duration: ${num(t.duration, 1)}, delay: ${num(Number(t.delay) || 0, 1)}, easing: "linear", fill: ${jsValue(t.fill || "none")}${more} }`)
  }
  return lines
}

function motionHow(a, at, check) {
  const t = a.timing || {}
  const eased = !isLinear(t.easing)
  const where = a.from && a.to ? `${num(a.from.progress, 3)} and ${num(a.to.progress, 3)}` : a.at ? num(a.at.progress, 3) : "the point"
  return `How (Motion): values are arrays with times (0-1 of the duration, delay excluded) and an ease per segment (a single ease is used for every segment).${eased ? ` This one runs as element.animate() with one easing on the whole effect (${t.easing}), applied before times, so times are not plain time here: the exact edit below gives one ease per segment instead, with times = local / duration.` : ""} Insert entries at ${where} (local / duration) with the values given there, so the motion outside doesn't move; each new segment needs the matching part of the curve it splits (the exact edit below has it). To change other values (y, scale...) over only that part, give them arrays of their own with the same times, holding their current value outside it. A spring has no ms range: convert it to keyframes + times, or change stiffness/damping/bounce. ${check}`
}

/** How to change only the part the note means, for each kind of animation. */
export function howTo(a) {
  const t = a.timing || {}
  const easedEffect = !isLinear(t.easing)
  const check = "Check the values at the range edges and one frame either side against the ones above."
  const at = a.from && a.to ? `${num(a.from.progress * 100, 1)}% and ${num(a.to.progress * 100, 1)}%` : a.at && a.at.phase === "after" ? "100% (its end: the note is after it ended)" : a.at ? `${num(a.at.progress * 100, 1)}%` : "the point"
  switch (a.kind) {
    case "css-animation":
      return `How (CSS @keyframes): add stops at ${at} (local / duration) with the edge values above, so nothing outside moves, and change only what is between them. animation-timing-function inside a keyframe applies to the segment after it (default ease), so a stop added inside a curved segment needs the matching part of that curve on both sides (the exact edit below has it); a hold is two stops with the same value. If the duration changes, recompute every %. ${a.matches > 1 ? "The selector matches more than one element: scope the change (:nth-child, a modifier class) unless all were meant. " : ""}${a.shared && a.shared.length ? `@keyframes ${a.name} also runs on other elements (above): give this element its own copy unless the user meant all of them. ` : ""}${check}`
    case "css-transition":
      return `How (CSS transition): a transition has one segment. For a hold, a two-step motion or a change over part of it, use linear(…) stops or a cubic-bezier in transition-timing-function, or replace it with a keyframes animation started by the same trigger${a.trigger ? ` (${a.trigger.what})` : ""}. ${check}`
    case "waapi":
      if (a.lib === "motion") return motionHow(a, at, check)
      return `How (WAAPI): edit the keyframe array: add { offset, ...values, easing } at ${at}.${easedEffect ? ` The effect has one easing (${t.easing}), so keyframe offsets apply after it, not to time: the exact edit below moves that easing into the keyframes (effect easing linear, offsets = local / duration) with the edges as keyframes of their own.` : ""} ${check}`
    case "js":
      if (a.lib === "gsap") return `How (GSAP): tweens sit at positions on a timeline; retime with the position parameter ("<", "-=0.4", absolute seconds). Change part of a tween by splitting it into two .to() calls at the edge values above.${a.gsap && a.gsap.tweens ? " The tweens Retake read are listed above." : ""} ${check}`
      if (a.lib === "motion") return motionHow(a, at, check)
      return `How (script-driven): Retake saw inline style writes, not the definition. Edit the code${whereText(a.defined) ? ` at ${whereText(a.defined)}` : ""} that writes them and gate the change on the same elapsed time, or move it into keyframes. ${check}`
    case "scroll-driven":
      return `How (scroll-driven): the axis is scroll progress, not time. Edit the keyframe % or animation-range; the scroll position and progress at the note are given. For JS parallax, clamp to a scroll range instead of changing the factor. ${check}`
    case "smil":
      return `How (SVG SMIL): edit keyTimes/values on the <animate> element: add entries at ${at} with the edge values. ${check}`
    default:
      return check
  }
}

// One animation: what, where it is defined, its timing and keyframes, then the
// note's point or range on its own clock.
function animLines(a, ctx, note) {
  const start = ctx.start || 0
  const t = a.timing || {}
  const rel = a.relation === "on" ? "this element" : a.relation && a.relation.startsWith("pseudo") ? `this element's ${a.relation.replace(/^pseudo\s*/, "")}` : `${a.selector || "an ancestor"} (an ancestor that moves this element)`
  const lines = []
  lines.push(`Animation: ${animTitle(a)} on ${rel}${a.id ? ` (clip ${a.id})` : ""}${whereText(a.defined) ? `, defined at ${whereText(a.defined)}${a.defined.what ? ` (${a.defined.what})` : ""}` : ""}`)
  if (a.rule && a.rule.file) lines.push(`  applied by ${a.rule.selector ? `rule ${a.rule.selector} at ` : ""}${whereText(a.rule)}`)
  if (a.motionProps && a.motionProps.props) lines.push(`  ${a.motionProps.component} props: ${Object.entries(a.motionProps.props).map(([k, v]) => `${k}=${v}`).join(" ")}`)
  if (a.shared && a.shared.length && !ctx.inGroup) lines.push(`  shared: the same ${a.kind === "css-animation" ? `@keyframes ${a.name}` : "animation"} also runs on ${a.shared.length} other element${a.shared.length > 1 ? "s" : ""} (${a.shared.slice(0, 4).map((x) => x.selector || "?").join(", ")}${a.shared.length > 4 ? ", …" : ""}); editing it changes ${a.shared.length > 1 ? "them" : "it"} too`)
  if (a.trigger && a.trigger.what) lines.push(`  started by ${a.trigger.what}${a.trigger.t != null ? ` at ${clockText(a.trigger.t - start)} (recording)` : ""}`)
  lines.push(`  ${timingLine(a)}`)
  lines.push(`  runs recording ${clockText(t.start - start)} → ${t.end != null ? clockText(t.end - start) : "still running"}; local 0 = recording ${clockText(t.activeStart - start)}`)
  if (a.runs && a.runs.length > 1) lines.push(`  ran ${a.runs.length} times on ${rel}: ${a.runs.slice(0, 8).map((r) => clockText((r.start || 0) - start)).join(", ")}${a.runs.length > 8 ? ", …" : ""} (one animation started again; the note's run starts at ${clockText(t.start - start)})`)
  lines.push(...keyframeLines(a))
  if (a.gsap && a.gsap.tweens) for (const tw of a.gsap.tweens.slice(0, 6)) lines.push(`  gsap tween ${num(tw.start, 3)}s → ${num(tw.end, 3)}s ${tw.ease || ""} ${valuesText(tw.props)}`.trimEnd())
  if (a.scroll) lines.push(`  scroll: ${a.scroll.timeline || "scroll"} timeline${a.scroll.range ? `, range ${a.scroll.range}` : ""}${a.scroll.scrollY != null ? `, scrollY ${Math.round(a.scroll.scrollY)}` : ""}${a.scroll.progress != null ? `, progress ${pct(a.scroll.progress)}` : ""}`)
  const dur = Number(t.duration) || 0
  if (a.from && a.to) {
    const f = a.from
    const to = a.to
    const end = note && note.range && a.openEnd ? " (to the end)" : ""
    // On a loop, where in its iteration each edge is (the keyframes repeat every iteration).
    const il = (p) => msText(p.local - (p.iteration || 0) * dur)
    const span = iterCount(t) !== 1 && dur > 0 ? (f.iteration === to.iteration ? ` (iteration ${(f.iteration || 0) + 1}: ${il(f)} → ${il(to)} of ${msText(dur)})` : ` (iteration ${(f.iteration || 0) + 1} at ${il(f)} → iteration ${(to.iteration || 0) + 1} at ${il(to)}, of ${msText(dur)} each)`) : ` of ${msText(dur)}`
    lines.push(`Range: local ${msText(f.local)} → ${msText(to.local)}${end}${span} = progress ${num(f.progress, 3)} → ${num(to.progress, 3)} (eased ${num(f.eased, 3)} → ${num(to.eased, 3)}); recording ${clockText(f.T - start)} → ${clockText(to.T - start)}`)
    const segs = f.segment && to.segment ? (f.segment.index === to.segment.index && (f.iteration || 0) === (to.iteration || 0) ? `inside ${segText(f.segment)}` : `from ${segText(f.segment)} to ${segText(to.segment)}`) : ""
    const inside = a.keyframesInside || []
    const w = wrapOf(a)
    const wraps = w ? (/turn/.test(w) ? "it crosses a turn of the loop" : "it crosses the end of an iteration") : ""
    lines.push(`  ${[segs, inside.length ? `keyframe${inside.length > 1 ? "s" : ""} inside the range at ${inside.map((o) => num(o, 3)).join(", ")}` : "no keyframe inside the range", wraps].filter(Boolean).join("; ")}`)
    const g0 = (a.samples && a.samples[0] && a.samples[0].geometry) || f.geometry
    lines.push("  " + pointLine(`at ${msText(f.local)}`, f, null))
    for (const s of (a.samples || []).slice(1, -1)) lines.push("  " + pointLine(`at ${msText(s.local)}`, s, g0))
    lines.push("  " + pointLine(`at ${msText(to.local)}`, to, g0))
    if (f.frame && f.frame.before) lines.push(`  one frame before ${msText(f.local)}: ${valuesText(f.frame.before) || "?"}; one frame after ${msText(to.local)}: ${valuesText(to.frame && to.frame.after) || "?"}`)
  } else if (a.at) {
    const p = a.at
    const ended = t.end != null ? ` (at recording ${clockText(t.end - start)}, ${msText(p.T - t.end)} before the note's moment)` : ""
    const phase = p.phase === "delay" ? `in its delay, ${msText(-p.local)} before local 0` : p.phase === "after" ? `after it ended${ended}: its end state` : p.iteration ? `local ${msText(p.local)}, ${msText(p.local - p.iteration * dur)} of ${msText(dur)} into it` : `local ${msText(p.local)} of ${msText(dur)}`
    const iter = p.iteration ? `iteration ${p.iteration + 1}, ` : ""
    const sampled = a.kind !== "js" || a.motionKeyframes
    const detail = p.phase === "after" ? "" : !sampled ? ` = progress ${num(p.progress, 3)}` : ` = progress ${num(p.progress, 3)} (eased ${num(p.eased, 3)})`
    lines.push(`At: ${iter}${phase}${detail}; recording ${clockText(p.T - start)}${p.segment && p.phase === "active" && sampled ? `; in ${segText(p.segment)}, ${pct(p.segment.progress)} through it` : ""}`)
    lines.push("  " + pointLine("values", p, null))
    if (p.frame) lines.push(`  one frame before: ${valuesText(p.frame.before) || "?"}; one frame after: ${valuesText(p.frame.after) || "?"}`)
  }
  return lines
}

function scopeLine(note, a) {
  if (!a) return note.range ? `Scope: the user means recording ${clockText(note.range.from - 0)} → ${clockText(note.range.to - 0)} on this element.` : null
  const dur = Number((a.timing || {}).duration) || 0
  if (a.from && a.to) return `Scope: change only local ${Math.round(a.from.local)}–${Math.round(a.to.local)}ms of this animation; keep the values at every other point and the total duration (${msText(dur)}).`
  if (a.at && a.at.phase === "after") return `Scope: the note is after this animation ended, so the user means where it ends (its last values above). Change the end values; keep the start and the timing unless asked.`
  if (a.at) return `Scope: the user means local ${msText(a.at.local)} (progress ${num(a.at.progress, 3)}) of this animation. Change it there and as little around it as the request allows; keep the start, the end and the total duration unless asked.`
  return null
}

// ---- what kind of change the note asks for ---------------------------------------------------
// The exact edit keeps every point but the note's; a request about the whole
// animation's timing ("faster", "start earlier") needs something else, so the
// note says which reading it takes.

/** @type {[string, RegExp][]} */
const INTENTS = [
  ["hold", /\b(hold(?:s|ing)?|linger|pause there|stay(?:s)? (?:there|longer)|freeze)\b/i],
  ["faster", /\b(faster|quicker|snappier|speed (?:it |this |them )?up|too slow)\b/i],
  ["slower", /\b(slower|slow (?:it |this |them )?down|too fast|more slowly)\b/i],
  ["earlier", /\b(earlier|sooner)\b/i],
  ["later", /\b(later|delay it)\b/i],
  ["longer", /\blonger\b/i],
  ["shorter", /\bshorter\b/i],
]
/** Broad change words in a note: [{ kind, word }], at most two ("hold" wins over "longer"). */
export function intentsOf(text) {
  const out = []
  for (const [kind, re] of INTENTS) {
    const m = re.exec(String(text || ""))
    if (!m || (kind === "longer" && out.some((x) => x.kind === "hold"))) continue
    out.push({ kind, word: m[0].toLowerCase() })
  }
  return out.slice(0, 2)
}
function intentLine({ kind, word }, a, ranged) {
  const t = (a && a.timing) || {}
  const its = a ? `its duration (${msText(t.duration)} now)` : "each one's duration"
  const q = `Intent: "${word}"`
  const whole = `${q} reads as a change to the whole animation's timing, not to this point:`
  if ((kind === "faster" || kind === "slower") && ranged) return `${q} with a range: ${kind === "faster" ? "squeeze" : "stretch"} only the part between the marks (the exact edit marks them), and say in your reply whether the total duration changed or another part made up for it.`
  switch (kind) {
    case "faster":
      return `${whole} shorten ${its}${a && Number(t.delay) ? `, and the delay (${msText(t.delay)}) if the start feels late` : ""}; the keyframe % stay. The exact edit doesn't do this.`
    case "slower":
      return `${whole} lengthen ${its}; the keyframe % stay. The exact edit doesn't do this.`
    case "longer":
      return `${q} reads as lasting longer: lengthen ${its}; or, if a pause was meant, hold at the point (two stops with the same value).`
    case "shorter":
      return `${q} reads as ending sooner: shorten ${its}; the keyframe % stay.`
    case "earlier":
    case "later":
      return `${q} reads as a change to when it starts: ${kind === "earlier" ? "shorten" : "lengthen"} ${a ? `the delay (${msText(t.delay)} now)` : "each one's delay"} or start it from ${kind === "earlier" ? "an earlier" : "a later"} trigger${a && a.trigger && a.trigger.what ? ` (now ${a.trigger.what})` : ""}; keep its keyframes and duration.`
    case "hold":
      return `${q} = a plateau: two stops with the same value at the note's point (the exact edit marks it). The hold takes time from the parts after it unless the duration grows (then recompute every %).`
    default:
      return null
  }
}
const intentLines = (note, a, ranged) => /** @type {string[]} */ (intentsOf(note.text).map((it) => intentLine(it, a, ranged)).filter(Boolean))

const EDIT_USE = `Exact edit below: for "change it only here" requests. It adds stops around the note's point (or range) and keeps the rest exactly as now. For timing, duration or shape changes (faster, slower, hold longer, another ease), edit the keyframe table above as How says; don't paste it.`

// An instant animation (0ms, or no change), with its repeats, in one line.
function instantLine(a) {
  const kf = a.keyframes || []
  const n = (a.runs && a.runs.length) || 1
  const dur = Number((a.timing || {}).duration) || 0
  const rel = a.relation === "on" || !a.relation ? "this element" : a.relation.startsWith("pseudo") ? `this element's ${a.relation.replace(/^pseudo\s*/, "")}` : a.selector || "an ancestor"
  const v = kf.length >= 2 ? `: ${valuesText(kf[0].values) || "?"} → ${valuesText(kf[kf.length - 1].values) || "?"}` : ""
  return `Also running: ${animTitle(a)} on ${rel}${n > 1 ? ` ×${n}` : ""} (instant: ${dur < 1 ? "0ms" : "no change"} each, so it jumps straight to its end values; not the motion this note is about)${v}`
}

/** The animation block: the primary animation first, then the others, the scope and the How line. */
export function animationBlock(note, ctx = {}) {
  const anims = collapseAnims(note.anims || [])
  /** @type {string[]} */
  const lines = []
  const group = note.group && Array.isArray(note.group.members) && note.group.members.length ? note.group : null
  if (!anims.length) {
    if (!group) lines.push(note.range ? "Nothing animates on this element in this range." : "Nothing animates on this element at this moment.")
  } else {
    const p = primaryOf({ anims })
    lines.push(...animLines(p, ctx, note))
    const sc = scopeLine(note, p)
    if (sc) lines.push(sc)
    if (!group) lines.push(...intentLines(note, p, !!(p.from && p.to)))
    lines.push(howTo({ ...p, matches: note.target && note.target.matches }))
    const plan = editPlan(p.relation === "on" && note.target && note.target.selector ? { ...p, selector: note.target.selector } : p)
    if (plan.length) lines.push(EDIT_USE, ...plan)
    const rest = anims.filter((x) => x !== p).sort((x, y) => (isInstant(x) ? 1 : 0) - (isInstant(y) ? 1 : 0))
    for (const a of rest) lines.push("", ...(isInstant(a) ? [instantLine(a)] : animLines(a, ctx, note).map((l, i) => (i === 0 ? l.replace(/^Animation:/, "Also running:") : l))))
  }
  if (group) {
    if (anims.length) lines.push("")
    lines.push(...groupBlock(note, ctx))
    return lines
  }
  const inside = note.inside || []
  lines.push(`Also inside the element (not this note's subject): ${inside.length ? inside.slice(0, 6).map((c) => `${c.name || "animation"} on ${c.selector || "?"}${c.id ? ` (clip ${c.id})` : ""}`).join(", ") + (inside.length > 6 ? `, +${inside.length - 6} more` : "") : "none"}`)
  return lines
}

// ---- a group note: every animation inside a container ------------------------------------------
// note.group = { selector, label, members: [{ selector, label, anim }] }: one
// note for the children that each run their own animation (an equalizer's
// bars). Each member's anim has its point or range on its own clock.

/** Members that run one definition: the same @keyframes, or the same keyframes array. */
function sharedSets(members) {
  const sets = new Map()
  members.forEach((m, i) => {
    const a = m.anim
    if (!a || isInstant(a)) return
    const k = a.kind === "css-animation" ? `css:${a.name}` : `${a.kind}:${a.lib || ""}:${JSON.stringify(a.keyframes || [])}`
    if (!sets.has(k)) sets.set(k, [])
    sets.get(k).push({ i, a })
  })
  return [...sets.values()].filter((l) => l.length > 1)
}

/** The group section: shared definitions, the scope, then each member with its own exact edit. */
export function groupBlock(note, ctx = {}) {
  const g = note.group
  const start = ctx.start || 0
  const members = (g && g.members) || []
  const lines = [`Group: ${members.length} animated elements inside ${g.label || g.selector || "the element"} (one note for all of them)`]
  for (const list of sharedSets(members)) {
    const a0 = list[0].a
    const delays = list.map((x) => msText((x.a.timing || {}).delay))
    const what = a0.kind === "css-animation" ? `@keyframes ${a0.name}` : `the same keyframes (${animTitle(a0)})`
    lines.push(`Shared: ${what} runs on ${list.length} of them (${list.map((x) => x.i + 1).join(", ")})${new Set(delays).size > 1 ? `, each with its own delay (${delays.join(", ")})` : ""}${whereText(a0.defined) ? `, defined at ${whereText(a0.defined)}` : ""}. The same change for all of them: edit it once. The per-element exact edits below are for changing them differently.`)
  }
  lines.push(note.range ? `Range: recording ${clockText(note.range.from - start)} → ${clockText(note.range.to - start)}, on each element's own clock below.` : `Moment: recording ${clockText(note.t - start)}, on each element's own clock below.`)
  lines.push(`Scope: change ${note.range ? "this range" : "this moment"} of these ${members.length} animations as asked, each at its own local time; keep everything else unless asked.`)
  lines.push(...intentLines(note, null, !!note.range))
  lines.push(EDIT_USE.replace("Exact edit below", "Exact edits below"))
  members.forEach((m, i) => {
    lines.push("", `### ${i + 1}. ${m.label || "element"}${m.selector ? ` (${m.selector})` : ""}`)
    if (!m.anim) return void lines.push(note.range ? "Nothing animates on it in this range." : "Nothing animates on it at this moment.")
    if (isInstant(m.anim)) return void lines.push(instantLine(m.anim).replace(/^Also running: /, "Animation: "))
    lines.push(...animLines(m.anim, { ...ctx, inGroup: true }, note))
    lines.push(...editPlan({ ...m.anim, selector: m.selector || m.anim.selector }))
  })
  const kinds = new Map()
  for (const m of members) if (m.anim && !kinds.has(`${m.anim.kind}:${m.anim.lib || ""}`)) kinds.set(`${m.anim.kind}:${m.anim.lib || ""}`, m.anim)
  if (kinds.size) lines.push("", ...[...kinds.values()].map((a) => howTo(a)))
  return lines
}
const groupNames = (g) => {
  const counts = new Map()
  for (const m of g.members || []) {
    const n = (m.anim && m.anim.name) || "nothing"
    counts.set(n, (counts.get(n) || 0) + 1)
  }
  return [...counts].map(([n, c]) => (c > 1 ? `${n} ×${c}` : n)).join(", ")
}

/** One line for list_notes: "fadeUp @ 100ms (20%)", "ticker 200–400ms (10–20%)". */
export function animationSummary(note) {
  if (note && note.group && note.group.members && note.group.members.length) return `group of ${note.group.members.length} inside ${note.group.label || note.group.selector || "the element"}: ${groupNames(note.group)}`
  const a = primaryOf(note)
  if (!a) return note.anims ? "nothing animating" : note.clip ? `${note.clip.label || "animation"} +${Math.round(note.clip.offset || 0)}ms` : null
  const name = a.name || a.kind
  if (a.from && a.to) return `${name} ${Math.round(a.from.local)}–${Math.round(a.to.local)}ms (${num(a.from.progress * 100, 0)}–${num(a.to.progress * 100, 0)}%)`
  if (a.at) return `${name} @ ${Math.round(a.at.local)}ms (${num(a.at.progress * 100, 0)}%)`
  return name
}

/** The note's moment in words, for headers: "at 100ms (20%) of fadeUp on <h1.title>". */
export function atPhrase(note) {
  const a = primaryOf(note)
  const el = (note.target && note.target.tag) || (note.el && note.el.label) || note.selector || "the element"
  const g = note.group
  if (g && g.members && g.members.length) return `${note.range ? "a range of " : ""}${g.members.length} animations inside ${g.label || el}: ${groupNames(g)}`
  if (!a) return null
  if (a.from && a.to) return `${Math.round(a.from.local)}–${Math.round(a.to.local)}ms (${num(a.from.progress * 100, 0)}–${num(a.to.progress * 100, 0)}%) of ${a.name || "its animation"} on ${el}`
  if (a.at) return a.at.phase === "delay" ? `in the delay of ${a.name || "its animation"} on ${el}` : `at ${Math.round(a.at.local)}ms (${num(a.at.progress * 100, 0)}%) of ${a.name || "its animation"} on ${el}`
  return null
}

/**
 * The whole note as text for an agent (Copy for agent, get_note).
 * @param {any} note the note as the server keeps it (CONTRACT.md "Note")
 * @param {{ start?: number, timeline?: string, parent?: string | null, forkAt?: number | null, sourceLine?: string, computed?: string, status?: boolean }} [ctx]
 */
export function noteText(note, ctx = {}) {
  const start = ctx.start || 0
  const lines = [
    `> Retake note ${note.id}: pinned to a moment in a Retake recording of the running app. "Moment" is the time into that recording; times marked "local" are on the animation's own clock (0 = the end of its delay).`,
    `> To see what happened before and after it, use the Retake MCP tools (get_note, get_moment, get_animation, get_timeline_events), or ask the user to replay that moment in the Retake dock.`,
    "",
    `## ${note.text}`,
    "",
  ]
  if (ctx.status) lines.push(`Status: ${note.status || "pending"}`)
  lines.push(...elementBlock(note, ctx), "")
  // A note saved before notes knew their animations has only the clip it was in.
  if (Array.isArray(note.anims)) lines.push(...animationBlock(note, ctx))
  else if (note.clip) lines.push(`During an animation: ${Math.round(Number(note.clip.offset) || 0)}ms into ${note.clip.label || "an animation"} (clip ${note.clip.id}; counted from its start, delay included)`)
  else lines.push("Nothing was animating on it at this moment (as recorded).")
  if (note.asked) lines.push(`Read "${note.asked.text}" as ${note.asked.reading === "local" ? `local time of ${primaryOf(note) && primaryOf(note).id ? `clip ${primaryOf(note).id}` : "the animation"}` : "recording time from the note's moment"}${note.asked.from != null ? ` (${Math.round(note.asked.from)}${note.asked.to != null ? `–${Math.round(note.asked.to)}` : ""}ms)` : ""}.`)
  const moment = note.range ? `${clockText(note.range.from - start)} → ${clockText(note.range.to - start)}` : clockText(note.t - start)
  lines.push(`Moment: ${moment} into the recording · Timeline: "${ctx.timeline || "Timeline"}"${ctx.parent ? `, branched from "${ctx.parent}" at ${clockText((ctx.forkAt || 0) - start)}` : ""}`)
  const replies = note.replies || []
  if (replies.length) lines.push("", "Conversation:", ...replies.map((r) => `- ${r.from}: ${r.text}`))
  return lines.join("\n")
}

/**
 * get_animation: one animation's identity, timing, keyframes, and recording times
 * mapped onto its clock, with the conversion to each mechanism's units.
 * @param {any} a an anims[] entry, or a clip turned into one (animFromClip)
 * @param {number[]} Ts recording times
 * @param {{ start?: number, sampled?: any[] }} [ctx]
 */
export function animationReport(a, Ts, ctx = {}) {
  const start = ctx.start || 0
  const lines = animLines({ ...a, at: null, from: null, to: null }, ctx, null)
  const dur = Number((a.timing || {}).duration) || 0
  const delay = Number((a.timing || {}).delay) || 0
  if (a.keyframes && a.keyframes.length > 2) {
    lines.push("  keyframes on its own clock:")
    for (const k of a.keyframes) lines.push(`    ${num(k.offset, 3)} → local ${msText(localOfOffset(a, k.offset))} = recording ${clockText(recordingOf(a, localOfOffset(a, k.offset)) - start)}`)
  }
  for (const T of Ts) {
    const p = pointOf(a, T)
    const sampled = (ctx.sampled || []).find((s) => s && Math.abs(s.T - T) < FRAME)
    lines.push("", `Recording ${clockText(T - start)}: ${p.phase === "delay" ? `in the delay (${msText(-p.local)} before local 0)` : p.phase === "after" ? "after the end" : `local ${msText(p.local)}`}, progress ${num(p.progress, 4)}, eased ${num(p.eased, 4)}${p.segment ? `, ${segText(p.segment)} at ${pct(p.segment.progress)}` : ""}`)
    const eased = !isLinear((a.timing || {}).easing)
    lines.push(
      eased
        ? `  as a keyframe offset with the effect's easing (${a.timing.easing}) kept: ${num(p.eased, 4)} · on plain time (that easing moved into the keyframes): ${num(p.progress, 4)} · as GSAP: ${num((p.local + delay) / 1000, 3)}s into the tween (${num(p.local / 1000, 3)}s after its delay)`
        : `  as CSS: ${num(p.progress * 100, 2)}% of the keyframes · as Motion times: ${num(p.progress, 4)} · as GSAP: ${num((p.local + delay) / 1000, 3)}s into the tween (${num(p.local / 1000, 3)}s after its delay)`,
    )
    if (sampled) lines.push("  " + pointLine("sampled", sampled, null))
  }
  if (!Ts.length) lines.push("", `(pass at, from/to as recording times, like 00:01.20, to map them onto this animation; its duration is ${msText(dur)})`)
  return lines.join("\n")
}

/** A recorded clip (rec.clips / timeline().clips) as an anims[] entry, as far as the clip knows it. */
export function animFromClip(c) {
  const kindOf = { transition: "css-transition", "css-animation": "css-animation", waapi: "waapi" }
  const iterations = c.iterations === "infinite" ? Infinity : Number(c.iterations) || 1
  const timing = c.timing
    ? { ...c.timing }
    : {
        delay: Number(c.delay) || 0,
        duration: c.dur != null ? Number(c.dur) : c.end != null ? Math.max(0, (c.end - c.start - (Number(c.delay) || 0)) / (iterations === Infinity ? 1 : iterations)) : 0,
        iterations,
        direction: "normal",
        fill: "none",
        easing: "linear",
        playbackRate: 1,
      }
  timing.start = c.start
  timing.end = c.end == null ? null : c.end
  if (timing.activeStart == null) timing.activeStart = c.activeStart != null ? c.activeStart : c.start + (Number(timing.delay) || 0) / (Number(timing.playbackRate) || 1)
  const keyframes = c.kf || (c.from && c.to ? [{ offset: 0, easing: "linear", values: c.from }, { offset: 1, easing: "linear", values: c.to }] : [])
  return {
    id: c.id,
    relation: "on",
    selector: c.selector || null,
    kind: kindOf[c.kind] || c.kind || "waapi",
    ...(c.lib ? { lib: c.lib } : {}),
    name: c.kind === "transition" ? `${c.property || "?"} transition` : c.label || c.property || "animation",
    defined: c.def || null,
    ...(c.trigger ? { trigger: c.trigger } : {}),
    timing,
    keyframes,
    approx: !c.kf,
    ...(c.gsap ? { gsap: c.gsap } : {}),
  }
}

export { clockText, msText, FRAME }
