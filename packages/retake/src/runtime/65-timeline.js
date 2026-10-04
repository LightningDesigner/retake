// What the dock draws: markers (things you did) and clips (things that
// animated), derived from the recording and the animation log. See
// CONTRACT.md ("Runtime API").

// ---- describing elements ------------------------------------------------------

function cssEscape(s) {
  return W.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/[^\w-]/g, (c) => "\\" + c)
}

// A readable, valid selector: an id if there is one, else tag.class chains
// with :nth-of-type where needed, up to <body>.
function selectorOf(el) {
  if (!el || el.nodeType !== 1) return null
  const parts = []
  for (let n = el; n && n.nodeType === 1 && n.tagName !== "HTML"; n = n.parentElement) {
    if (n.id) {
      parts.unshift(`#${cssEscape(n.id)}`)
      break
    }
    let part = n.tagName.toLowerCase()
    const cls = [...n.classList].filter((c) => /^[a-z][\w-]*$/i.test(c)).slice(0, 2)
    if (cls.length) part += "." + cls.map(cssEscape).join(".")
    const same = n.parentElement ? [...n.parentElement.children].filter((c) => c.tagName === n.tagName) : []
    if (same.length > 1) part += `:nth-of-type(${same.indexOf(n) + 1})`
    parts.unshift(part)
    if (n.tagName === "BODY") break
  }
  return parts.join(" > ")
}

// Nearest named React component, unwrapping memo/forwardRef.
function componentOf(el) {
  try {
    const key = el && Object.keys(el).find((k) => k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$"))
    for (let f = key && el[key]; f; f = f.return) {
      let t = f.type
      if (t && typeof t === "object") t = t.render || t.type || null
      if (t && typeof t === "object") t = t.render || null
      const name = typeof t === "function" ? t.displayName || t.name : null
      if (name && /^[A-Z]/.test(name)) return name
    }
  } catch {}
  return null
}

function labelOf(el) {
  if (!el || el.nodeType !== 1) return ""
  const aria = el.getAttribute("aria-label") || el.getAttribute("title") || el.getAttribute("placeholder")
  const text = aria || (el.innerText || el.textContent || "").trim().replace(/\s+/g, " ")
  const tag = el.tagName.toLowerCase()
  return text ? text.slice(0, 40) : tag + (el.id ? "#" + el.id : "")
}

// ---- markers ------------------------------------------------------------------

// Markers are the user's actions only (causes, not effects): clicks,
// submits, route changes, focus into a field, and typing, one marker per
// burst (keystrokes under 800ms apart in one field) with an end.
const TYPE_GAP = 800
let markerCache = null
function markersOf() {
  const key = rec.events.length + ":" + (rec.routes ? rec.routes.length : 0) + ":" + (rec.start || 0)
  if (markerCache && markerCache.key === key) return markerCache.value
  const out = []
  let burst = null
  const start = rec.start || 0
  for (const ev of rec.events) {
    if (ev.t < start) continue
    if (ev.type === "click") {
      // Clicking into a field focused it first (on mousedown): one marker, the click.
      const prev = out[out.length - 1]
      if (prev && prev.kind === "focus" && prev.selector === ev.css && ev.t - prev.t < 1000) out.pop()
      out.push({ t: ev.t, kind: "click", label: ev.label || "click", selector: ev.css || undefined })
    }
    else if (ev.type === "submit") out.push({ t: ev.t, kind: "submit", label: ev.label || "submit", selector: ev.css || undefined })
    else if (ev.type === "focusin" && ev.editable) {
      // Clicking into a field already made a click marker there.
      const prev = out[out.length - 1]
      if (!(prev && prev.kind === "click" && prev.selector === ev.css && ev.t - prev.t < 50)) out.push({ t: ev.t, kind: "focus", label: ev.label || "field", selector: ev.css || undefined })
    } else if (ev.type === "input") {
      const typed = /^insert/.test(ev.inputType || "insertText") ? (ev.data ? ev.data.length : 1) : 0
      if (burst && burst.selector === (ev.css || undefined) && ev.t - burst.end < TYPE_GAP) {
        burst.end = ev.t
        burst.chars += typed
      } else {
        burst = { t: ev.t, end: ev.t, kind: "type", chars: typed, selector: ev.css || undefined }
        out.push(burst)
      }
    }
  }
  for (const m of out) {
    if (m.kind === "type") {
      m.label = `typed ${m.chars} char${m.chars === 1 ? "" : "s"}`
      delete m.chars
    }
  }
  for (const r of rec.routes || []) if (r.t >= start) out.push({ t: r.t, kind: "route", label: r.path })
  out.sort((a, b) => a.t - b.t)
  markerCache = { key, value: out }
  return out
}

// ---- clips --------------------------------------------------------------------

function clipKind(a) {
  if (typeof CSSTransition !== "undefined" && a instanceof CSSTransition) return "transition"
  if (typeof CSSAnimation !== "undefined" && a instanceof CSSAnimation) return "css-animation"
  return "waapi"
}

function clipEnd(e) {
  if (e.vEnd != null) return e.vEnd
  const t = e.timing || {}
  const total = (Number(t.delay) || 0) + (Number(t.duration) || 0) * (t.iterations == null ? 1 : t.iterations) + (Number(t.endDelay) || 0)
  return Number.isFinite(total) ? e.vStart + total / (e.rate || 1) : null
}

// Clips live in the recording (rec.clips), so a rebuilt frame still knows
// the whole timeline's clips, including the ones after the playhead. They're
// described once, when the animation starts at the live edge.
const clipOfEntry = new WeakMap()
function describeClip(e) {
  const a = e.anim
  const kind = clipKind(a)
  const props = [...new Set((e.keyframes || []).flatMap((k) => Object.keys(k).filter((p) => !["offset", "easing", "composite", "computedOffset"].includes(p))))]
  const property = kind === "transition" ? a.transitionProperty : props.join(", ") || undefined
  const label = kind === "css-animation" ? a.animationName : kind === "transition" ? `${a.transitionProperty} transition` : props.length ? props.join(", ") : "animation"
  const pseudo = (a.effect && a.effect.pseudoElement) || null
  return { kind, label, selector: selectorOf(e.target) + (pseudo || ""), component: componentOf(e.target) || undefined, property, pseudoElement: pseudo }
}
// The recorded start of the clip a new animation replays, if there is one:
// same element, kind and property/name, not yet claimed, started near now.
const claimedClips = new WeakSet()
function recordedStart(a) {
  const target = a.effect && a.effect.target
  if (!target || !rec || !rec.clips) return null
  const path = pathOf(target)
  if (!path || !Array.isArray(path)) return null
  const key = path.join(",")
  const kind = clipKind(a)
  const pseudo = (a.effect && a.effect.pseudoElement) || null
  const name = kind === "transition" ? a.transitionProperty : kind === "css-animation" ? a.animationName : null
  let best = null
  for (const c of rec.clips) {
    if (claimedClips.has(c) || c.kind !== kind || (c.pseudoElement || null) !== pseudo || !c.path) continue
    if (c.start > clock.now + 250 || c.start < clock.now - 250) continue
    if (name != null && (kind === "transition" ? c.property : c.label) !== name) continue
    if (c.path.join(",") !== key) continue
    if (!best || Math.abs(c.start - clock.now) < Math.abs(best.start - clock.now)) best = c
  }
  if (!best) return null
  claimedClips.add(best)
  return best.start
}

const KF_SKIP = ["offset", "easing", "composite", "computedOffset"]
function keyframeValues(k) {
  const out = {}
  let n = 0
  for (const p of Object.keys(k)) {
    if (KF_SKIP.includes(p) || n >= 4 || k[p] == null) continue
    const v = String(k[p])
    if (v.length <= 80) (out[p] = v), n++
  }
  return out
}
// The frames of an element.animate() stack that aren't Retake's own (an
// inline script in this document): [{ url, line, col }], innermost first.
function stackFrames(stack) {
  const here = location.href.replace(/#.*$/, "")
  const out = []
  for (const line of String(stack || "").split("\n").slice(1)) {
    const m = /\(?((?:https?|file|webpack-internal):\/\/[^\s()]+?):(\d+):(\d+)\)?\s*$/.exec(line)
    if (!m || m[1] === here) continue
    out.push({ url: m[1], line: Number(m[2]), col: Number(m[3]) })
    if (out.length >= 12) break
  }
  return out
}
// What started a clip (F143): the user's input just before it, on the
// element, inside it, or around it (a :hover rule on a parent styles its
// children): { kind: hover|unhover|press|release|click|focus|blur|key, t, what, selector }.
// A pointer move counts only when nothing else is near (moving into an
// element fires pointerover too).
const TRIGGER_MS = 150
const TRIGGERS = { pointerover: "hover", pointerenter: "hover", mouseover: "hover", pointermove: "hover", pointerout: "unhover", pointerleave: "unhover", mouseout: "unhover", pointerdown: "press", mousedown: "press", touchstart: "press", pointerup: "release", mouseup: "release", touchend: "release", click: "click", focusin: "focus", focusout: "blur", keydown: "key" }
// A click in the same moment as its press: the click (a class toggled on click); a press held: the press (:active).
const TRIGGER_RANK = ["click", "press", "release", "key", "hover", "unhover", "focus", "blur"]
function triggerOf(target, t) {
  const evs = rec && rec.events
  if (!evs || !target || target.nodeType !== 1 || target === document.body || target === document.documentElement) return null
  let best = null
  let move = null
  for (let i = evs.length - 1; i >= 0; i--) {
    const ev = evs[i]
    if (ev.t > t + 1) continue
    if (ev.t < t - TRIGGER_MS) break
    const kind = TRIGGERS[ev.type]
    if (!kind || (ev.type === "pointermove" && move)) continue
    let el = null
    try {
      el = ev.path && resolvePath(ev.path)
    } catch {}
    if (!el || el.nodeType !== 1 || !nearInput(el, target)) continue
    if (ev.type === "pointermove") move = { kind, ev, el }
    else if (best && ev.t < best.ev.t - 1) break
    // Several at once (a press focuses the button too): the cause first.
    else if (!best || TRIGGER_RANK.indexOf(kind) < TRIGGER_RANK.indexOf(best.kind)) best = { kind, ev, el }
  }
  const x = best || move
  if (!x) return null
  const tag = x.el.tagName.toLowerCase() + ([...x.el.classList].filter((c) => /^[a-z][\w-]*$/i.test(c)).slice(0, 1).map((c) => "." + c).join("") || (x.el.id ? `#${x.el.id}` : ""))
  const key = x.kind === "key" && x.ev.key ? ` (${x.ev.key})` : ""
  const what = { hover: `:hover on ${tag}`, unhover: `the pointer leaving ${tag} (end of :hover)`, press: `a press on ${tag} (:active)`, release: `a release on ${tag} (end of :active)`, click: `a click on ${tag}`, focus: `:focus on ${tag}`, blur: `blur on ${tag} (end of :focus)`, key: `a key${key} on ${tag}` }[x.kind]
  return { kind: x.kind, t: x.ev.t, what, selector: selectorOf(x.el) }
}
// The input's element and the clip's: one inside the other, or close
// relatives (within three levels above the clip's element).
function nearInput(el, target) {
  if (el === target || el.contains(target) || target.contains(el)) return true
  let n = target
  for (let i = 0; i < 3 && n; i++) {
    n = n.parentElement
    if (n && n !== document.body && n.contains(el)) return true
  }
  return false
}
function recordClip(e) {
  if (!rec || hasFuture() || clock.seeking) return // replaying: rec.clips already has it
  const clips = rec.clips || (rec.clips = [])
  /** @type {Record<string, any>} */
  const c = { id: `c${clips.length + 1}`, start: e.vStart, end: clipEnd(e), ...describeClip(e), path: pathOf(e.target) }
  const iters = e.timing && e.timing.iterations
  if (iters === Infinity) c.iterations = "infinite"
  else if (iters > 1) c.iterations = iters
  const timing = e.timing || {}
  if ((iters ?? 1) !== 1 && Number(timing.duration) > 0) c.dur = Math.round(Number(timing.duration))
  if (Number(timing.delay) > 0) c.delay = Math.round(Number(timing.delay))
  // What it animates between (first and last keyframe), so a reader of the
  // recording knows what was visible: { opacity: "0" } → { opacity: "1" }.
  const kf = e.keyframes || []
  if (kf.length >= 2) {
    c.from = keyframeValues(kf[0])
    c.to = keyframeValues(kf[kf.length - 1])
    // Stops in between: a loop that ends where it starts still moves (F137).
    if (kf.length > 2) c.kfs = kf.length
  }
  if (c.property === undefined) delete c.property
  if (c.component === undefined) delete c.component
  const trigger = triggerOf(e.target, c.start)
  if (trigger) c.trigger = trigger
  const stack = madeAt.get(e.anim)
  if (stack) {
    const frames = stackFrames(stack)
    if (frames.length) c.stack = frames
  }
  clips.push(c)
  clipOfEntry.set(e, c)
}
function endClip(e) {
  const c = clipOfEntry.get(e)
  if (c && (c.end == null || e.vEnd < c.end)) c.end = e.vEnd
}
function clipsOf() {
  const start = rec.start || 0
  return (rec.clips || []).filter((c) => c.start >= start || (c.end != null && c.end >= start))
}

function timeline() {
  return {
    now: clock.now,
    end: Math.max(rec.end, clock.now),
    viewport: rec.viewport || { w: innerWidth, h: innerHeight },
    markers: markersOf(),
    clips: clipsOf(),
    activity: activitySamples(),
  }
}

// Clips on an element and everything inside it (for the dock's ⌘-hover
// lens). Clips carry the DOM path of their element from when they were
// recorded, so this is a prefix match, in any frame (or, for a path that
// starts at an id inside the element, where it leads).
const clipKeys = new WeakMap()
function clipsFor(target) {
  let el = target
  if (typeof target === "string") {
    try {
      el = document.querySelector(target)
    } catch {
      el = null
    }
  }
  const path = el && pathOf(el)
  if (!path || !Array.isArray(path)) return []
  const key = path.join(",")
  const out = []
  for (const c of clipsOf()) {
    if (!c.path) continue
    let k = clipKeys.get(c)
    if (k == null) clipKeys.set(c, (k = c.path.join(",")))
    if (k === key || k.startsWith(key + ",")) out.push(c)
    else if (pathV2()) {
      // Paths start at the nearest id (F51): one inside el can start below it.
      const node = resolvePath(c.path)
      if (node && node !== el && el.contains(node)) out.push(c)
    }
  }
  return out
}

function clipAt(t, selector) {
  let best = null
  for (const c of clipsOf()) {
    const end = c.end == null ? Math.max(rec.end, clock.now) : c.end
    if (c.start > t || t > end) continue
    if (selector) {
      if (c.selector !== selector) {
        let el = null
        try {
          el = document.querySelector(selector)
        } catch {}
        const target = c.selector && document.querySelector(c.selector)
        if (!el || !target || !(el === target || el.contains(target))) continue
      }
    }
    if (!best || c.start > best.start) best = c
  }
  return best ? { clip: best, offset: t - best.start } : null
}

// ---- interaction model -------------------------------------------------------
// At the live edge the app is live and recorded. In the past (rewound,
// previewing, rebuilding, or playing back recorded future) it's view-only.

let toolActive = false
function setToolActive(on) {
  toolActive = !!on
}
// Live = playing at the live edge. Paused or in the past it's view-only.
function isInteractive() {
  return !!rec && clock.playing && !hasFuture() && !previewing && !clock.seeking && !(shell && shell.rebuilding) && !toolActive
}

// ---- routes (for markers) ---------------------------------------------------------

const cleanRoute = (path) => path.replace(/([?&])__wb=app&?/, "$1").replace(/[?&]$/, "")
function noteRoute() {
  if (!rec || clock.seeking || hasFuture()) return
  const routes = rec.routes || (rec.routes = [])
  const clean = cleanRoute(location.pathname + location.search + location.hash)
  if (routes.length && routes[routes.length - 1].path === clean) return
  routes.push({ t: clock.now, path: clean })
}
// The app's route at t on this document's page: its last pushState/replaceState
// (or popstate) by then, else the URL the page loaded at. A preview shows the
// DOM of t without touching history, so the dock's address bar asks this.
function routeAt(t) {
  const seg = segmentAt(t)
  let path = null
  for (const r of rec.routes || []) if (r.t >= seg.t && r.t <= t) path = r.path
  if (path) return path
  try {
    const u = new URL(seg.url)
    return cleanRoute(u.pathname + u.search + u.hash)
  } catch {
    return null
  }
}
for (const m of ["pushState", "replaceState"]) {
  const orig = history[m]
  history[m] = function (...args) {
    const r = orig.apply(this, args)
    noteRoute()
    return r
  }
}
W.addEventListener("popstate", noteRoute)
W.addEventListener("hashchange", noteRoute)
