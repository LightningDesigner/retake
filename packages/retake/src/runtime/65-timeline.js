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

function markersOf() {
  const out = []
  let lastInput = null
  for (const ev of rec.events) {
    if (ev.t < (rec.start || 0)) continue
    if (ev.type === "click") out.push({ t: ev.t, kind: "click", label: ev.label || "click", selector: ev.css || undefined })
    else if (ev.type === "keydown" && !ev.inField) out.push({ t: ev.t, kind: "key", label: ev.key, selector: ev.css || undefined })
    else if (ev.type === "submit") out.push({ t: ev.t, kind: "submit", label: ev.label || "submit", selector: ev.css || undefined })
    else if (ev.type === "input") {
      // A burst of typing in one field is one marker.
      if (lastInput && lastInput.selector === ev.css && ev.t - lastInput.last < 1500) {
        lastInput.last = ev.t
        lastInput.label = ev.label || lastInput.label
        continue
      }
      lastInput = { t: ev.t, kind: "input", label: ev.label || "typing", selector: ev.css || undefined, last: ev.t }
      out.push(lastInput)
    }
  }
  for (const r of rec.routes || []) if (r.t >= (rec.start || 0)) out.push({ t: r.t, kind: "route", label: r.path })
  for (const f of rec.fetches) if (f && f.t0 >= (rec.start || 0)) out.push({ t: f.t0, kind: "fetch", label: f.key })
  for (const t of rec.reloads || []) out.push({ t, kind: "reload", label: "reload" })
  for (const m of out) delete m.last
  return out.sort((a, b) => a.t - b.t)
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
  return { kind, label, selector: selectorOf(e.target), component: componentOf(e.target) || undefined, property }
}
function recordClip(e) {
  if (!rec || hasFuture() || clock.seeking) return // replaying: rec.clips already has it
  const clips = rec.clips || (rec.clips = [])
  const c = { id: `c${clips.length + 1}`, start: e.vStart, end: clipEnd(e), ...describeClip(e) }
  if (c.property === undefined) delete c.property
  if (c.component === undefined) delete c.component
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
  }
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

function noteRoute() {
  if (!rec || clock.seeking || hasFuture()) return
  const path = location.pathname + location.search + location.hash
  const routes = rec.routes || (rec.routes = [])
  const clean = path.replace(/([?&])__wb=app&?/, "$1").replace(/[?&]$/, "")
  if (routes.length && routes[routes.length - 1].path === clean) return
  routes.push({ t: clock.now, path: clean })
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
