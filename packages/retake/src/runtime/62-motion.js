// Script-driven motion: an element whose inline style a script rewrites frame
// after frame (GSAP, Motion's x/y/scale, a parallax handler). It never shows
// up as an Animation, so it's read off the DOM log (logMutations hands every
// style attribute change here): writes on one element less than MOTION_GAP
// apart are one clip, kind "js", with the properties that changed and their
// first and last inline values; once it is a clip, a still stretch of up to
// MOTION_HOLD is part of it (clip.holds: [from, to] pairs). A clip is recorded from its third write (one
// style change is a state, not motion). Where it's written comes from one
// stack per element, taken at its first write through the style setters.

const MOTION_GAP = 120
const MOTION_HOLD = 1000
const MOTION_MIN_WRITES = 3
const MOTION_PROPS = /^(transform|translate|scale|rotate|opacity|top|left|right|bottom|width|height|filter|clip-path)$/
const motionRuns = new WeakMap() // element -> { c, last, writes, from, to }
const styleStack = new WeakMap() // CSSStyleDeclaration -> stack at its first write

function parseInline(s) {
  const out = {}
  for (const part of String(s || "").split(";")) {
    const i = part.indexOf(":")
    if (i > 0) out[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 1).trim()
  }
  return out
}

// The properties that moved (a reset to none that was never set isn't motion).
const movedProps = (run) => Object.keys(run.from).filter((p) => !((run.from[p] === "" || run.from[p] === "none") && (run.to[p] === "" || run.to[p] === "none")))

function noteStyleWrite(el, t, old, now) {
  if (!rec || previewing || hasFuture() || clock.seeking || !el || el.nodeType !== 1) return
  const a = parseInline(old)
  const b = parseInline(now)
  const changed = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((p) => a[p] !== b[p] && MOTION_PROPS.test(p))
  if (!changed.length) return
  let run = motionRuns.get(el)
  // A pause of up to MOTION_HOLD inside a clip is a hold of the same motion
  // (Motion keyframes with a plateau write nothing while the value stays).
  if (run && run.c && t - run.last > MOTION_GAP && t - run.last <= MOTION_HOLD) (run.c.holds || (run.c.holds = [])).push([run.last, t])
  else if (!run || t - run.last > MOTION_GAP) {
    run = { c: null, start: t, last: t, writes: 0, from: {}, to: {}, first: b }
    motionRuns.set(el, run)
  }
  run.last = t
  run.writes++
  for (const p of changed) {
    if (!(p in run.from)) run.from[p] = a[p] || ""
    run.to[p] = b[p] || ""
  }
  if (!run.c && run.writes >= MOTION_MIN_WRITES) {
    const clips = rec.clips || (rec.clips = [])
    const props = movedProps(run)
    if (!props.length) return
    const pick = (o) => Object.fromEntries(props.map((p) => [p, o[p]]))
    /** @type {Record<string, any>} */
    const c = { id: `c${clips.length + 1}`, kind: "js", start: run.start, end: t, label: props.join(", "), selector: selectorOf(el), component: componentOf(el) || undefined, property: props.join(", "), path: pathOf(el), from: pick(run.from), to: pick(run.to), first: pick(run.first) }
    if (c.component === undefined) delete c.component
    const frames = stackFrames(styleStack.get(el.style))
    if (frames.length) c.stack = frames
    clips.push(c)
    run.c = c
  } else if (run.c) {
    const props = movedProps(run)
    run.c.end = t
    run.c.label = run.c.property = props.join(", ")
    run.c.from = Object.fromEntries(props.map((p) => [p, run.from[p]]))
    run.c.to = Object.fromEntries(props.map((p) => [p, run.to[p]]))
  }
}

// One stack per element: the first write to one of these through its style.
;(function wrapStyleSetters() {
  const SP = typeof CSSStyleDeclaration !== "undefined" ? CSSStyleDeclaration.prototype : null
  if (!SP) return
  // The property accessors live on the style object's own interface (CSSStyleProperties in newer browsers).
  const owner = (p) => {
    for (let o = Object.getPrototypeOf(document.documentElement.style); o; o = Object.getPrototypeOf(o)) if (Object.prototype.hasOwnProperty.call(o, p)) return o
    return null
  }
  const keep = (decl) => {
    if (styleStack.has(decl)) return
    try {
      const limit = Error.stackTraceLimit
      Error.stackTraceLimit = 30
      styleStack.set(decl, new Error().stack)
      Error.stackTraceLimit = limit
    } catch {}
  }
  for (const p of ["transform", "translate", "scale", "rotate", "opacity", "top", "left", "width", "height"]) {
    const proto = owner(p)
    const d = proto && Object.getOwnPropertyDescriptor(proto, p)
    if (!d || !d.set || !d.configurable) continue
    Object.defineProperty(proto, p, {
      ...d,
      set(v) {
        keep(this)
        d.set.call(this, v)
      },
    })
  }
  const setProperty = SP.setProperty
  SP.setProperty = function (name, ...rest) {
    if (MOTION_PROPS.test(String(name))) keep(this)
    return setProperty.call(this, name, ...rest)
  }
})()
