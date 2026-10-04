// An element's own animations, on its own clock. ⌘-clicking an element (the
// composer opens) makes it the dock's focus: a row under the lanes shows its
// clips; clicking one opens it, with a local ruler (0 = the end of its delay),
// keyframe ticks and sparklines of what it moves. On an open clip a click pins
// the note at that local time and a drag selects a range; Shift+drag on the
// track selects a range of recording time before any element is picked. The
// note then carries, for each animation, the exact point or range on its own
// clock, the keyframe segment, the values and the box there (CONTRACT.md
// "Note"), and src/note-text.js (NT) writes that for the agent.

const FOCUS_CLOSED_H = 26
const FOCUS_RULER_H = 14
const FOCUS_CAPSULE_H = 18
const SPARK_H = 10
const SPARK_N = 24
const SAMPLE_BUDGET_MS = 50
const RANGE_SAMPLES = 8
const MAX_ANIMS = 3

// The browser's own Animation methods, from the dock's window: the runtime
// patches the app frame's (it drives every animation from its clock), and a
// sample must not go through that.
const nativeAnim = {
  currentTime: Object.getOwnPropertyDescriptor(Animation.prototype, "currentTime"),
  playbackRate: Object.getOwnPropertyDescriptor(Animation.prototype, "playbackRate"),
  cancel: Animation.prototype.cancel,
}
const KF_META = ["offset", "easing", "composite", "computedOffset"]
const MOVES = /^(transform|translate|scale|rotate|opacity|filter|clip-?path|top|left|right|bottom|inset|width|height|offset)/i
const r3 = (n) => Math.round(n * 1000) / 1000
const kebabProp = (p) => String(p).replace(/[A-Z]/g, (c) => "-" + c.toLowerCase())

// ---- which animations are the element's -----------------------------------------------
// By the exact recorded path (the runtime's clipsFor is a prefix match on it):
// an element's own clips are its clipsFor minus its children's. A clip on an
// ancestor counts only if what it animates moves the element.

function ownClips(node) {
  const all = clipsOfElement(node)
  if (!all.length) return []
  const inner = new Set()
  const kids = [...node.children].slice(0, 80)
  for (const ch of kids) for (const c of clipsOfElement(ch)) inner.add(c)
  return all.filter((c) => !inner.has(c))
}
const clipProps = (c) => {
  if (c.kf && c.kf.length) return [...new Set(c.kf.flatMap((k) => Object.keys(k.values || {})))]
  if (c.kind === "transition" && c.property) return [c.property]
  if (c.from || c.to) return [...new Set([...Object.keys(c.from || {}), ...Object.keys(c.to || {})])]
  return String(c.property || "").split(/,\s*/).filter(Boolean)
}
const movesIt = (c) => {
  const props = clipProps(c)
  return !props.length || props.some((p) => MOVES.test(kebabProp(p)))
}

// { on: [{ clip, target, relation }], ancestors: [{ clip, target, relation, depth }], inside: [clip] }
function animGroups(el, pseudo) {
  const pt = D.PT
  if (pt && typeof pt.animationsOf === "function") {
    try {
      const r = pt.animationsOf(el, D.last ? shownTime(D.last) : 0)
      if (r && Array.isArray(r.on)) {
        const wrap = (c, target, relation, depth) => ({ clip: c.clip || c, target: c.el || target, relation: c.relation || relation, depth: c.depth || depth })
        return {
          on: r.on.map((c) => wrap(c, el, c.pseudoElement ? `pseudo ${c.pseudoElement}` : "on", 0)).filter((x) => !pseudo || (x.clip.pseudoElement || null) === pseudo),
          ancestors: (r.ancestors || []).map((c) => wrap(c, el.parentElement, "ancestor (moves it)", 1)),
          inside: (r.inside || []).map((c) => c.clip || c),
        }
      }
    } catch {}
  }
  let on = ownClips(el).map((c) => ({ clip: c, target: el, relation: c.pseudoElement ? `pseudo ${c.pseudoElement}` : "on", depth: 0 }))
  if (pseudo) on = on.filter((x) => (x.clip.pseudoElement || null) === pseudo)
  const ancestors = []
  for (let n = el.parentElement, d = 1; n && n.tagName !== "BODY" && n.tagName !== "HTML" && d <= 4; n = n.parentElement, d++) {
    for (const c of ownClips(n)) if (!c.pseudoElement && movesIt(c)) ancestors.push({ clip: c, target: n, relation: "ancestor (moves it)", depth: d })
  }
  const mine = new Set(ownClips(el))
  const inside = clipsOfElement(el).filter((c) => !mine.has(c))
  return { on, ancestors, inside }
}

const clipEndOf = (c) => (c.end == null ? (D.last ? Math.max(D.last.end, D.last.now) : c.start) : c.end)
const runningAt = (c, t) => c.start <= t + 0.5 && t <= clipEndOf(c) + 0.5
const overlapsRange = (c, r) => c.start <= r.to && clipEndOf(c) >= r.from

// An instant clip: 0ms (a library setting a value through an animation), or
// one that animates between equal values. It says nothing about the motion.
function instantClip(c) {
  if (c.end != null && c.end - c.start - (Number(c.delay) || 0) < 1) return true
  if (!(c.from && c.to && Object.keys(c.from).length && JSON.stringify(c.from) === JSON.stringify(c.to))) return false
  // First and last stops alike, but stops in between (a loop that comes back
  // to where it started: an equalizer bar, a pulse) is motion (F137).
  if (c.kfs > 2) return false
  const m = animModels.get(`${D.activeId}:${c.id}`)
  const kf = ((m && m.keyframes) || []).filter((k) => k && k.values)
  return !(kf.length > 2 && kf.some((k) => JSON.stringify(k.values) !== JSON.stringify(kf[0].values)))
}
// One animation's runs share this (the same @keyframes started again).
const clipKey = (c) => [c.kind, c.label, c.property || "", c.selector || "", c.pseudoElement || ""].join("|")

// The primary animation at t (or over a range): the element's own running one
// (latest start wins), else the nearest ancestor's that moves it. Instant
// clips only when nothing else is there.
function primaryEntry(groups, t, range) {
  const hits = (list) => list.filter((x) => (range ? overlapsRange(x.clip, range) : runningAt(x.clip, t)))
  const real = (list) => list.filter((x) => !instantClip(x.clip))
  const on = real(hits(groups.on)).sort((a, b) => b.clip.start - a.clip.start)
  if (on.length) return on[0]
  const up = real(hits(groups.ancestors)).sort((a, b) => a.depth - b.depth || b.clip.start - a.clip.start)
  if (up.length) return up[0]
  // Nothing running: the element's own animation that ran last before the moment ("at the end it should...").
  const before = real(groups.on).filter((x) => clipEndOf(x.clip) <= (range ? range.from : t) + 0.5).sort((a, b) => clipEndOf(b.clip) - clipEndOf(a.clip))
  if (before.length) return before[0]
  return hits(groups.on).sort((a, b) => b.clip.start - a.clip.start)[0] || null
}

// ---- an animation's model: keyframes and timing ------------------------------------------
// The recording's clip has its first and last keyframe (newer runtimes keep
// all of them, clip.kf); the Animation itself, while the moment on show has it,
// has everything. Read once and kept per clip.

const animModels = new Map() // `${branchId}:${clipId}` → anims[] entry without a point
function liveAnimOf(clip, target) {
  if (!target) return null
  let list = []
  try {
    list = target.getAnimations({ subtree: !!clip.pseudoElement })
  } catch {
    return null
  }
  const want = clip.pseudoElement || null
  const props = new Set(clipProps(clip))
  let best = null
  for (const a of list) {
    const fx = /** @type {any} */ (a.effect)
    if (!fx || fx.target !== target || (fx.pseudoElement || null) !== want) continue
    let score = 0
    if (clip.kind === "css-animation" && a.animationName === clip.label) score += 4
    if (clip.kind === "transition" && a.transitionProperty === clip.property) score += 4
    try {
      const kp = fx.getKeyframes().flatMap((k) => Object.keys(k).filter((p) => !KF_META.includes(p)))
      if (kp.some((p) => props.has(p))) score += 2
      const tm = fx.getTiming()
      const dur = clip.dur != null ? clip.dur : clip.end != null ? (clip.end - clip.start - (clip.delay || 0)) / (Number(clip.iterations) || 1) : null
      if (dur != null && Math.abs(Number(tm.duration) - dur) < 3) score += 1
    } catch {}
    if (score >= 2 && (!best || score > best.score)) best = { a, score }
  }
  return best ? best.a : null
}
function kfValues(k) {
  const out = {}
  let n = 0
  for (const p of Object.keys(k)) {
    if (KF_META.includes(p) || n >= 8 || k[p] == null || k[p] === "") continue
    out[p] = String(k[p]).slice(0, 120)
    n++
  }
  return out
}
function modelFromLive(clip, a) {
  const fx = /** @type {any} */ (a.effect)
  const tm = fx.getTiming()
  let rate = 1
  try {
    rate = nativeAnim.playbackRate.get.call(a) || 1
  } catch {}
  const base = NT.animFromClip(clip)
  const delay = Number(tm.delay) || 0
  const keyframes = fx
    .getKeyframes()
    .slice(0, 12)
    .map((k) => ({ offset: r3(k.computedOffset != null ? k.computedOffset : k.offset), easing: k.easing || "linear", values: kfValues(k) }))
  return {
    ...base,
    timing: {
      delay,
      duration: typeof tm.duration === "number" ? tm.duration : 0,
      endDelay: Number(tm.endDelay) || 0,
      iterations: tm.iterations === Infinity ? "infinite" : tm.iterations,
      direction: tm.direction || "normal",
      fill: tm.fill || "none",
      easing: tm.easing || "linear",
      playbackRate: rate,
      start: clip.start,
      activeStart: clip.start + delay / rate,
      end: clip.end == null ? null : clip.end,
    },
    keyframes,
    approx: false,
  }
}
// Motion (framer-motion) keyframes: the motion element's animate / transition
// props have what its inline style writes don't: every keyframe, `times`,
// the ease of each segment, the duration. Motion eases each segment on its
// own (one ease = that ease on every segment), so this is a model with
// per-keyframe easing and a linear effect, like WAAPI's. Springs, variants
// and functions aren't read (null).
const MOTION_EASE = {
  linear: "linear",
  easeIn: "cubic-bezier(0.42, 0, 1, 1)",
  easeOut: "cubic-bezier(0, 0, 0.58, 1)",
  easeInOut: "cubic-bezier(0.42, 0, 0.58, 1)",
  circIn: "cubic-bezier(0, 0.65, 0.55, 1)",
  circOut: "cubic-bezier(0.55, 0, 1, 0.45)",
  backIn: "cubic-bezier(0.31, 0.01, 0.66, -0.59)",
  backOut: "cubic-bezier(0.33, 1.53, 0.69, 0.99)",
}
const motionEase = (e) => (Array.isArray(e) && e.length === 4 && e.every((v) => typeof v === "number") ? `cubic-bezier(${e.join(", ")})` : typeof e === "string" ? MOTION_EASE[e] || null : null)
// A Motion value read off an inline style: x/y from translate, scale, rotate (deg), opacity.
function motionValueOf(key, inline) {
  const tr = String((inline && inline.transform) || "")
  const n = (re) => {
    const m = re.exec(tr)
    return m ? Number(m[1]) : null
  }
  if (key === "x") return n(/translateX\((-?[\d.]+)px\)/) ?? n(/translate(?:3d)?\((-?[\d.]+)px/)
  if (key === "y") return n(/translateY\((-?[\d.]+)px\)/) ?? n(/translate(?:3d)?\([^,]+,\s*(-?[\d.]+)px/)
  if (key === "scale") return n(/scale\((-?[\d.]+)\)/)
  if (key === "rotate") return n(/rotate\((-?[\d.]+)deg\)/)
  if (key === "opacity" && inline && inline.opacity != null && inline.opacity !== "") return Number(inline.opacity)
  return null
}
function motionModel(clip, el) {
  if (clip.kind !== "js" || !el) return null
  let p = null
  try {
    for (let f = fiberOf(el), i = 0; f && i < 4 && !p; f = f.return, i++) {
      const q = f.memoizedProps || {}
      if (q.animate && typeof q.animate === "object" && !Array.isArray(q.animate)) p = q
    }
  } catch {}
  if (!p) return null
  const tr = p.transition && typeof p.transition === "object" ? p.transition : {}
  const keys = Object.keys(p.animate).filter((k) => Array.isArray(p.animate[k]) && p.animate[k].length >= 2 && p.animate[k].every((v) => typeof v === "number" || /^-?[\d.]+(px|deg)?$/.test(String(v))))
  if (!keys.length) return null
  const tOf = (k) => (tr[k] && typeof tr[k] === "object" ? { ...tr, ...tr[k] } : tr)
  const t0 = tOf(keys[0])
  const spring = (t) => t.type === "spring" || (t.duration == null && (t.stiffness != null || t.damping != null || t.bounce != null))
  if (spring(t0)) return null
  const same = (t) => JSON.stringify([t.duration, t.delay, t.times, t.ease, t.repeat]) === JSON.stringify([t0.duration, t0.delay, t0.times, t0.ease, t0.repeat])
  const use = keys.filter((k) => p.animate[k].length === p.animate[keys[0]].length && same(tOf(k)))
  const n = p.animate[keys[0]].length
  const times = Array.isArray(t0.times) && t0.times.length === n ? t0.times.map(Number) : Array.from({ length: n }, (_, i) => i / (n - 1))
  const eases = Array.isArray(t0.ease) && !(t0.ease.length === 4 && t0.ease.every((v) => typeof v === "number")) ? t0.ease.map(motionEase) : Array.from({ length: n - 1 }, () => motionEase(t0.ease == null ? "easeInOut" : t0.ease))
  if (eases.some((e) => !e)) return null
  const duration = (t0.duration == null ? 0.8 : Number(t0.duration)) * 1000
  const delay = (Number(t0.delay) || 0) * 1000
  const keyframes = times.map((o, i) => ({ offset: r3(o), easing: i < n - 1 ? eases[i] || "linear" : "linear", values: Object.fromEntries(use.map((k) => [k, String(parseFloat(p.animate[k][i]))])) }))
  const iterations = t0.repeat ? (t0.repeat === Infinity ? "infinite" : Number(t0.repeat) + 1) : 1
  const base = NT.animFromClip(clip)
  const m = {
    ...base,
    lib: "motion",
    name: `${use.join(", ")} keyframes`,
    timing: { delay, duration, endDelay: 0, iterations, direction: t0.repeatType === "reverse" || t0.repeatType === "mirror" ? "alternate" : "normal", fill: "both", easing: "linear", playbackRate: 1, start: clip.start, activeStart: clip.start, end: clip.end == null ? null : clip.end },
    keyframes,
    motionKeyframes: true,
    leadMs: 0,
    approx: false,
  }
  // Where local 0 is: Motion writes nothing at 0, so the first recorded write
  // is a little in; its value says how far (found on the first segment).
  const k = use[0]
  const v1 = motionValueOf(k, clip.first)
  const a = Number(keyframes[0].values[k])
  const b = Number(keyframes[1].values[k])
  let lead = 0
  if (v1 != null && b !== a) {
    const f = NT.easingFn(keyframes[0].easing)
    const want = (v1 - a) / (b - a)
    let lo = 0
    let hi = 1
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2
      if (f(mid) < want) lo = mid
      else hi = mid
    }
    lead = ((lo + hi) / 2) * (times[1] - times[0]) * duration
    if (!(lead >= 0 && lead < 3 * FRAME_MS)) lead = 0
  }
  m.timing.activeStart = clip.start - lead
  m.timing.start = m.timing.activeStart - delay
  m.leadMs = Math.round(lead * 10) / 10
  return m
}

function modelOf(clip, target) {
  const key = `${D.activeId}:${clip.id}`
  const have = animModels.get(key)
  if (have && !have.approx) return have
  let m = null
  if (clip.kind === "js") m = motionModel(clip, target)
  if (m) {
    animModels.set(key, m)
    libOfElement(m, target)
    madeBy(m, clip)
    return m
  }
  if (clip.kf && clip.timing) m = NT.animFromClip(clip)
  else {
    const live = liveAnimOf(clip, target)
    if (live) {
      try {
        m = modelFromLive(clip, live)
        lookUpDefined(m, live)
      } catch {}
    }
  }
  if (m) {
    animModels.set(key, m)
    libOfElement(m, target)
    madeBy(m, clip)
    return m
  }
  if (have) return have
  const guess = NT.animFromClip(clip)
  animModels.set(key, guess)
  libOfElement(guess, target)
  madeBy(guess, clip)
  return guess
}

// element.animate()'s stack (clip.stack, from the runtime), through source
// maps: the first frame in the app's own code is where it is defined, and a
// library on the way (Motion, GSAP...) names what made it.
/** @type {[string, RegExp][]} */
const LIBS = [
  ["motion", /framer-motion|motion-dom|motion-utils|node_modules\/motion\//],
  ["gsap", /node_modules\/gsap\b|\bgsap[\w.-]*\.js/],
  ["anime", /animejs|anime\.es/],
  ["react-spring", /@react-spring|react-spring/],
]
const libOf = (s) => (LIBS.find(([, re]) => re.test(s)) || [])[0] || null
// What the element itself says about the library moving it: GSAP keeps a cache
// on its targets (_gsap); a Motion element's component (motion.div) holds the
// animate / transition props it was given.
function libOfElement(m, el) {
  if (!el || m.libChecked) return
  m.libChecked = true
  try {
    if (/** @type {any} */ (el)._gsap) m.lib = m.lib || "gsap"
    for (let f = fiberOf(el), i = 0; f && i < 4; f = f.return, i++) {
      const name = f.type && (f.type.displayName || f.type.name || (f.type.render && f.type.render.displayName))
      const p = f.memoizedProps || {}
      if (!/^motion\./.test(String(name || "")) && !(i > 0 && (p.animate || p.initial || p.whileInView) && p.transition !== undefined)) continue
      m.lib = m.lib || "motion"
      const json = (v) => {
        try {
          return JSON.stringify(v, (k, x) => (typeof x === "function" ? "[function]" : x))
        } catch {
          return null
        }
      }
      const props = {}
      for (const k of ["initial", "animate", "transition", "whileInView", "variants"]) if (p[k] !== undefined) props[k] = String(json(p[k]) || "").slice(0, 300)
      m.motionProps = { component: String(name || "motion"), props }
      break
    }
  } catch {}
}
// A library that drives the element from its own loop leaves no line of the
// app's on the stack: the element's own JSX (mapped by the time the note is
// saved) is where its motion is written, or its component for GSAP.
function definedByElement(a, desc) {
  const src = desc && desc.source
  if (a.defined || !src || !src.file || src.compiled) return
  const comp = desc.components && desc.components[0]
  if (a.lib === "motion") a.defined = { file: src.file, line: src.line || null, what: "the motion element's props (animate / transition)" }
  else if (a.lib === "gsap") a.defined = { file: src.file, line: null, what: `in ${comp || "the component that renders it"}: its gsap.to / from / timeline calls on this element` }
}

async function madeBy(m, clip) {
  if (m.madeBy || !Array.isArray(clip.stack) || !clip.stack.length || (m.kind !== "waapi" && m.kind !== "js")) return
  m.madeBy = true
  for (const fr of clip.stack) {
    let file = null
    let line = null
    const map = await loadMap(fr.url).catch(() => null)
    const pos = map && originalPosition(map, fr.line, fr.col)
    if (pos) {
      file = cleanSource(pos.source, map)
      line = pos.line
    }
    const lib = libOf(file || "") || libOf(fr.url)
    if (lib) {
      if (!m.lib) m.lib = lib
      continue
    }
    if (!file || libraryFile(file)) continue
    m.defined = { file: shortPath(file), line, what: m.kind === "js" ? (m.lib ? `${m.lib}, from here` : "the first style write") : m.lib ? `${m.lib} (it calls element.animate())` : "element.animate()" }
    break
  }
}
// Where a CSS animation is written (the runtime reads the stylesheet's source map).
function lookUpDefined(m, live) {
  const pt = D.PT
  if (!pt || typeof pt.cssSourceFor !== "function" || m.defined || !(m.kind === "css-animation" || m.kind === "css-transition")) return
  Promise.resolve()
    .then(() => pt.cssSourceFor(live))
    .then((r) => {
      if (!r) return
      // A stylesheet's URL is a path from the dev server's root: the project's own file.
      const where = (f) => (f ? shortPath(f) : "<style> in the page")
      if (r.keyframes && r.keyframes.line) m.defined = { file: where(r.keyframes.file || r.file), line: r.keyframes.line, what: `@keyframes ${r.keyframes.name}` }
      else if (r.line) m.defined = { file: where(r.file), line: r.line, what: m.kind === "css-transition" ? "transition rule" : "rule" }
      if (r.line) m.rule = { file: where(r.file), line: r.line, selector: r.selector || null }
    })
    .catch(() => {})
}

// ---- values and boxes at any moment of one animation ----------------------------------------

/** The element's box: on the page, in the viewport, its transform taken apart. */
function geometryOf(el) {
  const W = el.ownerDocument.defaultView
  const r = el.getBoundingClientRect()
  const cs = W.getComputedStyle(el)
  const sx = W.scrollX
  const sy = W.scrollY
  const tr = cs.transform
  let dec = { tx: 0, ty: 0, sx: 1, sy: 1, rotate: 0 }
  if (tr && tr !== "none") {
    try {
      const m = new DOMMatrix(tr)
      dec = { tx: r1(m.e), ty: r1(m.f), sx: r3(Math.hypot(m.a, m.b)), sy: r3(Math.hypot(m.c, m.d)), rotate: r1((Math.atan2(m.b, m.a) * 180) / Math.PI) }
    } catch {}
  }
  return {
    page: { x: r1(r.x + sx), y: r1(r.y + sy), w: r1(r.width), h: r1(r.height) },
    viewport: { x: r1(r.x), y: r1(r.y), w: r1(r.width), h: r1(r.height) },
    view: { w: W.innerWidth, h: W.innerHeight },
    scroll: { x: Math.round(sx), y: Math.round(sy) },
    transform: tr,
    decomposed: dec,
    origin: cs.transformOrigin,
    opacity: Number(cs.opacity),
  }
}

// The animation's values (and the element's box) at recording times Ts: the
// same keyframes and timing, as one extra animation on its element held at
// each time, read, and taken off again, all in one task (nothing paints).
// It sits above the app's own (the newest script animation wins), so what is
// read is this animation at that time; ancestors stay as the moment on show.
function sampleModel(model, el, target, pseudo, Ts) {
  const out = []
  if (!target || !Ts.length) return out
  const W = /** @type {any} */ (target.ownerDocument.defaultView)
  const t = model.timing || {}
  const props = [...new Set((model.keyframes || []).flatMap((k) => Object.keys(k.values || {})))].slice(0, 8)
  let tmp = null
  try {
    const frames = (model.keyframes || []).map((k) => ({ offset: k.offset, easing: k.easing || "linear", ...k.values }))
    const fx = new W.KeyframeEffect(target, frames, {
      duration: Number(t.duration) || 0,
      delay: Number(t.delay) || 0,
      endDelay: Number(t.endDelay) || 0,
      iterations: t.iterations === "infinite" ? Infinity : Number(t.iterations) || 1,
      direction: t.direction || "normal",
      easing: t.easing || "linear",
      fill: "both",
      ...(pseudo ? { pseudoElement: pseudo } : {}),
    })
    tmp = new W.Animation(fx, W.document.timeline)
  } catch {
    tmp = null
  }
  const rate = Number(t.playbackRate) || 1
  const t0 = performance.now()
  // Script-driven motion: no keyframes to hold at a time; only the moment on show can be read.
  const shownAt = model.kind === "js" && D.last ? shownTime(D.last) : null
  if (model.kind === "js" && tmp) {
    tmp = null
  }
  try {
    for (const T of Ts) {
      if (performance.now() - t0 > SAMPLE_BUDGET_MS) break
      // Motion keyframes read off its props: the values come from them; the box only at the moment on show.
      if (model.motionKeyframes) {
        const p = NT.pointOf(model, T)
        out.push({ T: r1(T), local: p.local, progress: p.progress, values: NT.valuesAt(model, T), geometry: shownAt != null && Math.abs(T - shownAt) <= 1 ? geometryOf(el) : null })
        continue
      }
      if (shownAt != null && Math.abs(T - shownAt) > 1) {
        const p = NT.pointOf(model, T)
        out.push({ T: r1(T), local: p.local, progress: p.progress, values: {}, geometry: null })
        continue
      }
      if (tmp) nativeAnim.currentTime.set.call(tmp, (T - (Number(t.start) || 0)) * rate)
      const cs = W.getComputedStyle(target, pseudo || null)
      const values = {}
      for (const p of props) values[p] = cs.getPropertyValue(kebabProp(p)).slice(0, 120)
      const p = NT.pointOf(model, T)
      out.push({ T: r1(T), local: p.local, progress: p.progress, values, geometry: geometryOf(el) })
    }
  } finally {
    if (tmp)
      try {
        nativeAnim.cancel.call(tmp)
      } catch {}
  }
  return out
}

// A point on the animation's clock with the values there and one frame either side.
function fullPoint(model, el, target, pseudo, T) {
  const p = NT.pointOf(model, T)
  const s = sampleModel(model, el, target, pseudo, [T - FRAME_MS, T, T + FRAME_MS])
  if (s.length === 3 && model.motionKeyframes) {
    p.values = s[1].values
    p.frame = { before: s[0].values, after: s[2].values }
    p.geometry = s[1].geometry || (D.last && Math.abs(shownTime(D.last) - T) <= 1 ? geometryOf(el) : null)
  } else if (s.length === 3 && model.kind === "js") {
    p.values = s[1].values
    p.geometry = s[1].geometry
  } else if (s.length === 3) {
    p.values = s[1].values
    p.frame = { before: s[0].values, after: s[2].values }
    p.geometry = s[1].geometry
  } else p.geometry = geometryOf(el)
  return p
}

// ---- the focus: the element the composer is about ---------------------------------------------

function focusOn(el, layer, t) {
  if (!el || !el.isConnected) return (D.focus = null)
  const pseudo = layer && layer.pseudo ? layer.pseudo : null
  const groups = animGroups(el, pseudo)
  const entries = [...groups.on, ...groups.ancestors]
  const label = `<${shortLabel(el)}>${pseudo || ""}`
  let selector = null
  try {
    selector = selectorInfo(el).selector
  } catch {}
  D.focus = { el, pseudo, label, selector, groups, entries, open: null, range: null, pin: null, touched: false, spark: null, hoverT: null, edges: null, group: null, groupN: 0 }
  D.focus.groupN = groupMembers(D.focus).length
  // A range dragged on the track before the element was picked comes with it.
  if (D.range) {
    D.focus.range = { ...D.range }
    D.range = null
    const hit = entries.find((x) => overlapsRange(x.clip, D.focus.range))
    if (hit) D.focus.open = openEntry(hit)
  } else {
    const p = primaryEntry(groups, t, null)
    if (p) modelOf(p.clip, p.target)
  }
  return D.focus
}
// Going to a moment swaps in a new frame: the focused element (and the
// targets of its animations) are found again in the document on show, with
// the open clip, the range and the point kept.
function syncFocusEl() {
  const f = D.focus
  if (!f || !D.frame) return f
  let doc = null
  try {
    doc = D.frame.contentDocument
  } catch {}
  if (!doc || (f.el && f.el.ownerDocument === doc)) return f
  const sel = (draft && draft.el && draft.el.selector) || (f.note && f.note.el && f.note.el.selector) || f.selector
  let el = null
  try {
    el = sel ? findEl(sel, doc) : null
  } catch {}
  if (!el) return f
  const groups = animGroups(el, f.pseudo)
  const entries = [...groups.on, ...groups.ancestors]
  f.el = el
  f.groups = groups
  f.entries = entries
  f.spark = null
  f.edges = null
  f.groupN = groupMembers(f).length
  if (f.group) f.group = { members: groupMembers(f) }
  if (f.open) {
    const x = entries.find((e) => e.clip.id === f.open.clip.id)
    if (x) f.open = { ...f.open, clip: x.clip, target: x.target, relation: x.relation }
    else if (f.open.target && f.open.target.ownerDocument !== doc) f.open = { ...f.open, target: el }
  }
  return f
}
function openEntry(x) {
  return { clip: x.clip, target: x.target, relation: x.relation, model: modelOf(x.clip, x.target) }
}
function clearFocus() {
  D.focus = null
  D.focusDrag = null
}

// Opening a clip fits the view to it and, if the playhead is outside it, goes
// to its start, where its Animation can be read.
function openFocusClip(clip) {
  const f = D.focus
  if (!f) return
  const x = f.entries.find((e) => e.clip === clip || e.clip.id === clip.id) || { clip, target: f.el, relation: "on" }
  // Closing it goes back to the view it was opened from.
  if (!f.open) f.prevView = { from: D.view.from, to: D.view.to }
  f.open = openEntry(x)
  f.spark = null
  const end = clipEndOf(clip)
  const pad = Math.max((end - clip.start) * 0.15, 10)
  setView(clip.start - pad, end + pad)
  const s = D.last
  if (s && !runningAt(clip, shownTime(s))) {
    const at = Math.min(f.open.model.timing.activeStart + 1, end)
    f.pin = null
    goTo(at)
  }
}
function closeFocusClip() {
  const f = D.focus
  if (f && f.group) {
    toggleGroup()
    return true
  }
  if (!f || !f.open) return false
  f.open = null
  f.range = null
  f.spark = null
  if (f.prevView) setView(f.prevView.from, f.prevView.to)
  else fitAll()
  f.prevView = null
  return true
}
function clearRange() {
  if (!D.range) return false
  D.range = null
  return true
}

// The model of the open clip, read again until the real one is in (the
// Animation is there once the playhead is inside the clip).
function openModel() {
  syncFocusEl()
  const o = D.focus && D.focus.open
  if (!o) return null
  if (o.model.approx) {
    const m = modelOf(o.clip, o.target)
    if (m !== o.model) {
      o.model = m
      D.focus.spark = null
    }
  }
  return o.model
}

// ---- the element row on the track -------------------------------------------------------------

// A short dock keeps the lanes readable: the row gives up its sparklines first.
function focusHeight(g) {
  const f = D.focus
  if (!f) return 0
  if (f.group) {
    const want = FOCUS_RULER_H + f.group.members.length * GROUP_LANE_H + 6
    const room = g ? g.h - RULER - 4 - MIN_PITCH * Math.max(1, D.branches.length) : want
    return Math.max(FOCUS_CLOSED_H, Math.min(want, room))
  }
  if (!f.open) return FOCUS_CLOSED_H
  const want = FOCUS_RULER_H + FOCUS_CAPSULE_H + sparkProps().length * SPARK_H + 6
  const room = g ? g.h - RULER - 4 - MIN_PITCH * Math.max(1, D.branches.length) : want
  return Math.max(FOCUS_RULER_H + FOCUS_CAPSULE_H, Math.min(want, room))
}
const focusKey = () => {
  const f = D.focus
  if (!f) return ""
  const m = f.open && f.open.model
  return [f.label, f.entries.length, f.group ? `g${f.group.members.length}` : f.groupN, f.open ? f.open.clip.id : "", m && m.approx ? 1 : 0, f.range ? `${f.range.from.toFixed(1)}-${f.range.to.toFixed(1)}` : "", f.pin, f.spark ? f.spark.n : 0, f.hoverT != null ? f.hoverT.toFixed(0) : "", f.hoverClip ? f.hoverClip.id : ""].join(",")
}

// Up to three properties that change most, for sparklines.
function sparkProps() {
  const sp = D.focus && D.focus.spark
  return sp ? sp.props : []
}
function ensureSpark() {
  const f = D.focus
  const o = f && f.open
  if (!o || f.spark || !D.last || D.last.playing || D.last.seeking) return
  const m = openModel()
  if (m.kind === "js") return void (f.spark = { Ts: [], samples: [], props: [], n: 0 })
  const t = m.timing
  const dur = Number(t.duration) || 0
  const iters = t.iterations === "infinite" ? 1 : Math.min(Number(t.iterations) || 1, 3)
  const span = dur * iters
  const Ts = []
  for (let i = 0; i < SPARK_N; i++) Ts.push(t.activeStart + ((span * i) / (SPARK_N - 1)) / (Number(t.playbackRate) || 1))
  const samples = sampleModel(m, f.el, o.target, o.clip.pseudoElement || null, Ts)
  const series = { tx: [], ty: [], scale: [], rotate: [], opacity: [], width: [], height: [] }
  for (const s of samples) {
    const g = s.geometry
    series.tx.push(g.page.x)
    series.ty.push(g.page.y)
    series.scale.push(g.decomposed.sx)
    series.rotate.push(g.decomposed.rotate)
    series.opacity.push(g.opacity)
    series.width.push(g.page.w)
    series.height.push(g.page.h)
  }
  const spread = (v) => (v.length ? Math.max(...v) - Math.min(...v) : 0)
  const norm = { tx: 1, ty: 1, scale: 0.01, rotate: 1, opacity: 0.01, width: 1, height: 1 }
  const props = Object.keys(series)
    .map((k) => ({ prop: k, values: series[k], spread: spread(series[k]) / norm[k] }))
    .filter((x) => x.spread >= 1)
    .sort((a, b) => b.spread - a.spread)
    .slice(0, 3)
  f.spark = { Ts: samples.map((s) => s.T), samples, props, n: samples.length }
}

// Snap points on an open clip: keyframe ticks, and 10ms steps of local time.
function focusTicks(m) {
  return (m.keyframes || []).map((k) => {
    const local = NT.localOfOffset(m, k.offset)
    return { offset: k.offset, local, t: NT.recordingOf(m, local) }
  })
}
function snapFocus(t, m, free) {
  const rate = Number(m.timing.playbackRate) || 1
  const dur = Number(m.timing.duration) || 0
  const iters = m.timing.iterations === "infinite" ? Infinity : Number(m.timing.iterations) || 1
  const lo = m.timing.activeStart
  const hi = Number.isFinite(iters) ? lo + (dur * iters) / rate : clipEndOf({ start: m.timing.start, end: m.timing.end })
  t = clamp(t, Math.min(lo, m.timing.start), Math.max(hi, lo))
  if (free) return t
  const ppm = pxPerMs(geom())
  for (const k of focusTicks(m)) if (Math.abs(k.t - t) * ppm <= SNAP_PX) return k.t
  const local = Math.round(((t - lo) * rate) / 10) * 10
  return lo + local / rate
}

function drawFocusRow(g, s) {
  const f = D.focus
  const R = D.focusRow
  if (!f || !R) return null
  const out = { y0: R.y0, h: R.h, open: !!f.open, capsules: [], insides: [], ticks: [], ruler: [], band: null, empty: false }
  ctx.save()
  ctx.fillStyle = "rgba(253,230,138,0.035)"
  ctx.fillRect(0, R.y0, g.w, R.h)
  ctx.fillStyle = INK.hair
  ctx.fillRect(0, R.y0, g.w, 1)
  ctx.font = '500 10px Geist, ui-sans-serif, system-ui, sans-serif'
  ctx.textBaseline = "middle"
  if (f.group) {
    drawGroupRow(g, R, out)
    ctx.restore()
    return out
  }
  if (!f.open) {
    const y = R.y0 + R.h / 2
    // "Whole group" sits at the row's right end when two or more children animate.
    const chipRoom = f.groupN >= 2 ? ctx.measureText(`Whole group · ${f.groupN}`).width + 30 : 0
    if (!f.entries.length) {
      out.empty = true
      let x = PAD_L + 2
      const lead = `Nothing animates on ${f.label}`
      ctx.fillStyle = INK.dim
      ctx.fillText(lead, x, y)
      x += ctx.measureText(lead).width + 10
      const groups = new Map()
      for (const c of f.groups.inside) {
        const k = (c.selector || "").split(" > ").pop().replace(/:nth-of-type\(\d+\)/g, "")
        const gk = groups.get(k) || { k, clips: [] }
        gk.clips.push(c)
        groups.set(k, gk)
      }
      if (groups.size) {
        ctx.fillStyle = INK.faint
        ctx.fillText("Inside:", x, y)
        x += ctx.measureText("Inside:").width + 6
        for (const gk of [...groups.values()].slice(0, 4)) {
          const text = `${gk.k}${gk.clips.length > 1 ? ` ×${gk.clips.length}` : ""}`
          const w = ctx.measureText(text).width
          if (x + w > g.w - chipRoom) break
          ctx.fillStyle = INK.lens
          ctx.fillText(text, x, y)
          out.insides.push({ x0: x, x1: x + w, y, clip: gk.clips[0] })
          x += w + 10
        }
      }
    } else {
      // Clips that overlap (a transform and an opacity transition started
      // together) stack in up to 3 thinner rows, so each can be opened.
      const shown = f.entries.filter((e) => clipEndOf(e.clip) >= D.view.from && e.clip.start <= D.view.to).map((e) => ({ e, x0: xOf(e.clip.start, g), x1: 0, row: 0 }))
      const ends = []
      for (const k of shown.sort((a, b) => a.x0 - b.x0)) {
        k.x1 = Math.max(k.x0 + 6, xOf(clipEndOf(k.e.clip), g))
        let r = ends.findIndex((x) => x < k.x0 - 2)
        if (r < 0) r = ends.length < 3 ? ends.length : ends.indexOf(Math.min(...ends))
        ends[r] = k.x1
        k.row = r
      }
      const rows = Math.max(1, ends.length)
      const ch = rows === 1 ? 14 : Math.max(6, Math.floor((R.h - 4) / rows) - 2)
      for (const k of shown) {
        const c = k.e.clip
        const cy = rows === 1 ? y : R.y0 + 3 + k.row * (ch + 2) + ch / 2
        ctx.fillStyle = k.e.relation === "ancestor (moves it)" ? "rgba(253,230,138,0.55)" : INK.lens
        roundRect(k.x0, cy - ch / 2, k.x1 - k.x0, ch, ch / 2)
        ctx.fill()
        const label = `${clipName(c)} · ${msWord(clipEndOf(c) - c.start)}`
        if (ch >= 10 && ctx.measureText(label).width + 12 <= k.x1 - k.x0) {
          ctx.fillStyle = INK.page
          ctx.fillText(label, k.x0 + 6, cy + 0.5)
        }
        out.capsules.push({ clip: c, x0: k.x0, x1: k.x1, y: cy, h: ch })
      }
    }
    if (f.groupN >= 2) drawGroupChip(g, R, out, false)
    ctx.restore()
    return out
  }
  const m = openModel()
  const t = m.timing
  const rate = Number(t.playbackRate) || 1
  const dur = Number(t.duration) || 0
  const iters = t.iterations === "infinite" ? Infinity : Number(t.iterations) || 1
  const yR = R.y0 + FOCUS_RULER_H
  const yc = yR + FOCUS_CAPSULE_H / 2
  const xs = xOf(t.start, g)
  const x0 = xOf(t.activeStart, g)
  const endT = clipEndOf(f.open.clip)
  const x1 = Math.max(x0 + 4, xOf(endT, g))
  // The delay, hatched, left of local 0.
  if (x0 - xs > 1) {
    ctx.save()
    ctx.beginPath()
    ctx.rect(xs, yc - 4, x0 - xs, 8)
    ctx.clip()
    ctx.strokeStyle = INK.faint
    ctx.lineWidth = 1
    for (let x = xs - 8; x < x0 + 8; x += 4) {
      ctx.beginPath()
      ctx.moveTo(x, yc + 4)
      ctx.lineTo(x + 8, yc - 4)
      ctx.stroke()
    }
    ctx.restore()
    out.delay = { x0: xs, x1: x0 }
  }
  ctx.fillStyle = INK.lens
  roundRect(x0, yc - 4, x1 - x0, 8, 4)
  ctx.fill()
  out.clip = { x0, x1, y: yc }
  // The local ruler: 0 at the end of the delay, in ms of the animation's own clock.
  const ppmLocal = pxPerMs(g) / rate
  const major = STEPS.find((st) => st * ppmLocal >= 56) || STEPS[STEPS.length - 1]
  const minor = STEPS.slice().reverse().find((st) => st < major && major % st === 0 && st * ppmLocal >= 7) || major
  const span = Number.isFinite(iters) ? dur * iters : Math.max(0, (endT - t.activeStart) * rate)
  ctx.font = MONO
  ctx.textBaseline = "alphabetic"
  const word = (ms) => (ms >= 1000 ? `${+(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`)
  for (let ms = 0, n = 0; ms <= span + 0.01 && n < 400; ms += minor, n++) {
    const x = Math.round(xOf(t.activeStart + ms / rate, g)) + 0.5
    if (x < -2 || x > g.w + 2) continue
    const isMajor = Math.round(ms) % major === 0
    ctx.fillStyle = isMajor ? INK.dim : INK.faint
    ctx.fillRect(x - 0.5, yR - (isMajor ? 5 : 3), 1, isMajor ? 4 : 2)
    if (isMajor) {
      const text = ms === 0 ? "0" : word(ms)
      const tw = ctx.measureText(text).width
      if (x + 2 + tw < g.w) ctx.fillText(text, x + 2, yR - 5)
      out.ruler.push(text)
    }
  }
  // The end of the animation's own clock, labelled (unless a step already is).
  if (Number.isFinite(span) && span > 0) {
    const xe = Math.round(xOf(t.activeStart + span / rate, g)) + 0.5
    const text = word(dur)
    if (!out.ruler.includes(text)) {
      ctx.fillStyle = INK.dim
      ctx.fillRect(xe - 0.5, yR - 5, 1, 4)
      if (xe + 2 + ctx.measureText(text).width < g.w) ctx.fillText(text, xe + 2, yR - 5)
      out.ruler.push(text)
    }
  }
  // Iteration boundaries of a loop.
  if (dur > 0 && iters > 1) {
    ctx.fillStyle = INK.faint
    for (let i = 1; i < Math.min(Number.isFinite(iters) ? iters : 400, 400); i++) {
      const T = t.activeStart + (i * dur) / rate
      if (T > endT) break
      ctx.fillRect(Math.round(xOf(T, g)), yc - 7, 1, 14)
    }
  }
  // Keyframe ticks, where each keyframe is reached.
  ctx.fillStyle = INK.white
  for (const k of focusTicks(m)) {
    const x = xOf(k.t, g)
    ctx.beginPath()
    ctx.moveTo(x, yc - 4)
    ctx.lineTo(x + 4, yc)
    ctx.lineTo(x, yc + 4)
    ctx.lineTo(x - 4, yc)
    ctx.closePath()
    ctx.fill()
    out.ticks.push({ offset: k.offset, local: Math.round(k.local), x: r1(x) })
  }
  // Sparklines: what moves, in coordinates.
  ensureSpark()
  const sp = D.focus.spark
  if (sp) {
    sp.props.forEach((pr, i) => {
      const top = yR + FOCUS_CAPSULE_H + 2 + i * SPARK_H
      if (top + SPARK_H > R.y0 + R.h + 1) return
      const lo = Math.min(...pr.values)
      const hi = Math.max(...pr.values)
      ctx.strokeStyle = INK.dim
      ctx.lineWidth = 1
      ctx.beginPath()
      pr.values.forEach((v, j) => {
        const x = xOf(sp.Ts[j], g)
        const y = top + SPARK_H - 2 - ((v - lo) / Math.max(hi - lo, 1e-6)) * (SPARK_H - 3)
        j ? ctx.lineTo(x, y) : ctx.moveTo(x, y)
      })
      ctx.stroke()
      ctx.fillStyle = INK.faint
      ctx.font = '500 8px "Geist Mono", ui-monospace, Menlo, monospace'
      ctx.textBaseline = "middle"
      ctx.fillText(pr.prop === "tx" ? "x" : pr.prop === "ty" ? "y" : pr.prop, Math.max(2, x1 + 4), top + SPARK_H / 2)
    })
    out.sparks = sp.props.map((p) => p.prop)
  }
  // The range, as a band with its handles and label.
  if (f.range) {
    const a = xOf(f.range.from, g)
    const b = Math.max(a + 1, xOf(f.range.to, g))
    ctx.fillStyle = hexAlpha(colorOf(activeBranch()), 0.18)
    ctx.fillRect(a, R.y0 + 1, b - a, R.h - 1)
    ctx.fillStyle = colorOf(activeBranch())
    ctx.fillRect(a - 1, R.y0 + 1, 2, R.h - 1)
    ctx.fillRect(b - 1, R.y0 + 1, 2, R.h - 1)
    const label = rangeLabel(f.range, m)
    ctx.font = '500 9px "Geist Mono", ui-monospace, Menlo, monospace'
    ctx.textBaseline = "middle"
    const lw = ctx.measureText(label).width
    const lx = clamp(a + 4, 2, g.w - lw - 4)
    ctx.fillStyle = INK.page
    roundRect(lx - 3, R.y0 + R.h - 13, lw + 6, 11, 3)
    ctx.fill()
    ctx.fillStyle = INK.white
    ctx.fillText(label, lx, R.y0 + R.h - 7.5)
    out.band = { x0: a, x1: b, label }
  }
  if (f.pin != null && !f.range) {
    const x = Math.round(xOf(f.pin, g)) + 0.5
    ctx.fillStyle = NOTE_FILL.pending
    ctx.fillRect(x - 0.5, R.y0 + 1, 1, R.h - 1)
    out.pin = x
  }
  ctx.restore()
  return out
}
// The "Whole group" toggle at the right end of the row (filled while on).
function drawGroupChip(g, R, out, on) {
  const f = D.focus
  const n = on ? f.group.members.length : f.groupN
  const text = `${on ? "✓ " : ""}Whole group · ${n}`
  ctx.font = '500 10px Geist, ui-sans-serif, system-ui, sans-serif'
  ctx.textBaseline = "middle"
  const w = ctx.measureText(text).width + 14
  const x0 = g.w - w - 8
  const y = on ? R.y0 + 8 : R.y0 + Math.min(R.h, FOCUS_CLOSED_H) / 2
  ctx.fillStyle = on ? INK.lens : INK.page
  roundRect(x0, y - 7, w, 14, 7)
  ctx.fill()
  ctx.strokeStyle = INK.lens
  ctx.lineWidth = 1
  roundRect(x0 + 0.5, y - 6.5, w - 1, 13, 6.5)
  ctx.stroke()
  ctx.fillStyle = on ? INK.page : INK.lens
  ctx.fillText(text, x0 + 7, y + 0.5)
  out.groupChip = { x0, x1: x0 + w, y, count: n, on }
}
// The group's row: a lane per member with its clips, the range or the pin across all of them.
function drawGroupRow(g, R, out) {
  const f = D.focus
  const members = f.group.members
  drawGroupChip(g, R, out, true)
  out.group = { lanes: members.length }
  ctx.font = '500 9px "Geist Mono", ui-monospace, Menlo, monospace'
  ctx.textBaseline = "middle"
  ctx.fillStyle = INK.dim
  const head = f.range ? `${Math.round(f.range.to - f.range.from)}ms range · on each one's own clock` : "click a moment or drag a range"
  ctx.fillText(head, PAD_L + 2, R.y0 + 8, Math.max(40, out.groupChip.x0 - PAD_L - 12))
  members.forEach((m, i) => {
    const y = R.y0 + FOCUS_RULER_H + i * GROUP_LANE_H + GROUP_LANE_H / 2
    if (y > R.y0 + R.h) return
    for (const x of m.entries) {
      if (instantClip(x.clip)) continue
      const a = xOf(x.clip.start, g)
      const b = Math.max(a + 3, xOf(clipEndOf(x.clip), g))
      if (b < 0 || a > g.w) continue
      ctx.fillStyle = INK.lens
      roundRect(a, y - 2, b - a, 4, 2)
      ctx.fill()
    }
  })
  const top = R.y0 + FOCUS_RULER_H - 2
  if (f.range) {
    const a = xOf(f.range.from, g)
    const b = Math.max(a + 1, xOf(f.range.to, g))
    ctx.fillStyle = hexAlpha(colorOf(activeBranch()), 0.18)
    ctx.fillRect(a, top, b - a, R.y0 + R.h - top)
    ctx.fillStyle = colorOf(activeBranch())
    ctx.fillRect(a - 1, top, 2, R.y0 + R.h - top)
    ctx.fillRect(b - 1, top, 2, R.y0 + R.h - top)
    out.band = { x0: a, x1: b, label: head }
  } else if (f.pin != null) {
    const x = Math.round(xOf(f.pin, g)) + 0.5
    ctx.fillStyle = NOTE_FILL.pending
    ctx.fillRect(x - 0.5, top, 1, R.y0 + R.h - top)
    out.pin = x
  }
}
function hexAlpha(hex, a) {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}
// "200–400ms · 10–20% of ticker"
function rangeLabel(r, m) {
  const a = NT.pointOf(m, r.from)
  const b = NT.pointOf(m, r.to)
  const pc = (p) => Math.round(p.progress * 100)
  return `${Math.round(a.local)}–${Math.round(b.local)}ms · ${pc(a)}–${pc(b)}% of ${m.name}`
}

// What's under a point of the element row (hitAt asks first).
function focusHit(x, y) {
  const sc = D.scene && D.scene.focus
  if (!sc || y < sc.y0 || y > sc.y0 + sc.h) return null
  const chip = sc.groupChip
  if (chip && x >= chip.x0 - 2 && x <= chip.x1 + 2 && Math.abs(y - chip.y) <= 9) return { kind: "focus-group" }
  if (sc.group) {
    if (sc.band && Math.abs(x - sc.band.x0) <= 4) return { kind: "range-edge", side: "from" }
    if (sc.band && Math.abs(x - sc.band.x1) <= 4) return { kind: "range-edge", side: "to" }
    return { kind: "focus-row", t: timeAt(x + geom().left) }
  }
  if (!sc.open) {
    const hits = sc.capsules.filter((c) => x >= c.x0 - 2 && x <= c.x1 + 2)
    if (hits.length) {
      const c = hits.reduce((a, b) => (Math.abs(b.y - y) < Math.abs(a.y - y) ? b : a))
      return { kind: "focus-clip", clip: c.clip }
    }
    for (const i of sc.insides) if (x >= i.x0 - 2 && x <= i.x1 + 2) return { kind: "focus-inside", clip: i.clip }
    return { kind: "focus-none" }
  }
  if (sc.band) {
    if (Math.abs(x - sc.band.x0) <= 4) return { kind: "range-edge", side: "from" }
    if (Math.abs(x - sc.band.x1) <= 4) return { kind: "range-edge", side: "to" }
  }
  return { kind: "focus-row", t: timeAt(x + geom().left) }
}

// ---- pointer and keys on the element row -------------------------------------------------------

// Returns true when the press was the element row's.
function focusPointerDown(e, hit) {
  const f = D.focus
  if (!f || !hit) return false
  D.focusHold = true
  if (hit.kind === "focus-none") return true
  if (hit.kind === "focus-group") {
    toggleGroup()
    return true
  }
  if (hit.kind === "focus-clip") {
    openFocusClip(hit.clip)
    return true
  }
  if (hit.kind === "focus-inside") {
    let el = null
    try {
      el = D.frame.contentDocument.querySelector(String(hit.clip.selector || "").replace(/::?[\w-]+$/, ""))
    } catch {}
    if (el && draft) {
      const t = draft.t
      draft.el = Object.assign(describe(el), { at: { dx: 0.5, dy: 0.5 } })
      focusOn(el, null, t)
      refreshComposer()
    }
    return true
  }
  const m = f.group ? null : openModel()
  if (!m && !f.group) return false
  track.setPointerCapture(e.pointerId)
  const s = D.last
  if (s && s.playing) D.PT.pause()
  if (hit.kind === "range-edge") {
    D.focusDrag = { x0: e.clientX, moved: true, edge: hit.side, anchor: hit.side === "from" ? f.range.to : f.range.from }
    return true
  }
  const t0 = f.group ? snapGroup(hit.t, e.altKey) : snapFocus(hit.t, m, e.altKey)
  D.focusDrag = { x0: e.clientX, moved: false, edge: null, anchor: t0 }
  return true
}
function focusPointerMove(e) {
  const d = D.focusDrag
  const f = D.focus
  if (!d || !f || (!f.open && !f.group)) return false
  if (!d.moved && Math.abs(e.clientX - d.x0) < DEAD_PX) return true
  d.moved = true
  const t = f.group ? snapGroup(timeAt(e.clientX), e.altKey) : snapFocus(timeAt(e.clientX), openModel(), e.altKey)
  const a = d.anchor
  f.range = { from: Math.min(a, t), to: Math.max(a, t) }
  f.pin = null
  scrubSoon(f.range.from)
  refreshComposer()
  return true
}
function focusPointerUp() {
  const d = D.focusDrag
  const f = D.focus
  if (!d) return false
  D.focusDrag = null
  if (!f || (!f.open && !f.group)) return true
  if (!d.moved) {
    f.range = null
    f.pin = d.anchor
    goTo(d.anchor)
  } else if (f.range) {
    if (f.range.to - f.range.from < 1) f.range = null
    else goTo(f.range.from)
  }
  f.touched = true
  refreshComposer()
  return true
}

// ← → on an open clip: a frame of its local time; with ⌥, keyframe to
// keyframe. With Shift, a range grows from the point (F129).
function focusStep(dir, { tick = false, extend = false } = {}) {
  const f = D.focus
  if (!f || !f.open || !D.last) return false
  const m = openModel()
  const s = D.last
  if (s.playing) D.PT.pause()
  if (extend) return extendRange(dir, tick, m, s)
  const toTick = tick
  const cur = f.pin != null ? f.pin : shownTime(s)
  let t
  if (toTick) {
    const ts = focusTicks(m).map((k) => k.t)
    t = dir > 0 ? ts.find((x) => x > cur + 0.5) : ts.reverse().find((x) => x < cur - 0.5)
    if (t == null) return true
  } else t = cur + (dir * FRAME_MS) / (Number(m.timing.playbackRate) || 1)
  const [lo, hi] = bounds(s)
  t = clamp(t, lo, hi)
  f.pin = t
  f.range = null
  D.keyT = t
  scrubTo(t)
  keepInView(t)
  clearTimeout(keyTimer)
  keyTimer = setTimeout(() => {
    D.keyT = null
    goTo(t)
  }, 350)
  refreshComposer()
  return true
}

// Shift+← → on an open clip: the range's moving edge steps 10ms of local time
// (stopping on a keyframe on the way), or with ⌥ to the next keyframe; the
// other edge stays where the point was. Back past it, the range turns round.
function extendRange(dir, tick, m, s) {
  const f = D.focus
  const rate = Number(m.timing.playbackRate) || 1
  const lo = m.timing.activeStart
  if (!f.range) {
    f.rangeAnchor = f.pin != null ? f.pin : shownTime(s)
    f.rangeEdge = f.rangeAnchor
  } else if (!sameRange(f.range, f.rangeAnchor, f.rangeEdge)) {
    // A dragged range: its far edge in the direction moves.
    f.rangeAnchor = dir > 0 ? f.range.from : f.range.to
    f.rangeEdge = dir > 0 ? f.range.to : f.range.from
  }
  const cur = f.rangeEdge
  const ticks = focusTicks(m).map((k) => k.t)
  const ahead = (x) => (dir > 0 ? x > cur + 0.5 : x < cur - 0.5)
  let t
  if (tick) {
    const next = (dir > 0 ? ticks : [...ticks].reverse()).find(ahead)
    if (next == null) return true
    t = next
  } else {
    const local = (cur - lo) * rate
    const step = dir > 0 ? Math.floor(local / 10 + 1e-6) * 10 + 10 : Math.ceil(local / 10 - 1e-6) * 10 - 10
    t = lo + step / rate
    const stop = (dir > 0 ? ticks : [...ticks].reverse()).find((x) => ahead(x) && (dir > 0 ? x < t - 0.5 : x > t + 0.5))
    if (stop != null) t = stop
  }
  const [blo, bhi] = bounds(s)
  t = snapFocus(clamp(t, blo, bhi), m, true)
  f.rangeEdge = t
  f.hoverT = null // the keys' range is read out, not the point under the pointer
  const a = f.rangeAnchor
  if (Math.abs(t - a) < 0.5) {
    f.range = null
    f.pin = a
  } else {
    f.range = { from: Math.min(a, t), to: Math.max(a, t) }
    f.pin = null
  }
  f.touched = true
  D.keyT = t
  scrubTo(t)
  keepInView(t)
  clearTimeout(keyTimer)
  keyTimer = setTimeout(() => {
    D.keyT = null
    goTo(t)
  }, 350)
  refreshComposer()
  return true
}

// ---- the element row by keys, and as buttons (F140, F141) ----------------------------------------

// The focused element's clips in the row's order.
const rowClips = (f) => [...f.entries].sort((a, b) => a.clip.start - b.clip.start || String(a.clip.id).localeCompare(String(b.clip.id)))
const clipWord = (c) => `${clipName(c)}${c.kind === "transition" ? " transition" : ""}`
// The hint says which clip is open (it's aria-live), then reads the playhead on it.
function sayClip(f) {
  const c = f.open.clip
  const list = rowClips(f)
  const i = list.findIndex((x) => x.clip.id === c.id)
  const more = list.length > 1 ? ` (${i + 1} of ${list.length}) · ↑↓ its other clips` : ""
  flash(`Open: ${clipWord(c)} · ${msWord(clipEndOf(c) - c.start)}${more} · Shift+←/→ range · Esc closes`, { warn: false })
}
// Enter or ↓ opens the focused element's main clip (the one a note would be
// about); with a clip open, ↑/↓ go to its other clips. Returns true when the key was the row's.
function focusClipKey(dir, enter = false) {
  const f = D.focus
  if (!f || f.group || !D.last) return false
  if (!f.open) {
    if (dir < 0) return false
    if (!f.entries.length) {
      if (enter) return false
      flash(`Nothing animates on ${f.label}${f.groupN >= 2 ? ` · G: whole group (${f.groupN})` : ""}`, { warn: false })
      return true
    }
    const p = primaryEntry(f.groups, f.pin != null ? f.pin : shownTime(D.last), f.range) || rowClips(f)[0]
    openFocusClip(p.clip)
  } else {
    if (enter) return false
    const list = rowClips(f)
    if (list.length > 1) {
      const i = list.findIndex((x) => x.clip.id === f.open.clip.id)
      f.range = null
      f.pin = null
      openFocusClip(list[(i + dir + list.length) % list.length].clip)
    }
  }
  sayClip(f)
  refreshComposer()
  return true
}
// G: Whole group on the focused container, or off again.
function groupKey() {
  const f = D.focus
  if (!f) return false
  if (!f.group && f.groupN < 2) {
    flash(`No whole group on ${f.label}: fewer than two of its children animate`, { warn: false })
    return true
  }
  toggleGroup()
  flash(f.group ? `Whole group on · ${f.group.members.length} animations · G or Esc leaves it` : `Whole group off · ${f.label}`, { warn: false })
  return true
}

// Canvas items can't be focused, read out or found by role: each capsule of
// the closed row, the open clip and the Whole group chip get a transparent
// button over them. A pointer press on one is the track's as before (its
// click, detail > 0, is skipped); Enter, Space or a screen reader press it.
const rowKeys = document.createElement("div")
rowKeys.className = "row-keys"
rowKeys.setAttribute("role", "group")
rowKeys.setAttribute("aria-label", "Animations of the picked element")
track.appendChild(rowKeys)
let rowKeysMemo = ""
function syncRowKeys(sc) {
  const f = D.focus
  const items = []
  if (f && sc) {
    if (!sc.open && !sc.group)
      for (const c of sc.capsules) items.push({ key: `c${c.clip.id}`, label: `Open ${clipWord(c.clip)}, ${msWord(clipEndOf(c.clip) - c.clip.start)}`, box: [c.x0, c.y - c.h / 2, c.x1 - c.x0, c.h], act: () => {
            openFocusClip(c.clip)
            sayClip(D.focus)
            refreshComposer()
          } })
    if (sc.open && sc.clip) items.push({ key: `o${f.open.clip.id}`, label: `Close ${clipWord(f.open.clip)}`, expanded: true, box: [sc.clip.x0, sc.clip.y - 7, sc.clip.x1 - sc.clip.x0, 14], act: () => closeFocusClip() })
    const chip = sc.groupChip
    if (chip) items.push({ key: "g", label: `Whole group, ${chip.count} animations`, pressed: chip.on, box: [chip.x0, chip.y - 7, chip.x1 - chip.x0, 14], act: () => groupKey() })
  }
  const memo = items.map((x) => `${x.key}:${x.label}:${x.pressed}:${x.box.map(Math.round).join(",")}`).join("|")
  if (memo === rowKeysMemo) return
  rowKeysMemo = memo
  const had = rowKeys.contains(document.activeElement)
  /** @type {Map<string, HTMLButtonElement>} */
  const old = new Map([...rowKeys.querySelectorAll("button")].map((b) => [b.dataset.key, b]))
  for (const x of items) {
    let b = old.get(x.key)
    old.delete(x.key)
    if (!b) {
      b = document.createElement("button")
      b.type = "button"
      b.dataset.key = x.key
    }
    rowKeys.appendChild(b)
    b.setAttribute("aria-label", x.label)
    if (x.pressed != null) b.setAttribute("aria-pressed", String(!!x.pressed))
    if (x.expanded) b.setAttribute("aria-expanded", "true")
    b.onclick = (e) => {
      if (e.detail > 0) return
      x.act()
    }
    const [l, t, w, h] = x.box
    b.style.cssText = `left:${l}px;top:${t}px;width:${Math.max(6, w)}px;height:${Math.max(10, h)}px`
  }
  for (const b of old.values()) b.remove()
  // The button pressed went (a capsule opened): the focus goes on to the row's first one.
  if (had && !rowKeys.contains(document.activeElement) && rowKeys.firstElementChild) /** @type {HTMLElement} */ (rowKeys.firstElementChild).focus({ preventScroll: true })
}

const sameRange = (r, a, b) => a != null && b != null && Math.abs(Math.min(a, b) - r.from) < 0.5 && Math.abs(Math.max(a, b) - r.to) < 0.5

// Shift+drag on the track: a range of recording time, before an element is picked.
function rangePointerDown(e, s) {
  track.setPointerCapture(e.pointerId)
  if (s.playing) D.PT.pause()
  const [lo, hi] = bounds(s)
  const t = clamp(snapped(timeAt(e.clientX), s, e.altKey), lo, hi)
  D.snapT = null
  D.rangeDrag = { anchor: t, x0: e.clientX }
  D.range = null
}
function rangePointerMove(e) {
  const d = D.rangeDrag
  const s = D.last
  if (!d || !s) return false
  if (Math.abs(e.clientX - d.x0) < DEAD_PX && !D.range) return true
  const [lo, hi] = bounds(s)
  const t = clamp(snapped(timeAt(e.clientX), s, e.altKey), lo, hi)
  D.snapT = null
  D.range = { from: Math.min(d.anchor, t), to: Math.max(d.anchor, t) }
  return true
}
function rangePointerUp() {
  const d = D.rangeDrag
  if (!d) return false
  D.rangeDrag = null
  if (D.range && D.range.to - D.range.from >= 1) {
    goTo(D.range.from)
    flash("Range selected: ⌘-click an element to comment on it", { warn: false })
  } else D.range = null
  return true
}
function drawRecordingRange(g) {
  const r = D.range
  if (!r) return null
  const a = xOf(r.from, g)
  const b = Math.max(a + 1, xOf(r.to, g))
  ctx.save()
  ctx.fillStyle = hexAlpha(colorOf(activeBranch()), 0.12)
  ctx.fillRect(a, RULER, b - a, g.h - RULER)
  ctx.fillStyle = colorOf(activeBranch())
  ctx.fillRect(a - 0.5, RULER, 1, g.h - RULER)
  ctx.fillRect(b - 0.5, RULER, 1, g.h - RULER)
  ctx.restore()
  return { x0: a, x1: b }
}

// ---- the readout: where the playhead is on the open clip's own clock ---------------------------

let readoutMemo = { key: "", text: "" }
function focusReadout(s, shownT) {
  const f = D.focus
  if (f && f.group && !s.playing) {
    const n = f.group.members.length
    if (f.range) return `Whole group · ${n} animations · ${fmt(f.range.from - s.start)} → ${fmt(f.range.to - s.start)} (${Math.round(f.range.to - f.range.from)}ms), each on its own clock`
    const T = f.hoverT != null ? f.hoverT : f.pin != null ? f.pin : shownT
    return `Whole group · ${n} animations · ${fmt(T - s.start)} · click a moment or drag a range`
  }
  if (f && !f.open && f.hoverClip && !s.playing) return `${clipName(f.hoverClip)}${f.hoverClip.kind === "transition" ? " transition" : ""} · ${msWord(clipEndOf(f.hoverClip) - f.hoverClip.start)} · click to open it on its own clock`
  if (!f || !f.open || s.playing) return ""
  const m = openModel()
  // A range (dragged, or grown with Shift+←/→): its edges on the animation's own clock.
  if (f.range && f.hoverT == null) return `Range ${rangeLabel(f.range, m)}`
  const T = f.hoverT != null ? f.hoverT : f.pin != null ? f.pin : shownT
  const end = clipEndOf(f.open.clip)
  if (T < m.timing.start - 0.5 || T > end + 0.5) return ""
  const key = `${f.open.clip.id}:${T.toFixed(1)}:${m.approx}:${f.hoverT != null}`
  if (readoutMemo.key === key) return readoutMemo.text
  const p = NT.pointOf(m, T)
  const dur = Math.round(Number(m.timing.duration) || 0)
  const bits = [m.name]
  if (m.kind === "scroll-driven") bits.push("scroll-driven", `${Math.round(p.progress * 100)}%`)
  else if (p.phase === "delay") bits.push(`in delay, ${Math.round(-p.local)}ms before 0`)
  else {
    if (p.iteration > 0) bits.push(`iteration ${p.iteration + 1}`)
    const iterLocal = Math.round(p.local - p.iteration * dur)
    bits.push(`${iterLocal}ms of ${dur}`, `${Math.round(p.progress * 100)}%`)
    if (p.segment) bits.push(`seg ${Math.round(p.segment.fromOffset * 100)}→${Math.round(p.segment.toOffset * 100)}% ${p.segment.easing}`)
  }
  // The box, read off the moment on show (the playhead's), not a sample.
  if (f.hoverT == null && Math.abs(T - shownT) < 1 && f.el && f.el.isConnected) {
    try {
      const g = geometryOf(f.el)
      const first = f.spark && f.spark.samples[0] && f.spark.samples[0].geometry
      const dx = first ? Math.round(g.page.x - first.page.x) : 0
      const dy = first ? Math.round(g.page.y - first.page.y) : 0
      bits.push(`x ${Math.round(g.page.x)} y ${Math.round(g.page.y)}${first && (dx || dy) ? ` (Δ${dx >= 0 ? "+" : ""}${dx}, ${dy >= 0 ? "+" : "−"}${Math.abs(dy)})` : ""}`, `${Math.round(g.page.w)}×${Math.round(g.page.h)}`)
      if (g.opacity !== 1) bits.push(`opacity ${+g.opacity.toFixed(2)}`)
    } catch {}
  }
  readoutMemo = { key, text: bits.join(" · ") }
  return readoutMemo.text
}

// ---- the path on the app: where the open clip moves the element --------------------------------

const pathSvg = $("#wb-path")
let pathKey = ""
function renderFocusOverlay(s) {
  const f = syncFocusEl()
  if (f && f.open && !f.spark) ensureSpark()
  const sp = f && f.open && f.spark
  const show = !!(sp && sp.samples.length > 1 && !s.playing && !s.seeking && D.frame)
  if (!show) {
    if (!pathSvg.hasAttribute("hidden")) pathSvg.setAttribute("hidden", "")
    pathKey = ""
    return
  }
  const fr = D.frame.getBoundingClientRect()
  const key = `${f.open.clip.id}:${sp.n}:${fr.left}:${fr.top}:${f.range ? f.range.from + "-" + f.range.to : ""}`
  // (An <svg> has no `hidden` property: the attribute is set and removed.)
  if (key === pathKey && !pathSvg.hasAttribute("hidden")) return
  pathKey = key
  const pts = sp.samples.map((x) => ({ T: x.T, x: fr.left + x.geometry.viewport.x + x.geometry.viewport.w / 2, y: fr.top + x.geometry.viewport.y + x.geometry.viewport.h / 2, g: x.geometry }))
  const box = (g, cls, label) => {
    const v = g.viewport
    return `<rect class="${cls}" x="${fr.left + v.x}" y="${fr.top + v.y}" width="${Math.max(v.w, 1)}" height="${Math.max(v.h, 1)}"/>${label ? `<text x="${fr.left + v.x}" y="${fr.top + v.y - 4}">${esc(label)}</text>` : ""}`
  }
  const m = f.open.model
  const ticks = focusTicks(m)
    .map((k) => pts.reduce((best, p) => (!best || Math.abs(p.T - k.t) < Math.abs(best.T - k.t) ? p : best), null))
    .filter(Boolean)
  let html = box(pts[0].g, "edge", "") + box(pts[pts.length - 1].g, "edge", "")
  html += `<polyline class="path" points="${pts.map((p) => `${r1(p.x)},${r1(p.y)}`).join(" ")}"/>`
  html += ticks.map((p) => `<circle class="tick" cx="${r1(p.x)}" cy="${r1(p.y)}" r="3"/>`).join("")
  if (f.range) {
    const inR = pts.filter((p) => p.T >= f.range.from - 1 && p.T <= f.range.to + 1)
    if (inR.length > 1) html += `<polyline class="path on" points="${inR.map((p) => `${r1(p.x)},${r1(p.y)}`).join(" ")}"/>`
    const edges = f.edges && f.edges.key === `${f.range.from}-${f.range.to}` ? f.edges : (f.edges = { key: `${f.range.from}-${f.range.to}`, list: sampleModel(m, f.el, f.open.target, f.open.clip.pseudoElement || null, [f.range.from, f.range.to]) })
    for (const e of edges.list) html += box(e.geometry, "edge on", `${Math.round(e.local)}ms`)
  }
  pathSvg.innerHTML = html
  pathSvg.dataset.points = String(pts.length)
  pathSvg.removeAttribute("hidden")
}

// ---- the composer and the note ---------------------------------------------------------------------

// The composer's line about where the note is: "at 100ms (20%) of fadeUp on <h1.title>".
function composerAt() {
  if (!draft || !D.focus) return ""
  const brief = notePayload(draft, { brief: true })
  return NT.atPhrase({ ...brief, el: draft.el }) || (D.focus.range ? `${fmt(D.focus.range.from - (D.last ? D.last.start : 0))} → ${fmt(D.focus.range.to - (D.last ? D.last.start : 0))} (recording) on ${D.focus.label}` : "")
}
function refreshComposer() {
  if (!draft) return
  // The moment in the header follows a point or range picked on the element's row.
  const time = card.querySelector(".note-meta .time")
  if (time && D.focus && (D.focus.pin != null || D.focus.range)) time.textContent = fmt((D.focus.range ? D.focus.range.from : D.focus.pin) - (D.last ? D.last.start : 0))
  const at = card.querySelector(".note-at")
  if (at) {
    const text = composerAt()
    at.textContent = text
    at.hidden = !text
  }
  updateAsked()
}
// Numbers typed in the note, read on the primary animation's own clock (a
// chip says how; clicking it switches to recording time).
function updateAsked() {
  const chip = card.querySelector(".note-asked")
  const ta = /** @type {HTMLTextAreaElement | null} */ (card.querySelector("textarea"))
  if (!chip || !ta || !draft) return
  const brief = notePayload(draft, { brief: true })
  const primary = NT.primaryOf(brief)
  const asked = NT.readAsked(ta.value, draft.askedReading === "recording" ? null : primary)
  draft.asked = asked
  if (!asked) {
    chip.hidden = true
    return
  }
  const dragged = D.focus && D.focus.range && D.focus.open
  const words = asked.reading === "local" && primary ? `${primary.name}'s own time${Number(primary.timing.delay) ? ` (after its ${Math.round(primary.timing.delay)}ms delay)` : ""}` : "recording time from the note's moment"
  chip.textContent = dragged ? `The dragged range is used; "${asked.text}" is kept as text` : `Reads "${asked.text}" as ${words}`
  chip.hidden = false
}

/**
 * The note's animation fields (CONTRACT.md "Note"): t, range, target, anims,
 * inside, asked, and group (a container's "Whole group"). `brief` skips the
 * samples (for the composer's own lines).
 */
function notePayload(d, { brief = false } = {}) {
  const f = syncFocusEl()
  const el = f && f.el
  const s = D.last
  let t = d.t
  if (f && f.range) t = f.range.from
  else if (f && f.pin != null) t = f.pin
  else if (f && f.touched && s) t = shownTime(s)
  const range = f && f.range ? { from: f.range.from, to: f.range.to } : null
  const out = { t, range, target: null, anims: [], inside: [], asked: d.asked || null, group: null, state: null, recent: null, media: null }
  if (!el || !el.isConnected) return out
  const groups = f.groups
  const chosen = f.open ? f.entries.find((x) => x.clip === f.open.clip) || { clip: f.open.clip, target: f.open.target, relation: f.open.relation } : null
  const primary = chosen || primaryEntry(groups, t, range)
  const all = [...groups.on, ...groups.ancestors]
  // One entry per animation: its repeats (the same @keyframes started again) are its runs; instant ones go last.
  const list = primary ? [primary] : []
  const keys = new Set(primary ? [clipKey(primary.clip)] : [])
  const live = all.filter((x) => (range ? overlapsRange(x.clip, range) : runningAt(x.clip, t))).sort((a, b) => (instantClip(a.clip) ? 1 : 0) - (instantClip(b.clip) ? 1 : 0))
  for (const x of live) {
    if (list.length >= MAX_ANIMS) break
    if (keys.has(clipKey(x.clip))) continue
    keys.add(clipKey(x.clip))
    list.push(x)
  }
  const ctx = { t, range, brief, d }
  out.anims = list.map((x, i) => {
    const a = animEntry(x, el, ctx, i === 0)
    const runs = all.filter((y) => clipKey(y.clip) === clipKey(x.clip)).map((y) => y.clip).sort((p, q) => p.start - q.start)
    if (runs.length > 1) a.runs = runs.slice(0, 60).map((c) => ({ id: c.id, start: r1(c.start), end: c.end == null ? null : r1(c.end) }))
    if (instantClip(x.clip)) a.instant = true
    return a
  })
  const insideSeen = new Set()
  for (const c of groups.inside) {
    const k = `${c.selector}:${c.label}`
    if (insideSeen.has(k) || out.inside.length >= 8) continue
    insideSeen.add(k)
    out.inside.push({ id: c.id, selector: c.selector || null, name: clipName(c) })
  }
  if (f.group) out.group = groupPayload(f, ctx)
  if (!brief) {
    out.target = targetOf(el, d, out.anims)
    out.state = stateOf(el, primary)
    // Nothing runs at the moment (a press is over before you can pause): what ran last, newest first (F144).
    if (!live.length) out.recent = recentOf(el, groups, range ? range.from : t)
    out.media = mediaOf(el, d)
  }
  return out
}

// The effects one trigger (a hover, a press, a focus) started on the element,
// its ::before/::after and inside it: the note is about that whole state (F143).
function stateOf(el, primary) {
  const tr = primary && primary.clip.trigger
  if (!tr) return null
  const effects = []
  for (const c of timeline().clips) {
    if (!c.trigger || c.trigger.t !== tr.t || c.trigger.kind !== tr.kind || effects.length >= 12) continue
    const on = clipElement(c, el.ownerDocument)
    if (!on || !(on === el || el.contains(on))) continue
    effects.push(clipBrief(c, on, el))
  }
  return effects.length ? { trigger: tr, effects } : null
}
function clipElement(c, doc) {
  try {
    return findEl(String(c.selector || "").replace(/::?[\w-]+$/, ""), doc)
  } catch {
    return null
  }
}
function clipBrief(c, on, el) {
  const out = { id: c.id, name: clipWord(c), on: on === el ? "this element" : `<${shortLabel(on)}>`, selector: c.selector || null, start: r1(c.start), end: c.end == null ? null : r1(c.end), dur: Math.round(clipEndOf(c) - c.start) }
  if (c.pseudoElement) out.pseudo = c.pseudoElement
  if (c.delay) out.delay = c.delay
  if (c.from) out.from = c.from
  if (c.to) out.to = c.to
  if (c.trigger) out.trigger = c.trigger
  return out
}
const RECENT_MAX = 6
function recentOf(el, groups, t) {
  const seen = new Set()
  const clips = [...groups.on.map((x) => x.clip), ...groups.inside]
    .filter((c) => c.start <= t + 0.5 && !instantClip(c) && !seen.has(c.id) && seen.add(c.id))
    .sort((a, b) => b.start - a.start)
    .slice(0, RECENT_MAX)
  const list = clips.map((c) => clipBrief(c, clipElement(c, el.ownerDocument) || el, el))
  return list.length ? list : null
}

// <video>/<audio> that move the picture: the element itself, inside it, or
// under the note's point (a background video behind text). Their motion is
// their frames: what plays, where it is, how fast (F146).
function mediaOf(el, d) {
  const doc = el.ownerDocument
  const found = []
  const add = (m, where) => found.length < 4 && !found.some((x) => x.m === m) && found.push({ m, where })
  if (el.matches("video, audio")) add(el, "this element")
  for (const m of el.querySelectorAll("video, audio")) add(m, "inside it")
  const r = el.getBoundingClientRect()
  const at = d && d.el && d.el.at
  if (at && r.width && r.height) for (const n of everythingAt(doc, r.x + r.width * at.dx, r.y + r.height * at.dy)) if (n.matches("video, audio")) add(n, "under the point")
  const out = found.map(({ m, where }) => {
    const src = m.currentSrc || m.getAttribute("src") || (m.querySelector("source") && m.querySelector("source").getAttribute("src")) || ""
    let selector = null
    try {
      selector = selectorInfo(m).selector
    } catch {}
    return {
      selector,
      label: `<${shortLabel(m)}>`,
      where,
      src: src.replace(/^[a-z]+:\/\/[^/]+/i, "").slice(0, 200),
      currentTime: r1(m.currentTime || 0),
      duration: Number.isFinite(m.duration) ? r1(m.duration) : null,
      loop: !!m.loop,
      playbackRate: m.playbackRate,
      // Paused with the dock: whether the app has it playing (the runtime keeps that).
      paused: !(m.__ptWants || !m.paused),
      muted: !!m.muted,
      autoplay: !!m.autoplay,
    }
  })
  return out.length ? out : null
}

// One anims[] entry: the animation's model, and the note's point (or range) on its clock.
function animEntry(x, el, { t, range, brief, d }, primary, { samples = true } = {}) {
  const m = modelOf(x.clip, x.target)
  const pseudo = x.clip.pseudoElement || null
  const a = { ...m, relation: x.relation, primary, selector: x.clip.selector || null }
  delete a.madeBy
  delete a.libChecked
  if (x.relation === "on" && el === x.target) definedByElement(a, d.el)
  if (x.clip.trigger) a.trigger = x.clip.trigger
  // One @keyframes on several elements: editing it changes them all.
  if (a.kind === "css-animation") {
    const seen = new Set([x.clip.selector])
    const shared = []
    for (const c of timeline().clips) {
      if (c.kind !== "css-animation" || c.label !== x.clip.label || seen.has(c.selector) || shared.length >= 8) continue
      seen.add(c.selector)
      // The element's own short selector, if it's on the page (the clip's is the full path).
      let sel = c.selector || null
      try {
        const other = D.frame.contentDocument.querySelector(String(c.selector || "").replace(/::?[\w-]+$/, ""))
        if (other) sel = selectorInfo(other).selector
      } catch {}
      shared.push({ id: c.id, selector: sel })
    }
    if (shared.length) a.shared = shared
  }
  if (brief) {
    if (range) {
      a.from = NT.pointOf(m, range.from)
      a.to = NT.pointOf(m, range.to)
    } else a.at = NT.pointOf(m, t)
    return a
  }
  if (range) {
    const lo = Math.max(range.from, m.timing.start)
    const hi = Math.min(range.to, clipEndOf(x.clip))
    a.from = fullPoint(m, el, x.target, pseudo, lo)
    a.to = fullPoint(m, el, x.target, pseudo, hi)
    a.openEnd = Math.abs(hi - clipEndOf(x.clip)) < 1
    a.keyframesInside = keyframesPassed(m, a.from, a.to)
    if (samples) {
      const Ts = []
      for (let k = 0; k < RANGE_SAMPLES; k++) Ts.push(lo + ((hi - lo) * k) / (RANGE_SAMPLES - 1))
      a.samples = sampleModel(m, el, x.target, pseudo, Ts)
    }
  } else a.at = fullPoint(m, el, x.target, pseudo, t)
  delete a.approx
  if (m.approx) a.approx = true
  return a
}

// ---- the whole group: every animation inside the focused element -------------------------------
// A container whose children run their own animations (an equalizer's bars):
// "Whole group" on its row makes one note about all of them. The row then
// shows each child's clips on a lane of its own; a click pins a moment and a
// drag a range of recording time, which the note gives on each child's own clock.

const GROUP_LANE_H = 7
const GROUP_MAX = 8

// The animated elements inside the focus, in document order: [{ el, entries }].
// The keyframe offsets a range passes. On a loop the range can cross the end
// of an iteration (or a turn, alternating), and in a reversed iteration its
// start is the higher offset (F138).
function keyframesPassed(m, f, to) {
  const offs = (m.keyframes || []).map((k) => k.offset)
  const e = 1e-4
  const i0 = f.iteration || 0
  const i1 = to.iteration || 0
  if (i1 === i0) {
    const lo = Math.min(f.eased, to.eased)
    const hi = Math.max(f.eased, to.eased)
    return offs.filter((o) => o > lo + e && o < hi - e)
  }
  if (i1 > i0 + 1) return offs
  const dir = (m.timing && m.timing.direction) || "normal"
  const rev = (i) => dir === "reverse" || (dir === "alternate" && i % 2 === 1) || (dir === "alternate-reverse" && i % 2 === 0)
  const [r0, r1] = [rev(i0), rev(i1)]
  return offs.filter((o) => (r0 ? o < f.eased - e : o > f.eased + e) || (r1 ? o > to.eased + e : o < to.eased - e))
}
function groupMembers(f) {
  if (!f || !f.el) return []
  const doc = f.el.ownerDocument
  const bySel = new Map()
  for (const c of f.groups.inside) {
    if (c.pseudoElement || !c.selector) continue
    if (!bySel.has(c.selector)) bySel.set(c.selector, [])
    bySel.get(c.selector).push(c)
  }
  const out = []
  for (const [sel, clips] of bySel) {
    let el = null
    try {
      el = findEl(sel, doc)
    } catch {}
    if (!el || el === f.el || !f.el.contains(el) || out.some((m) => m.el === el)) continue
    if (clips.every(instantClip)) continue
    out.push({ el, entries: clips.map((c) => ({ clip: c, target: el, relation: "on", depth: 0 })) })
  }
  out.sort((a, b) => (a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
  return out.slice(0, GROUP_MAX)
}
function toggleGroup() {
  const f = D.focus
  if (!f) return
  if (f.group) {
    f.group = null
    f.range = null
    f.pin = null
  } else {
    const members = groupMembers(f)
    if (members.length < 2) return
    if (f.open) closeFocusClip()
    f.group = { members }
    f.pin = null
  }
  refreshComposer()
}
// Snap points on the group's row: its members' starts and ends, else 10ms of recording time.
function snapGroup(t, free) {
  const s = D.last
  const [lo, hi] = bounds(s)
  t = clamp(t, lo, hi)
  if (free) return t
  const ppm = pxPerMs(geom())
  for (const m of D.focus.group.members)
    for (const x of m.entries) for (const k of [x.clip.start, clipEndOf(x.clip)]) if (Math.abs(k - t) * ppm <= SNAP_PX) return k
  return s.start + Math.round((t - s.start) / 10) * 10
}
// The note's group: each member's main animation at the note's moment, on its own clock.
function groupPayload(f, ctx) {
  const members = []
  for (const m of f.group.members) {
    if (!m.el.isConnected) continue
    const p = primaryEntry({ on: m.entries, ancestors: [] }, ctx.t, ctx.range)
    let label = null
    let selector = null
    try {
      label = `<${shortLabel(m.el)}>`
      selector = selectorInfo(m.el).selector
    } catch {}
    const anim = p ? animEntry(p, m.el, { ...ctx, d: { el: null } }, true, { samples: false }) : null
    if (anim) delete anim.primary
    members.push({ selector, label, anim })
  }
  return { selector: f.selector, label: f.label, members }
}

function targetOf(el, d, anims) {
  const doc = el.ownerDocument
  const desc = d.el || {}
  let matches = null
  let index = null
  try {
    const all = [...doc.querySelectorAll(desc.selector)]
    matches = all.length
    index = all.indexOf(el) + 1 || null
  } catch {}
  const onClip = anims.find((a) => a.relation === "on")
  const clip = onClip && timeline().clips.find((c) => c.id === onClip.id)
  const picked = d.picked || { via: "topmost", skipped: [] }
  return {
    path: clip && clip.path ? clip.path : null,
    selector: desc.selector,
    matches,
    ...(index && matches > 1 ? { index } : {}),
    hint: [desc.text ? `"${desc.text.slice(0, 40)}"` : null, desc.components && desc.components[0], desc.source && desc.source.file ? `${desc.source.file}${desc.source.line ? ":" + desc.source.line : ""}` : null].filter(Boolean).join(" · "),
    tag: desc.label,
    text: desc.text || "",
    role: el.getAttribute("role") || null,
    ariaLabel: el.getAttribute("aria-label") || null,
    picked,
    source: desc.source ? { ...desc.source, confidence: desc.source.confidence || (desc.source.compiled ? "unknown" : "exact") } : null,
    geometry: geometryOf(el),
  }
}

// A saved note shown again: its element row, opened clip and range come back.
function focusFromNote(n) {
  const a = n.anims && (n.anims.find((x) => x.primary) || n.anims[0])
  let el = null
  try {
    el = D.frame.contentDocument.querySelector(n.el.selector)
  } catch {}
  if (!el) return clearFocus()
  focusOn(el, n.el.pseudo ? { pseudo: n.el.pseudo.pseudoElement } : null, n.t)
  const f = D.focus
  if (!f) return
  if (n.group && n.group.members && n.group.members.length) {
    const members = groupMembers(f)
    if (members.length) f.group = { members }
  } else if (a) {
    const x = f.entries.find((e) => e.clip.id === a.id)
    if (x) f.open = openEntry(x)
  }
  if (n.range) f.range = { ...n.range }
  else if (f.open || f.group) f.pin = n.t
}

// A double-click on an open clip's row closes it.
track.addEventListener("dblclick", (e) => {
  const g = geom()
  const hit = focusHit(e.clientX - g.left, e.clientY - g.top)
  if (hit && (hit.kind === "focus-row" || hit.kind === "range-edge")) closeFocusClip()
})
