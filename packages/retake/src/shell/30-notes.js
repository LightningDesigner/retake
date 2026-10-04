// Picking elements in the prototype. Two tools share it:
//  - Comment (or hold ⌘): click an element, down to the innermost child, and
//    write a note. Notes keep their moment and branch, show as numbered pins on
//    the prototype and tags on the timeline, and copy as a prompt.
//  - Select: pick one component; scrubbing then rewinds only that component.

let hovered = null
let lastPointer = null
let draft = null
let openNote = null
// A note is being written (a frame built behind waits to swap in until it's done).
const composing = () => !!draft
const hl = $("#wb-hl")
const scopeBox = $("#wb-scope")
const card = $("#wb-note")
// Select and Comment work on the past (the app is view-only there).
const isStill = () => !!(D.last && D.last.started && !isInteractive())
const mode = () => (!isStill() ? null : D.metaHeld ? "comment" : D.picking)

const shell = window.__retakeShell
shell.inspecting = false
// A disabled form control gets no click (pointer events still come): its
// pointerup picks it instead.
const noClick = (el) => {
  try {
    return !!(el && el.closest && el.closest(":is(button, input, select, textarea, option, optgroup):disabled"))
  } catch {
    return false
  }
}
// The element an event is really about: inside an open shadow root, the
// element clicked (the event's target is retargeted to the host).
const innerTarget = (e) => {
  try {
    const p = e.composedPath && e.composedPath()
    if (p && p[0] && p[0].nodeType) return p[0].nodeType === 1 ? p[0] : p[0].parentElement
  } catch {}
  return e.target && (e.target.nodeType === 1 ? e.target : e.target.parentElement)
}
shell.inspect = (e) => {
  const el = innerTarget(e)
  if (e.type === "pointermove" || e.type === "pointerover") {
    // On its way to the layer list, the pointer leaves the list as it is (F127).
    const prev = prevMove
    prevMove = { x: e.clientX, y: e.clientY }
    // Only then does the list take the pointer (its rows can be clicked).
    const toward = towardLayers(prev, prevMove)
    layersEl.classList.toggle("reach", toward)
    if (toward) return
    lastPointer = { x: e.clientX, y: e.clientY }
    // While it moves, what takes pointer events; once it rests, everything (F124).
    buildLayers(e.clientX, e.clientY, usable(el), false)
    layersAt.moved = true
    clearTimeout(fullTimer)
    const x = e.clientX
    const y = e.clientY
    fullTimer = setTimeout(() => {
      if (!mode() || !layersAt || layersAt.x !== x || layersAt.y !== y || layersAt.full) return
      // On its way to the list: rebuilding it now would move the rows away (F135).
      if (layersEl.classList.contains("reach")) return
      buildLayers(x, y, usable(el))
      layersAt.moved = true
    }, 60)
  } else if (e.type === "wheel") {
    if (Math.abs(e.deltaY) >= 4) cycleLayer(e.deltaY > 0 ? 1 : -1)
  } else if (e.type === "keydown" && e.key === "Tab") {
    cycleLayer(e.shiftKey ? -1 : 1)
  } else if ((e.type === "click" || (e.type === "pointerup" && noClick(el))) && usable(el)) {
    // The list the highlight showed, unless it was built somewhere else (F90):
    // then the one at the click.
    if (!layersAt || layersAt.x !== e.clientX || layersAt.y !== e.clientY || !layersAt.full) buildLayers(e.clientX, e.clientY, usable(el))
    const p = pick()
    if (p) p.picked = pickedInfo(p)
    if (mode() === "select") setScope(p ? p.el : usable(el))
    else openComposer(p ? p.el : usable(el), { x: e.clientX, y: e.clientY }, p)
  } else if (e.type === "keydown" && e.key === "Escape") {
    setPicking(null)
    setScope(null)
  }
}
// ⌘ is read from every pointer move too, so a missed keyup (a ⌘-shortcut that
// took focus away, like a screenshot) can't leave the tool stuck on.
shell.appPointerDown = () => {
  if (!card.hidden && !draft) closeCard()
}
// ⌘ held over the live app: the note tools work on a paused moment (said
// once per press).
let liveHinted = false
shell.pointer = (x, y, meta) => {
  lastPointer = { x, y }
  if (meta !== undefined && meta !== D.metaHeld) setMeta(meta)
  if (meta && !liveHinted && D.last && D.last.started && D.last.playing && !isStill()) {
    liveHinted = true
    flash("Pause (Space) to comment", { warn: false })
  }
}
// From a frame's runtime: ⌘ down or up, or the window on show lost focus
// (a frame built behind or being swapped out doesn't say so, F99).
shell.meta = (down) => setMeta(down)
function setMeta(down) {
  if (D.metaHeld === down) return
  D.metaHeld = down
  if (!down) liveHinted = false
  syncPicking()
}

// ---- the layer picker: what's under the pointer, including pseudo-elements ----------
// ⌘ over the app lists the layers at that point: each element, and after it
// any animation running on its ::before/::after (a shimmer on a skeleton,
// say). What the user can see comes first: an element with its own text,
// media or a control, or that paints something; then the rest in z-order;
// then decorative layers (an empty overlay: a glow, a stretched link, a
// scrim) and invisible ones (opacity 0, a closed menu sheet). Wheel or Tab
// moves through them; a click picks the highlighted one, a click on a row of
// the list picks that one. Layers with an animation running are marked, and
// the pick prefers one (F124-F126): the element under the pointer if it moves,
// else something moving inside it, else what an image without one covers.

let layers = [] // [{ el, pseudo, anim, name, label, rank, why, z }]
let layerIdx = 0
let layersKey = ""
let layersAt = null // the point the list was built at
const layersEl = $("#wb-layers")
const pick = () => layers[layerIdx] || null
const MAX_LAYERS = 8

const shortLabel = (el) => {
  const tag = el.tagName.toLowerCase()
  if (el.id) return `${tag}#${el.id}`
  const c = [...el.classList][0]
  return c ? `${tag}.${c}` : tag
}
function animTiming(a) {
  try {
    const t = a.effect.getComputedTiming ? a.effect.getComputedTiming() : a.effect.getTiming()
    const d = Number(t.duration) || 0
    const it = t.iterations
    return `${msWord(d)}${it === Infinity ? " loop" : it > 1 ? ` ×${it}` : ""}`
  } catch {
    return ""
  }
}
const animName = (a) => a.animationName || (a.transitionProperty ? `${a.transitionProperty} transition` : "animation")

const MEDIA = "img, svg, video, canvas, picture, iframe, object, embed"
const CONTROL = "button, a[href], input, select, textarea, summary, label, [role=button], [role=link], [role=checkbox], [role=switch], [role=tab], [role=menuitem], [contenteditable=true]"
const isSvg = (el) => !!el && el instanceof el.ownerDocument.defaultView.SVGElement
const svgRootOf = (el) => (el.tagName.toLowerCase() === "svg" && !el.ownerSVGElement ? el : el.closest("svg:not(svg svg)") || el.ownerSVGElement || el)
// The control an svg is the icon of: within two levels above it.
function svgControl(svg) {
  for (let n = svg.parentElement, i = 0; n && i < 2; n = n.parentElement, i++) if (n.matches(CONTROL.replace("a[href]", "a"))) return n
  return null
}
const ownText = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && /\S/.test(n.data))
const textOf = (el) => (el.innerText || el.textContent || "").trim()
function painted(cs) {
  const bg = cs.backgroundColor
  if (bg && !/rgba\(.*,\s*0\)$/.test(bg) && bg !== "transparent") return true
  if (cs.backgroundImage && cs.backgroundImage !== "none") return true
  if (cs.boxShadow && cs.boxShadow !== "none") return true
  return bordered(cs)
}
const bordered = (cs) => ["Top", "Right", "Bottom", "Left"].some((s) => parseFloat(cs[`border${s}Width`]) > 0 && cs[`border${s}Style`] !== "none" && cs[`border${s}Style`] !== "hidden")
// Is it on screen at all (opacity 0 on it or an ancestor, visibility hidden)?
function seen(el) {
  try {
    if (typeof el.checkVisibility === "function") return el.checkVisibility({ opacityProperty: true, visibilityProperty: true })
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) if (el.ownerDocument.defaultView.getComputedStyle(n).opacity === "0") return false
  } catch {}
  return true
}

// Everything at the point, topmost first: inside open shadow roots (before
// their host), and embedded iframes (out of hit testing while the app is
// view-only: no click reaches them) on top.
function hitList(doc, x, y, full = true) {
  let els = []
  if (full) els = everythingAt(doc, x, y)
  else {
    try {
      els = doc.elementsFromPoint(x, y)
    } catch {}
  }
  const out = []
  const walk = (list, depth) => {
    for (const el of list) {
      const root = el.shadowRoot
      if (root && depth < 3) {
        let inner = []
        try {
          inner = root.elementsFromPoint(x, y).filter((n) => n.getRootNode() === root)
        } catch {}
        walk(inner, depth + 1)
      }
      out.push(el)
    }
  }
  walk(els, 0)
  try {
    for (const f of doc.querySelectorAll("iframe")) {
      const r = f.getBoundingClientRect()
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom && r.width && r.height && !out.includes(f)) out.unshift(f)
    }
  } catch {}
  return out
}

// elementsFromPoint leaves out what takes no pointer events, though it's
// painted there (a drawn underline, an icon, an overlay's children: F124,
// F125). The point is read with every element taking them: a sheet adopted
// for the read and dropped right after (no DOM change, nothing recorded).
const hitSheets = new WeakMap()
function everythingAt(doc, x, y) {
  let sheet = null
  try {
    sheet = hitSheets.get(doc)
    if (!sheet) {
      sheet = new doc.defaultView.CSSStyleSheet()
      sheet.replaceSync("* { pointer-events: auto !important; }")
      hitSheets.set(doc, sheet)
    }
    doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet]
  } catch {
    sheet = null
  }
  try {
    return doc.elementsFromPoint(x, y)
  } catch {
    return []
  } finally {
    if (sheet) {
      try {
        doc.adoptedStyleSheets = doc.adoptedStyleSheets.filter((x) => x !== sheet)
      } catch {}
    }
  }
}

// The element's own animation running at the moment on show, for marking and
// preferring layers (a 0ms transition doesn't count). Clips are matched to
// elements once per moment, by their selector (else by recorded path).
let runningMemo = { key: "", byEl: new Map(), loose: [] }
function runningClips(doc) {
  const s = D.last
  const t = s ? shownTime(s) : 0
  const clips = timeline().clips
  const key = `${D.activeId}:${Math.round(t)}:${clips.length}`
  if (runningMemo.key === key && runningMemo.doc === doc) return runningMemo
  const byEl = new Map()
  const loose = []
  for (const c of clips) {
    if (c.pseudoElement || c.start > t + 0.5 || (c.end != null && (c.end < t - 0.5 || c.end - c.start < 1))) continue
    const found = c.selector ? findAll(c.selector, doc) : []
    if (found.length === 1) byEl.set(found[0], [...(byEl.get(found[0]) || []), c])
    else loose.push(c)
  }
  runningMemo = { key, doc, byEl, loose, t, own: new WeakMap() }
  return runningMemo
}
function animOf(el) {
  if (!el || el.tagName === "HTML" || el.tagName === "BODY") return null
  let r = null
  try {
    r = runningClips(el.ownerDocument)
  } catch {
    return null
  }
  if (r.own.has(el)) return r.own.get(el)
  let c = (r.byEl.get(el) || [])[0] || null
  if (!c && r.loose.length) {
    const mine = new Set(clipsOn(el))
    c = r.loose.find((x) => mine.has(x)) || null
  }
  r.own.set(el, c)
  return c
}
const animLabel = (c) => (c.kind === "transition" ? `${c.property || ""} transition`.trim() : c.label || c.property || "animation")

// The elements an element at the point stands for: itself; for a shape inside
// an svg, the shape (stroke animations live there), the whole <svg>, and the
// control the svg is the icon of.
function candidates(raw) {
  if (!raw || raw.tagName === "HTML" || raw.tagName === "BODY") return []
  if (!isSvg(raw)) return [raw]
  const svg = svgRootOf(raw)
  const list = raw === svg ? [svg] : [raw, svg]
  const control = svgControl(svg)
  if (control) list.push(control)
  return list
}

// 0 content (text, media, a control, or it paints something), 1 an empty box,
// 2 decorative, 3 invisible.
function rankOf(el, below) {
  if (el.tagName === "IFRAME") return { rank: 0 }
  if (!seen(el)) return { rank: 3, why: "hidden" }
  let cs = null
  try {
    cs = el.ownerDocument.defaultView.getComputedStyle(el)
  } catch {}
  const media = isSvg(el) || el.matches(MEDIA) || !!el.querySelector(MEDIA)
  const text = !!textOf(el)
  if (!media && !text && el.getAttribute("aria-hidden") === "true") return { rank: 2, why: "decorative" }
  if (!media && !text && cs && (cs.position === "absolute" || cs.position === "fixed") && !bordered(cs)) {
    const r = el.getBoundingClientRect()
    const W = el.ownerDocument.defaultView
    const big = r.width * r.height > 0.5 * W.innerWidth * W.innerHeight
    const covers = below.some((b) => {
      const q = b.getBoundingClientRect()
      return q.left >= r.left - 1 && q.top >= r.top - 1 && q.right <= r.right + 1 && q.bottom <= r.bottom + 1
    })
    if (big || covers) return { rank: 2, why: "decorative" }
  }
  if (text || media || el.matches(CONTROL) || (cs && painted(cs))) return { rank: 0 }
  return { rank: 1 }
}

let fullTimer = 0
function buildLayers(x, y, fallback, full = true) {
  let doc = null
  try {
    doc = D.frame.contentDocument
  } catch {}
  const els = []
  const seenEls = new Set()
  for (const raw of doc ? hitList(doc, x, y, full) : []) {
    for (const el of candidates(raw)) {
      if (seenEls.has(el)) continue
      // An svg's <g> is only a layer when it moves.
      if (/^(g|defs|symbol|mask|clipPath)$/.test(el.tagName) && isSvg(el) && !animOf(el)) continue
      seenEls.add(el)
      els.push(el)
    }
    if (els.length >= MAX_LAYERS) break
  }
  els.length = Math.min(els.length, MAX_LAYERS)
  // Each element's rank, knowing what's under it (an empty overlay that
  // covers the content under it is decorative).
  const groups = els.map((el, z) => {
    const below = els.slice(z + 1).filter((b) => b.tagName !== "IFRAME" && (ownText(b) || b.matches(MEDIA)) && !b.contains(el))
    const { rank, why } = rankOf(el, below)
    const moving = animOf(el)
    const host = { el, pseudo: null, anim: null, name: null, label: layerLabel(el), rank, why: why || null, z, moving: moving ? animLabel(moving) : null }
    const pseudos = []
    let anims = []
    try {
      anims = el.getAnimations({ subtree: true })
    } catch {}
    const names = new Set()
    for (const a of anims) {
      const pe = a.effect && a.effect.pseudoElement
      if (!pe || a.effect.target !== el) continue
      const name = animName(a)
      if (names.has(pe + name)) continue
      names.add(pe + name)
      pseudos.push({ el, pseudo: pe, anim: a, name, label: `${pe} · ${name} · ${animTiming(a)}`, rank, why: null, z, moving: null })
    }
    return [host, ...pseudos]
  })
  const order = groups.map((g, i) => ({ g, i })).sort((a, b) => a.g[0].rank - b.g[0].rank || a.i - b.i)
  const out = order.flatMap((o) => o.g)
  if (!out.length && fallback) out.push({ el: fallback, pseudo: null, anim: null, name: null, label: layerLabel(fallback), rank: 0, why: null, z: 0, moving: null })
  const key = out.map((l) => l.label).join("|")
  if (key !== layersKey) {
    layersKey = key
    layerIdx = defaultLayer(out)
  }
  layers = out
  layersAt = { x, y, full }
  layersEl.classList.remove("reach")
  hovered = pick() ? pick().el : null
}

// The first content layer; for a shape in an svg, the svg itself, or the
// control it's the icon of. When that one has no animation running: one
// moving inside it under the pointer (a word popping in, at opacity 0 until
// then: F126), or, for an image or box with no text of its own, a moving
// shape, image or text it covers (a drawn underline under a map: F124).
function defaultLayer(list) {
  let i = list.findIndex((l) => l.rank === 0)
  if (i < 0) i = list.findIndex((l) => l.rank < 2)
  if (i < 0) return 0
  let l = list[i]
  if (!l.moving && !l.pseudo) {
    let j = list.findIndex((x) => x.moving && !x.pseudo && x.el !== l.el && l.el.contains(x.el))
    if (j < 0 && !ownText(l.el) && !l.el.matches(CONTROL)) j = list.findIndex((x) => x.moving && !x.pseudo && x.z > l.z && x.rank < 2 && !x.el.contains(l.el) && (isSvg(x.el) || x.el.matches(MEDIA) || ownText(x.el)))
    if (j >= 0) (i = j), (l = list[j])
  }
  if (isSvg(l.el) && !l.moving) {
    const svg = svgRootOf(l.el)
    const control = svgControl(svg)
    const want = control || svg
    const j = list.findIndex((x) => x.el === want && !x.pseudo)
    if (j >= 0) return j
  }
  return i
}

// "button.inner in <fancy-card>'s shadow root"
function layerLabel(el) {
  const root = el.getRootNode && el.getRootNode()
  const host = root && root.host
  return host ? `${shortLabel(el)} in <${host.tagName.toLowerCase()}>'s shadow root` : shortLabel(el)
}

function cycleLayer(dir) {
  if (layers.length < 2) return
  layerIdx = (layerIdx + dir + layers.length) % layers.length
  hovered = pick().el
}

// The list beside the pointer: the layers there, the pick highlighted, a
// moving one marked with its animation, one that's skipped dimmed with why.
// It never sits under the pointer, and its rows can be clicked: the pointer
// on its way there leaves it as it is (towardLayers).
const MAX_ROWS = 8
let layersHtml = ""
function renderLayers() {
  const at = layersAt || lastPointer
  const show = mode() === "comment" && layers.length > 0 && !!at
  layersEl.hidden = !show
  if (!show) return layersEl.classList.remove("reach")
  const rows = layers.map((l, i) => ({ l, i }))
  const shown = rows.filter((x) => x.l.rank < 2 || x.l.moving || x.i === layerIdx)
  const skipped = rows.filter((x) => !shown.includes(x))
  const top = shown.slice(0, skipped.length ? MAX_ROWS - 1 : MAX_ROWS).concat(skipped.slice(0, 1))
  if (!top.some((x) => x.i === layerIdx) && pick()) top[top.length - 1] = { l: pick(), i: layerIdx }
  const rest = layers.length - top.length
  const html =
    top
      .map(({ l, i }) => {
        const cls = `layer${i === layerIdx ? " on" : ""}${l.pseudo ? " pseudo" : ""}${l.rank >= 2 ? " skipped" : ""}${l.moving ? " anim" : ""}`
        const tail = l.moving ? `<span class="what">${esc(l.moving)}</span>` : l.rank >= 2 && l.why ? `<span class="what">${esc(l.why)}</span>` : ""
        return `<div class="${cls}" data-layer="${i}">${esc(l.label)}${tail ? " · " + tail : ""}</div>`
      })
      .join("") + (rest > 0 ? `<div class="more">+${rest}</div>` : "")
  if (html !== layersHtml) {
    layersHtml = html
    layersEl.innerHTML = html
  }
  const f = D.frame.getBoundingClientRect()
  const w = layersEl.offsetWidth
  const h = layersEl.offsetHeight
  const px = f.left + at.x
  const py = f.top + at.y
  const bottom = dock.getBoundingClientRect().top - 8
  // Right of and below the point; flipped to the other side where it won't fit.
  const left = px + 16 + w <= innerWidth - 8 ? px + 16 : px - 16 - w
  const top0 = py + 16 + h <= bottom ? py + 16 : py - 16 - h
  layersEl.style.left = clamp(left, 8, innerWidth - w - 8) + "px"
  layersEl.style.top = clamp(top0, 8, bottom - h) + "px"
}

// Is the pointer (frame coordinates) on its way from where the list was built
// (by a pointer move there) to the list? A short step from there, or from a
// point already on the way, inside the convex hull of that point and the
// list's corners.
let prevMove = null
function towardLayers(from, to) {
  if (layersEl.hidden || !layersAt || !layersAt.moved || !layers.length || !from) return false
  if (Math.hypot(to.x - from.x, to.y - from.y) > 40 || Math.hypot(to.x - layersAt.x, to.y - layersAt.y) < 2) return false
  const f = D.frame.getBoundingClientRect()
  const r = layersEl.getBoundingClientRect()
  if (!r.width) return false
  const P = { x: layersAt.x, y: layersAt.y }
  const h = hull([P, { x: r.left - f.left, y: r.top - f.top }, { x: r.right - f.left, y: r.top - f.top }, { x: r.right - f.left, y: r.bottom - f.top }, { x: r.left - f.left, y: r.bottom - f.top }])
  const atP = Math.hypot(from.x - P.x, from.y - P.y) < 2
  return (atP || inHull(h, from)) && inHull(h, to)
}
// Monotone chain, counter-clockwise.
function hull(pts) {
  const p = [...pts].sort((a, b) => a.x - b.x || a.y - b.y)
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
  const lower = []
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop()
    lower.push(q)
  }
  const upper = []
  for (const q of p.reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop()
    upper.push(q)
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1))
}
function inHull(h, q) {
  for (let i = 0; i < h.length; i++) {
    const a = h[i]
    const b = h[(i + 1) % h.length]
    if ((b.x - a.x) * (q.y - a.y) - (b.y - a.y) * (q.x - a.x) < 0) return false
  }
  return h.length > 2
}

// A press on a row picks that layer, as a click on the app would have.
layersEl.addEventListener("pointerdown", (e) => {
  const row = /** @type {HTMLElement | null} */ (/** @type {Element} */ (e.target).closest("[data-layer]"))
  if (!row || !layersAt) return
  e.preventDefault()
  e.stopPropagation()
  layerIdx = Number(row.dataset.layer)
  const p = pick()
  if (!p) return
  // The card can open under the pointer: the press then ends on it and the
  // click goes to what holds both (the page), which isn't a click away (F135).
  const swallow = (ev) => ev.stopPropagation()
  window.addEventListener("click", swallow, { capture: true, once: true })
  setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 1000)
  hovered = p.el
  p.picked = pickedInfo(p)
  if (mode() === "select") setScope(p.el)
  else openComposer(p.el, { x: layersAt.x, y: layersAt.y }, p)
})

// How the pick was made, for the note: on top, or a layer down, and what was
// skipped above it.
function pickedInfo(p) {
  if (!p) return { via: "topmost", skipped: [] }
  const above = layers.filter((l) => !l.pseudo && l.z < p.z)
  return { via: p.z === 0 ? "topmost" : `layer ${p.z + 1}`, skipped: above.map((l) => `${l.label}${l.why ? ` (${l.why})` : ""}`) }
}

// The page itself isn't a thing to comment on. Inside an SVG icon, the thing
// you mean is the icon's control (a button or link, within two levels), or
// at least the whole <svg>.
function usable(el) {
  if (!el || el.tagName === "HTML" || el.tagName === "BODY") return null
  if (isSvg(el)) {
    const svg = svgRootOf(el)
    return svgControl(svg) || svg
  }
  return el
}

// Leaving the Select tool lets go of the selected component.
function setPicking(m) {
  if (m !== "select") setScope(null)
  D.picking = m
  syncPicking()
}

// The layer list is always the one at the pointer (F90): rebuilt when a tool
// turns on, dropped when it turns off.
function syncPicking() {
  shell.inspecting = !!mode()
  setToolActive(!!mode())
  // Picking, a click on a pinned spot is a new note there (F108): pins let it through.
  document.body.classList.toggle("picking-notes", mode() === "comment")
  hovered = null
  try {
    const doc = D.frame.contentDocument
    doc.documentElement.style.cursor = mode() ? "crosshair" : ""
  } catch {}
  if (mode() && lastPointer) buildLayers(lastPointer.x, lastPointer.y, null)
  else if (!mode()) {
    layers = []
    layersKey = ""
    layersAt = null
  }
}

// Embedded iframes get no input while the app is view-only (F97): a sheet
// adopted by the frame on show (no DOM change, nothing recorded).
let embedSheet = null // { doc, sheet }
function syncEmbeds() {
  let doc = null
  try {
    doc = D.frame && D.frame.contentDocument
  } catch {}
  const want = !!doc && isStill()
  if (embedSheet && (embedSheet.doc !== doc || !want)) {
    try {
      embedSheet.doc.adoptedStyleSheets = embedSheet.doc.adoptedStyleSheets.filter((x) => x !== embedSheet.sheet)
    } catch {}
    embedSheet = null
  }
  if (!want || embedSheet) return
  try {
    const sheet = new doc.defaultView.CSSStyleSheet()
    sheet.replaceSync("iframe { pointer-events: none !important; }")
    doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet]
    embedSheet = { doc, sheet }
  } catch {}
}

// Selecting the same component again clears it.
function setScope(el) {
  D.scopeEl = el && el === D.scopeEl ? null : el
  if (D.PT && D.last && D.last.previewing) D.PT.preview(D.last.previewAt, D.scopeEl)
}

// ---- describing an element ------------------------------------------------------

const cssEsc = (v) => (window.CSS && CSS.escape ? CSS.escape(v) : String(v).replace(/[^\w-]/g, (c) => "\\" + c))

// The runtime's own selector for an element (the old way: an id, else
// tag.class chains with :nth-of-type), which older clips carry.
function cssPath(el) {
  const parts = []
  for (let n = el; n && n.nodeType === 1 && n.tagName !== "HTML"; n = n.parentElement) {
    if (n.id) {
      parts.unshift(`#${cssEsc(n.id)}`)
      break
    }
    let part = n.tagName.toLowerCase()
    const cls = [...n.classList].filter((c) => /^[a-z][\w-]*$/i.test(c)).slice(0, 2)
    if (cls.length) part += "." + cls.map(cssEsc).join(".")
    const same = n.parentElement ? [...n.parentElement.children].filter((c) => c.tagName === n.tagName) : []
    if (same.length > 1) part += `:nth-of-type(${same.indexOf(n) + 1})`
    parts.unshift(part)
    if (n.tagName === "BODY") break
  }
  return parts.join(" > ")
}

// ---- stable selectors (F96) ----------------------------------------------------------
// A selector that still finds the element on a fresh load of the page: no
// generated ids, no classes the recording saw come and go (`in`, `go`,
// `is-open`, `opacity-100`), no Tailwind state variants; test ids, labels,
// hrefs and names where they're unique; :nth-of-type only where needed.

// Class names added or removed on any element while the dock watched (every
// frame it has shown or built: the recording, its replays and previews).
const toggledClasses = new Set()
const watchedDocs = new WeakSet()
const classSet = (v) => new Set(String(v || "").split(/\s+/).filter(Boolean))
function watchClasses(frame) {
  let doc = null
  try {
    doc = frame && frame.contentDocument
  } catch {}
  if (!doc || !doc.documentElement || watchedDocs.has(doc)) return
  watchedDocs.add(doc)
  try {
    new MutationObserver((records) => {
      for (const r of records) {
        const was = classSet(r.oldValue)
        const now = classSet(/** @type {Element} */ (r.target).getAttribute("class"))
        for (const c of was) if (!now.has(c)) toggledClasses.add(c)
        for (const c of now) if (!was.has(c)) toggledClasses.add(c)
      }
    }).observe(doc, { subtree: true, attributes: true, attributeFilter: ["class"], attributeOldValue: true })
  } catch {}
}

const GENERATED_ID = /^(:r|«r|:R|radix-|headlessui-|react-aria|mui-|rc-|ember\d)|\d{5,}$|:/
const goodId = (id) => !!id && !GENERATED_ID.test(id)
const stableClass = (c) => !toggledClasses.has(c) && !c.includes(":") && /^-?[_a-zA-Z][\w-]*$|^[\w-]*\[[^\]]+\][\w-]*$/.test(c)
// "_title_18lyj_1" (a CSS module's hashed class) → "title".
const moduleClass = (c) => {
  const m = /^_?([A-Za-z][\w-]*?)_[a-z0-9]{5}(_\d+)?$/.exec(c)
  return m ? m[1] : null
}

const attrEsc = (v) => String(v).replace(/["\\]/g, "\\$&")
// One step of a selector for n, the most specific stable thing it has.
function selectorStep(n, unique) {
  const tag = n.tagName.toLowerCase()
  if (goodId(n.id)) return { sel: `#${cssEsc(n.id)}`, anchor: true }
  for (const a of ["data-testid", "data-test", "data-cy"]) {
    const v = n.getAttribute(a)
    if (v) return { sel: `${tag}[${a}="${attrEsc(v)}"]`, anchor: true }
  }
  const tries = []
  const label = n.getAttribute("aria-label")
  if (label) tries.push(`${tag}[aria-label="${attrEsc(label)}"]`)
  if (tag === "a" && n.getAttribute("href")) tries.push(`a[href="${attrEsc(n.getAttribute("href"))}"]`)
  if (/^(input|select|textarea|button)$/.test(tag) && n.getAttribute("name")) tries.push(`${tag}[name="${attrEsc(n.getAttribute("name"))}"]`)
  for (const t of tries) if (unique(t)) return { sel: t, anchor: true }
  const cls = [...n.classList].filter(stableClass).slice(0, 3)
  return { sel: tag + cls.map((c) => "." + cssEsc(c)).join(""), anchor: false, bare: !cls.length }
}

// { selector, matches, hint } for an element. In a shadow root: the host's
// selector, " >>> ", and the selector inside it.
function stableSelector(el) {
  const root = el.getRootNode ? el.getRootNode() : el.ownerDocument
  const all = (s) => {
    try {
      return root.querySelectorAll(s)
    } catch {
      return []
    }
  }
  const unique = (s) => {
    const m = all(s)
    return m.length === 1 && m[0] === el
  }
  let sel = ""
  for (let n = el, depth = 0; n && n.nodeType === 1 && n.tagName !== "HTML" && depth < 10; n = n.parentElement, depth++) {
    const step = selectorStep(n, (s) => all(sel ? `${s} > ${sel}` : s).length === 1)
    let part = step.sel
    let cand = sel ? `${part} > ${sel}` : part
    if (unique(cand) && (!step.bare || depth > 0)) return finish(cand)
    if (!step.anchor && n.parentElement) {
      const same = [...n.parentElement.children].filter((c) => c.tagName === n.tagName)
      if (same.length > 1) {
        const nth = `${part}:nth-of-type(${same.indexOf(n) + 1})`
        const withNth = sel ? `${nth} > ${sel}` : nth
        if (unique(withNth) && (!step.bare || depth > 0)) return finish(withNth)
        // Kept only where it narrows things down.
        if (all(withNth).length < all(cand).length) cand = withNth
      }
    }
    sel = cand
    if (step.anchor || n.tagName === "BODY") break
  }
  return finish(sel || el.tagName.toLowerCase())
  function finish(s) {
    const host = root && /** @type {any} */ (root).host
    if (host) {
      const outer = stableSelector(host)
      return { selector: `${outer.selector} >>> ${s}`, matches: all(s).length, shadowHost: outer.selector }
    }
    return { selector: s, matches: all(s).length }
  }
}

// The runtime's selectorOf (shared with clips) when it has one.
function selectorInfo(el) {
  const pt = D.PT
  const inShadow = el.getRootNode && el.getRootNode() !== el.ownerDocument
  if (pt && typeof pt.selectorOf === "function" && !inShadow) {
    try {
      const r = pt.selectorOf(el)
      if (r && typeof r === "object" && r.selector) return { selector: r.selector, matches: r.matches || 1, hint: r.hint || null }
      if (typeof r === "string" && r) return { selector: r, matches: findAll(r, el.ownerDocument).length || 1 }
    } catch {}
  }
  return stableSelector(el)
}

// Elements a selector finds, through " >>> " into open shadow roots.
function findAll(selector, doc) {
  try {
    const parts = String(selector).split(" >>> ")
    let scope = [doc]
    for (let i = 0; i < parts.length; i++) {
      const found = scope.flatMap((r) => [...r.querySelectorAll(parts[i])])
      scope = i < parts.length - 1 ? found.map((n) => n.shadowRoot).filter(Boolean) : found
    }
    return /** @type {Element[]} */ (scope)
  } catch {
    return []
  }
}
const findEl = (selector, doc) => (selector ? findAll(selector, doc)[0] || null : null)

// The element's fiber in the tree on screen: the node keeps the fiber it was
// created with, which after an update may be the stale one of the pair (its
// props, and its parents' props, from an earlier render). The current props
// sit on the node (__reactProps$), so the fiber holding them is the current one.
const fiberOf = (el) => {
  const keys = Object.keys(el)
  const key = keys.find((k) => k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$"))
  const f = key ? el[key] : null
  const pk = keys.find((k) => k.startsWith("__reactProps$"))
  if (f && pk && f.alternate && f.memoizedProps !== el[pk] && f.alternate.memoizedProps === el[pk]) return f.alternate
  return f
}

// A component's name, through memo() and forwardRef() wrappers.
function componentName(type) {
  for (let t = type, i = 0; t && i < 4; i++) {
    if (typeof t === "function") return t.displayName || t.name || null
    if (typeof t !== "object") return null
    if (t.displayName) return t.displayName
    t = t.render || t.type // forwardRef keeps render, memo keeps type
  }
  return null
}

// Library wrappers that sit between an element and the component that wrote
// it (framer-motion presence, Radix slots, providers). Not what a note means.
const INTERNAL = /^(SegmentViewNode|InnerLayoutRouter|OuterLayoutRouter|RenderFromTemplateContext|ScrollAndFocusHandler|InnerScrollAndFocusHandler|RedirectBoundary|RedirectErrorBoundary|NotFoundBoundary|HTTPAccessFallbackBoundary|HTTPAccessFallbackErrorBoundary|ErrorBoundary|ErrorBoundaryHandler|LoadingBoundary|ClientPageRoot|ClientSegmentRoot|AppRouter|ServerRoot|HotReload|DevRootHTTPAccessFallbackBoundary|Router|PopChild|PopChildMeasure|PresenceChild|AnimatePresence|MotionComponent|MotionDOMComponent|LayoutGroup|LazyMotion|MotionConfig|Slot|SlotClone|Slottable|Primitive\b.*|Presence|Portal|DismissableLayer|FocusScope|RemoveScroll|Suspense|StrictMode|Fragment|.*Provider|.*Consumer|.*Context)$/

// Nearest components, innermost first: the components that rendered the
// element (React's owner chain), which skips wrappers it was merely passed
// through; failing that, its ancestors.
function reactComponents(el) {
  const names = []
  const add = (name) => name && /^[A-Z]/.test(name) && !INTERNAL.test(name) && !names.includes(name) && names.push(name)
  const f0 = fiberOf(el)
  for (let o = f0 && f0._debugOwner, i = 0; o && i < 30 && names.length < 4; o = o._debugOwner || o.owner, i++) add(componentName(o.type) || o.name)
  for (let f = f0; f && names.length < 4; f = f.return) if (!names.length || names.length < 2) add(componentName(f.type))
  return names
}

// Where the element was written: React's debug info. React 18 and older keep
// _debugSource (already source lines). React 19 keeps a stack (_debugStack)
// whose app frames lead to the JSX; those are lines of the file as served
// (types stripped, JSX compiled; or a whole bundle, as Next's Turbopack and
// webpack chunks are), which mapSource() turns back into source lines with
// the served file's source map. Frames that map into library code (the JSX
// runtime bundled into the same chunk) are skipped; an element a library
// rendered (Motion's <motion.span>: every frame of its own stack is the
// library's, bundled into the app's chunk on Next 15's Turbopack, F128) is
// where the app wrote that component. With no map at all the source stays
// unmapped (mapped: false) and says it's a compiled bundle.
// (Vite's pre-bundled deps carry a ?v= hash wherever its cacheDir is.)
const LIB_URL = /node_modules|\/\.vite\/deps\/|\/deps\/[^/?]+\.js\?v=[0-9a-f]+|react-dom|react\.development|jsx-dev-runtime/
const LIB_FN = /\bat (?:exports\.|Object\.)?(?:jsxDEV|jsxs?|createElement|jsxWithValidation\w*)\b/
// A script inline in the page (its URL is the page's: no file name).
const INLINE_URL = /^https?:\/\/[^/]+(\/[^?#]*\/)?(\/?[^/.?#]*)?([?#].*)?$/
// A fiber's stack: { frames } (served frames, or a webpack module's path),
// { server } (a server component's chunk line) or null.
function stackOf(f) {
  const stack = f._debugStack && (f._debugStack.stack || String(f._debugStack))
  if (!stack) return null
  const frames = []
  let server = null
  for (const line of stack.split("\n").slice(1)) {
    // Below React's call into the component: React, the scheduler and
    // whatever called them (the page's own inline scripts), never where the
    // element was written (F136).
    if (/react[-_]stack[-_]bottom[-_]frame/.test(line)) break
    const m = line.match(/(\S+?):(\d+):(\d+)\)?\s*$/)
    if (!m || LIB_FN.test(line)) continue
    const url = m[1].replace(/^.*?\(/, "")
    if (LIB_URL.test(url) || INLINE_URL.test(url)) continue
    // webpack's eval'd modules (Next on webpack): the module's own path, its line is the compiled one.
    if (/^webpack-internal:/.test(url)) {
      frames.push({ file: cleanSource(url.replace(/^webpack-internal:\/\/\/(\([^)]*\)\/)?/, "")), line: null })
      continue
    }
    // A server component's frame (React 19 dev: about://React/Server/file:///…/.next/…chunk.js)
    // is a compiled chunk on the server: the dev server maps it (F95, /__retake/map).
    if (!/^https?:\/\//.test(url)) {
      if (!server) server = { chunk: url.replace(/^about:\/\/React\/Server\//, ""), line: Number(m[2]), col: Number(m[3]) }
      continue
    }
    frames.push({ url, line: Number(m[2]), col: Number(m[3]) })
    if (frames.length >= 8) break
  }
  return frames.length ? { frames } : server ? { server } : null
}
function sourceOf(el) {
  for (let f = fiberOf(el), i = 0; f && i < 12; f = f.return, i++) {
    // The element's own JSX (exact), or a parent's, where it was passed in (owner).
    const confidence = i === 0 ? "exact" : "owner"
    const src = f._debugSource
    if (src && src.fileName) return { file: shortPath(src.fileName), line: src.lineNumber || null, mapped: true, confidence }
    const st = stackOf(f)
    if (!st) continue
    const first = st.frames && st.frames[0]
    if (first && !first.url) return { file: first.file, line: null, mapped: true, confidence }
    if (first) {
      const out = { file: shortPath(first.url), line: first.line, col: first.col, url: first.url, mapped: false, confidence }
      mapSource(out, st.frames, () => libraryParents(f.return, i + 1))
      return out
    }
    // Written by a server component: its line, never the client parent's.
    if (st.server && i === 0) {
      const out = { file: null, line: null, server: true, chunk: st.server.chunk, col: st.server.col, chunkLine: st.server.line, confidence: "unknown" }
      mapServerSource(out)
      return out
    }
  }
  return null
}
// The fibers above one whose stack was all library code: each one's served
// frames, nearest first (the component the app wrote, e.g. <motion.span>).
function libraryParents(f, i) {
  const out = []
  for (; f && i < 12 && out.length < 4; f = f.return, i++) {
    const st = stackOf(f)
    if (st && st.frames && st.frames[0] && st.frames[0].url) out.push(st.frames)
    else if (st) break
  }
  return out
}

// The dev server reads the chunk's source map from disk: fills in the file
// and line of a server component's element, in place.
async function mapServerSource(src) {
  if (!net.on) return
  try {
    const q = new URLSearchParams({ url: src.chunk, line: String(src.chunkLine), col: String(src.col || 0) })
    const r = await api("GET", `map?${q}`)
    const v = r && r.value && typeof r.value === "object" ? r.value : null
    if (v && v.file) {
      src.file = v.file
      src.line = v.line || null
      src.mapped = true
      src.confidence = "exact"
    }
  } catch {}
}
function shortPath(p) {
  try {
    // A dev server's URL path is from the project's root (Vite's /@fs/ is an absolute path).
    if (/^https?:/.test(p)) {
      p = new URL(p).pathname
      if (!p.startsWith("/@fs/")) return p.replace(/^\/+/, "")
    }
  } catch {}
  return projectPath(p.replace(/\?.*$/, "").replace(/^\/@fs/, ""))
}
// An absolute path inside the project, relative to it (macOS's /var is /private/var).
function projectPath(p) {
  const root = String((window.__retakeConfig && window.__retakeConfig.root) || "").replace(/\/+$/, "")
  if (!root || !p || p[0] !== "/") return p
  for (const r of new Set([root, root.replace(/^\/private\//, "/"), root.startsWith("/private/") ? root : "/private" + root])) if (p.startsWith(r + "/")) return p.slice(r.length + 1)
  return p
}

// ---- source maps: served line → source line ----------------------------------------
// (server/sourcemap.js does the same for the MCP server.)

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
function decodeMappings(mappings) {
  const lines = []
  let src = 0, oLine = 0, oCol = 0
  for (const text of String(mappings || "").split(";")) {
    const segs = []
    let gCol = 0
    for (const seg of text.split(",")) {
      if (!seg) continue
      const v = []
      for (let i = 0, shift = 0, acc = 0; i < seg.length; i++) {
        const d = B64.indexOf(seg[i])
        if (d < 0) break
        acc += (d & 31) << shift
        if (d & 32) shift += 5
        else {
          v.push(acc & 1 ? -(acc >> 1) : acc >> 1)
          acc = shift = 0
        }
      }
      gCol += v[0] || 0
      if (v.length >= 4) {
        src += v[1]
        oLine += v[2]
        oCol += v[3]
        segs.push([gCol, src, oLine, oCol])
      }
    }
    lines.push(segs)
  }
  return lines
}

// Where a served line/column (1-based) came from: { source, line } or null.
// Index maps (`sections`, Turbopack's) are read section by section.
const decodedMaps = new WeakMap()
function originalPosition(map, line, col) {
  if (!map || !(line > 0)) return null
  if (Array.isArray(map.sections)) {
    const L = line - 1
    const C = col > 0 ? col - 1 : null
    let hit = null
    for (const s of map.sections) {
      const o = s.offset || { line: 0, column: 0 }
      if (o.line < L || (o.line === L && (C == null || o.column <= C))) hit = s
      else break
    }
    if (!hit || !hit.map) return null
    const o = hit.offset || { line: 0, column: 0 }
    return originalPosition(hit.map, L - o.line + 1, C == null ? null : (L === o.line ? C - o.column : C) + 1)
  }
  let lines = decodedMaps.get(map)
  if (!lines) decodedMaps.set(map, (lines = decodeMappings(map.mappings)))
  const segs = lines[line - 1]
  if (!segs || !segs.length) return null
  let best = segs[0]
  if (col > 0) for (const s of segs) if (s[0] <= col - 1) best = s
  let source = map.sources && map.sources[best[1]]
  if (source && map.sourceRoot && !/^[a-z]+:/i.test(source) && !source.startsWith("/")) source = map.sourceRoot.replace(/\/?$/, "/") + source
  return source ? { source, line: best[2] + 1 } : null
}

// A map's source name as a path (webpack://app/./src/a.tsx → src/a.tsx,
// turbopack:///[project]/app/page.tsx → app/page.tsx, file:///… → /…),
// relative to the project when the map's node_modules sources show where it is.
function cleanSource(name, map) {
  let p = String(name || "").replace(/[?#].*$/, "")
  p = p.replace(/^webpack:\/\/[^/]*\//, "").replace(/^turbopack:\/\/\/?(\[project\]\/)?/, "").replace(/^\[project\]\//, "")
  if (p.startsWith("file://")) {
    try {
      p = decodeURIComponent(new URL(p).pathname)
    } catch {
      p = p.slice(7)
    }
  }
  p = projectPath(p.replace(/^\.\//, ""))
  if (p.startsWith("/") && map) {
    const all = Array.isArray(map.sections) ? map.sections.flatMap((s) => (s.map && s.map.sources) || []) : map.sources || []
    for (const s of all) {
      const m = /^(?:file:\/\/)?(\/.*?)\/node_modules\//.exec(String(s || ""))
      if (m && p.startsWith(m[1] + "/")) return p.slice(m[1].length + 1)
    }
  }
  return p
}
const libraryFile = (f) => /(^|\/)node_modules\/|\/\.vite\/deps\/|react-dom|jsx-dev-runtime|jsx-runtime|\[turbopack\]|turbopack\/|webpack\/(bootstrap|runtime)/.test(f)

const sourceMaps = new Map() // served url (without query) → Promise<map | null>
function loadMap(url) {
  const key = url.replace(/\?.*$/, "")
  if (!sourceMaps.has(key))
    sourceMaps.set(
      key,
      (async () => {
        try {
          if (!/^https?:\/\//.test(url)) return null
          const res = await fetch(url)
          if (!res.ok) return null
          const code = await res.text()
          const header = res.headers.get("sourcemap") || res.headers.get("x-sourcemap")
          const refs = [...code.matchAll(/\/\/[#@] sourceMappingURL=(\S+)/g)]
          const ref = header || (refs.length ? refs[refs.length - 1][1] : null)
          let json
          if (ref && ref.startsWith("data:")) {
            const b64 = ref.slice(ref.indexOf(",") + 1)
            json = /;base64/.test(ref.slice(0, ref.indexOf(","))) ? new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))) : decodeURIComponent(b64)
          } else {
            const r = await fetch(ref ? new URL(ref, url) : key + ".map")
            if (!r.ok) return null
            json = await r.text()
          }
          return JSON.parse(json)
        } catch {
          return null
        }
      })(),
    )
  return sourceMaps.get(key)
}

// Rewrites src (file, line) in place from the first frame that maps into the
// app's own code, so the note that holds it is saved with the source line.
// When every frame maps into library code, the parents' frames (`more()`)
// are tried in turn: where the app used the library's component.
async function mapSource(src, frames = [src], more = null) {
  let r = await mapFrames(src, frames)
  for (const fr of r === "library" && more ? more() : []) {
    r = await mapFrames(src, fr)
    if (r !== "library") break
  }
  if (r === "mapped") return
  // No map: a compiled bundle's line is no use to anyone; say so (the component and selector still are).
  if (/\/_next\/static\/|\.vite\/deps|\._\.js$|[-_.](?=[0-9a-z]*\d)[0-9a-z]{6,}\.m?js$/i.test(src.file)) src.compiled = true
}
// "mapped" (src rewritten), "library" (every frame read maps into library
// code) or "none".
async function mapFrames(src, frames) {
  let sawLibrary = false
  for (const fr of frames) {
    if (!fr.url) {
      Object.assign(src, { file: fr.file, line: null, mapped: true })
      delete src.col
      delete src.url
      return "mapped"
    }
    const map = await loadMap(fr.url)
    if (!map) {
      if (fr === frames[0]) return "none" // nothing to read this one with: unmapped
      continue
    }
    const pos = originalPosition(map, fr.line, fr.col)
    if (!pos) continue
    const file = cleanSource(pos.source, map)
    if (!file) continue
    if (libraryFile(file)) {
      sawLibrary = true
      continue
    }
    // A module served as itself (Vite) keeps its served path; a bundle names the source.
    const served = shortPath(fr.url)
    src.file = file.split("/").pop() === served.split("/").pop() ? served : file
    src.line = pos.line
    src.mapped = true
    delete src.col
    delete src.url
    delete src.compiled
    return "mapped"
  }
  return sawLibrary ? "library" : "none"
}

// The computed styles an agent would ask about first. Defaults are left out.
const KEY_STYLES = ["display", "position", "width", "height", "margin", "padding", "color", "background-color", "font-size", "font-weight", "border-radius", "opacity", "transform", "transition", "animation-name", "z-index", "gap"]
const BORING = new Set(["none", "normal", "auto", "0px", "static", "visible", "rgba(0, 0, 0, 0)", "all 0s ease 0s", "0s", ""])
function keyStyles(el) {
  const out = {}
  try {
    const cs = el.ownerDocument.defaultView.getComputedStyle(el)
    for (const p of KEY_STYLES) {
      const v = cs.getPropertyValue(p)
      if (!BORING.has(v) && !(p === "opacity" && v === "1")) out[p] = p === "transition" ? summariseTransition(v) : v
    }
  } catch {}
  return out
}

// Tailwind's transition-colors lists ten properties with one timing; say
// that once: "10 properties 0.15s cubic-bezier(0.4, 0, 0.2, 1)".
function summariseTransition(v) {
  const parts = v.split(/,(?![^(]*\))/).map((x) => x.trim())
  if (parts.length <= 3) return v
  const groups = new Map()
  for (const part of parts) {
    const [prop, ...rest] = part.split(/\s+(?![^(]*\))/)
    const timing = rest.join(" ")
    groups.set(timing, [...(groups.get(timing) || []), prop])
  }
  return [...groups].map(([timing, props]) => (props.length > 2 ? `${props.length} properties ${timing}` : `${props.join(", ")} ${timing}`)).join("; ")
}

function describe(el) {
  const tag = el.tagName.toLowerCase()
  // Tag plus its id or first class: short enough to read whole.
  const id = el.id ? `#${el.id}` : ""
  const cls = id ? "" : [...el.classList].slice(0, 1).map((c) => `.${c}`).join("")
  const text = (el.innerText || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 80)
  const r = el.getBoundingClientRect()
  let page = "/"
  try {
    const u = new URL(D.frame.contentWindow.location.href)
    u.searchParams.delete("__wb")
    page = u.pathname + u.search
  } catch {}
  const sel = selectorInfo(el)
  return {
    label: `<${tag}${id}${cls}>`,
    text,
    selector: sel.selector,
    matches: sel.matches || 1,
    shadowHost: sel.shadowHost || undefined,
    hint: selectorHint(el, text),
    components: reactComponents(el),
    source: sourceOf(el),
    classes: [...el.classList],
    styles: keyStyles(el),
    rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    page,
  }
}

// What grep finds the element by: its text, the CSS-module classes it has
// (`_title_18lyj_1` is `.title` in a *.module.css), its component.
function selectorHint(el, text) {
  const parts = []
  if (text) parts.push(`text "${text.length > 40 ? text.slice(0, 40) + "…" : text}"`)
  const mods = [...el.classList].map((c) => [c, moduleClass(c)]).filter(([, m]) => m)
  if (mods.length) parts.push(mods.map(([c, m]) => `${c} = .${m} in a CSS module`).join(", "))
  const comp = reactComponents(el)[0]
  if (comp) parts.push(`in <${comp}>`)
  return parts.join("; ") || null
}

// What was moving on the element at t, by the clip's exact element (never a
// selector match, F91): on it, else on one of its nearest ancestors, and then
// only if what that animates moves the element (a label inside a sliding
// button). A note on a still element says nothing is animating.
const CLIP_ANCESTORS = 4
const MOVES_IT = /^(all|transform|translate|scale|rotate|opacity|filter|clip-?path|top|left|right|bottom|inset|width|height|offset)/i
function clipFor(t, selector, el) {
  if (!el) {
    try {
      el = findEl(selector, D.frame.contentDocument)
    } catch {}
  }
  if (!el) return null
  const at = (c) => c.start <= t + 0.5 && (c.end == null || t <= c.end + 0.5)
  const latest = (list) => list.filter(at).sort((a, b) => b.start - a.start)[0] || null
  let node = el
  let c = latest(clipsOn(el).filter((x) => !x.pseudoElement))
  for (let n = el.parentElement, i = 0; !c && n && n.tagName !== "BODY" && n.tagName !== "HTML" && i < CLIP_ANCESTORS; n = n.parentElement, i++) {
    c = latest(clipsOn(n).filter((x) => !x.pseudoElement && clipMoves(x)))
    node = n
  }
  if (!c) return null
  const end = c.end == null ? null : c.end
  return { id: c.id, offset: Math.round(t - c.start), duration: end == null ? null : Math.round(end - c.start), start: Math.round(c.start), end: end == null ? null : Math.round(end), label: c.label || c.property || c.kind, kind: c.kind, property: c.property || null, selector: selectorInfo(node).selector || c.selector || null }
}
// The clips on the element itself: in its subtree (clipsFor, by recorded
// path), and not in any child's.
function clipsOn(el) {
  const all = clipsOfElement(el)
  if (!all.length) return []
  const inKids = new Set()
  for (const k of el.children) for (const c of clipsOfElement(k)) inKids.add(c)
  return all.filter((c) => !inKids.has(c))
}
const clipMoves = (c) => [c.property, ...Object.keys(c.from || {}), ...Object.keys(c.to || {})].filter(Boolean).flatMap((p) => String(p).split(/,\s*/)).some((p) => MOVES_IT.test(p))
const clipPhrase = (c) =>
  `${c.offset}ms into ${c.duration != null ? `a ${c.duration}ms` : "a running"} ${c.property ? `${c.property} ` : ""}${c.kind === "transition" ? "transition" : c.kind === "css-animation" ? `animation (${c.label})` : c.kind === "waapi" ? "animation" : c.label || "animation"}${c.selector ? ` on ${c.selector}` : ""}`

// Where the element was written, or why that isn't known.
const sourceText = (s) =>
  s.compiled ? "not mapped (only a compiled bundle, no source map): find it by the component and selector" : `${s.file}${s.line ? `:${s.line}` : ""}`

// The note as a prompt for a coding agent: what to change, where it is in
// the code, the moment and, for an animation, the exact point or range on its
// own clock. One formatter for this and `retake mcp` (src/note-text.js, NT).
function prompt(n) {
  const b = branchById(n.branchId)
  const parent = b && branchById(b.parentId)
  const el = n.el
  const st = el.styles || {}
  const extra = []
  if (el.pseudo) extra.push(`Animation: ${pseudoSentence(el)}`)
  // What an animation changes is given at the note's own point below; the
  // styles read when the composer opened would only contradict it.
  const moving = n.anims && n.anims.length ? /^(transform|opacity|animation-name|transition)$/ : null
  const shown = Object.entries(st).filter(([k]) => !moving || !moving.test(k))
  if (shown.length) extra.push(`Computed: ${shown.map(([k, v]) => `${k}: ${v}`).join("; ")}`)
  return NT.noteText(noteForServer(n), {
    start: D.last ? D.last.start : 0,
    timeline: b ? b.name : "Timeline",
    parent: parent ? parent.name : null,
    forkAt: b ? b.forkAt : null,
    sourceLine: el.source ? `Source: ${sourceText(el.source)}` : undefined,
    computed: extra.join("\n") || undefined,
  })
}

async function copy(text, btn) {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const ta = document.createElement("textarea")
    ta.value = text
    document.body.appendChild(ta)
    ta.select()
    document.execCommand("copy")
    ta.remove()
  }
  if (btn) {
    const was = btn.textContent
    btn.textContent = "Copied"
    setTimeout(() => (btn.textContent = was), 1200)
  }
}

// ---- notes as the server keeps them (CONTRACT.md "Note") --------------------------

const newNoteId = () => "n" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

function noteForServer(n) {
  return {
    id: n.id,
    branchId: n.branchId,
    t: n.t,
    clip: n.clip || null,
    selector: n.el.selector,
    component: n.el.components[0] || null,
    source: n.el.source || null,
    classes: n.el.classes || [],
    rect: n.el.rect,
    text: n.text,
    status: n.status || "pending",
    replies: n.replies || [],
    el: n.el,
    range: n.range || null,
    target: n.target || null,
    anims: n.anims || null,
    inside: n.inside || [],
    asked: n.asked || null,
    group: n.group || null,
  }
}

function noteFromServer(n) {
  const el = n.el || {
    label: n.selector || "element",
    text: "",
    selector: n.selector || "",
    components: n.component ? [n.component] : [],
    rect: n.rect || { x: 0, y: 0, w: 0, h: 0 },
    page: "/",
    classes: n.classes || [],
    source: n.source || null,
  }
  return { id: n.id, branchId: n.branchId, t: n.t, text: n.text || "", el, clip: n.clip || null, status: n.status || "pending", replies: n.replies || [], range: n.range || null, target: n.target || null, anims: n.anims || null, inside: n.inside || [], asked: n.asked || null, group: n.group || null }
}

// A change from outside (an agent replied, or marked it resolved).
function mergeNote(n) {
  const mine = D.notes.find((x) => String(x.id) === String(n.id))
  if (!mine) {
    if (branchById(n.branchId)) D.notes.push(noteFromServer(n))
    return
  }
  if (n.status) mine.status = n.status
  if (Array.isArray(n.replies)) mine.replies = n.replies
  else if (n.reply) mine.replies = [...(mine.replies || []), typeof n.reply === "string" ? { from: "agent", text: n.reply, at: Date.now() } : n.reply]
  if (openNote === mine) showNote(mine)
}

// ---- the note card -----------------------------------------------------------------

// Where a note points, on screen: the spot that was clicked, kept relative to
// its element (so it follows the element if that moved), else to where the
// element was.
function anchorOf(el) {
  const f = D.frame.getBoundingClientRect()
  let r = null
  try {
    const node = findEl(el.selector, D.frame.contentDocument)
    if (node) r = node.getBoundingClientRect()
  } catch {}
  if (!r || (!r.width && !r.height)) r = { x: el.rect.x, y: el.rect.y, width: el.rect.w, height: el.rect.h }
  const at = el.at || { dx: 0.5, dy: 0.5 }
  return { x: f.left + r.x + at.dx * r.width, y: f.top + r.y + at.dy * r.height }
}

// Next to its spot, with the arrow on it: below if it fits, else above,
// right, left; always kept on screen and clear of the dock.
function placeCard(point) {
  card.insertAdjacentHTML("afterbegin", '<i class="arrow"></i>')
  const arrow = card.querySelector(".arrow")
  const w = card.offsetWidth
  const h = card.offsetHeight
  const M = 8
  const GAP = 14
  const bottom = dock.getBoundingClientRect().top - M
  const right = innerWidth - M
  const cx = clamp(point.x - w / 2, M, right - w)
  const cy = clamp(point.y - 32, M, bottom - h)
  const sides = [
    { side: "below", left: cx, top: point.y + GAP, fits: (p) => p.top + h <= bottom },
    { side: "above", left: cx, top: point.y - GAP - h, fits: (p) => p.top >= M },
    { side: "right", left: point.x + GAP, top: cy, fits: (p) => p.left + w <= right },
    { side: "left", left: point.x - GAP - w, top: cy, fits: (p) => p.left >= M },
  ]
  const pick = sides.find((p) => p.fits(p)) || { side: "below", left: cx, top: clamp(point.y + GAP, M, bottom - h) }
  card.dataset.side = pick.side
  card.style.left = pick.left + "px"
  card.style.top = pick.top + "px"
  if (pick.side === "below" || pick.side === "above") {
    arrow.style.left = clamp(point.x - pick.left - 6, 12, w - 24) + "px"
    arrow.style.top = ""
  } else {
    arrow.style.top = clamp(point.y - pick.top - 6, 12, h - 24) + "px"
    arrow.style.left = ""
  }
}

function pseudoInfo(layer) {
  const a = layer.anim
  let timing = {}
  try {
    timing = a.effect.getTiming()
  } catch {}
  return {
    pseudoElement: layer.pseudo,
    animationName: layer.name,
    keyframes: a.animationName || null,
    duration: Number(timing.duration) || 0,
    iterations: timing.iterations === Infinity ? "infinite" : timing.iterations || 1,
    delay: Number(timing.delay) || 0,
  }
}
// The clip of that pseudo-element animation at t (the runtime keys it by the
// host's selector plus the pseudo-element).
function pseudoClip(t, desc) {
  const want = (c) => (c.pseudoElement || null) === desc.pseudo.pseudoElement
  const clips = timeline().clips.filter((c) => want(c) && c.start <= t && (c.end == null || c.end >= t))
  let host = null
  try {
    host = findEl(desc.selector, D.frame.contentDocument)
  } catch {}
  const onHost = (c) => !!host && (c.selector === cssPath(host) + desc.pseudo.pseudoElement || nodeOfPseudoClip(c) === host)
  const c = clips.find((c) => c.selector === desc.selector + desc.pseudo.pseudoElement) || clips.find(onHost) || clips[0]
  if (!c) return null
  return { id: c.id, offset: Math.round(t - c.start), duration: c.end == null ? null : Math.round(c.end - c.start), start: Math.round(c.start), end: c.end == null ? null : Math.round(c.end), label: c.label || desc.pseudo.animationName, kind: c.kind, property: c.property || null, selector: c.selector || null }
}
// The element a ::before/::after clip is on (its selector without the pseudo-element).
function nodeOfPseudoClip(c) {
  const pe = c.pseudoElement || ""
  const sel = c.selector && pe && c.selector.endsWith(pe) ? c.selector.slice(0, -pe.length) : c.selector
  try {
    return findEl(sel, D.frame.contentDocument)
  } catch {
    return null
  }
}
// Where the animation is written in the CSS (the runtime reads Vite's
// source maps); filled in when it answers.
function lookUpCss(desc, anim) {
  const pt = D.PT
  if (!pt || typeof pt.cssSourceFor !== "function") return
  Promise.resolve()
    .then(() => pt.cssSourceFor(anim))
    .then((r) => {
      if (!r || (!r.file && !r.line)) return
      // No file: it's in a <style> in the page itself.
      const where = (f) => (f ? shortPath(f) : `${desc.page || "/"} <style>`)
      desc.cssSource = { file: where(r.file), line: r.line || null, keyframes: r.keyframes ? { name: r.keyframes.name, file: where(r.keyframes.file || r.file), line: r.keyframes.line || null } : null }
    })
    .catch(() => {})
}
// "The ::after shimmer animation (keyframes `shimmer`, 1.2s, infinite) on .card"
function pseudoSentence(el) {
  const p = el.pseudo
  const host = el.classes && el.classes.length ? `.${el.classes[0]}` : el.selector
  const bits = [p.keyframes ? `keyframes \`${p.keyframes}\`` : null, p.duration ? msWord(p.duration) : null, p.iterations === "infinite" ? "infinite" : p.iterations > 1 ? `${p.iterations} times` : null].filter(Boolean)
  return `The ${p.pseudoElement} ${p.animationName} animation${bits.length ? ` (${bits.join(", ")})` : ""} on ${host}`
}

// The card's header: the timeline's colour, the moment, the element.
function meta(t, el, branchId = D.activeId) {
  const start = D.last ? D.last.start : 0
  const b = branchById(branchId)
  return `<div class="note-meta"><span class="dot" style="background:${colorOf(b)}" title="${esc(b ? b.name : "")}"></span><span class="time">${fmt(t - start)}</span><span class="el" title="${esc(el.selector)}">${esc(el.label)}</span></div>`
}

// "140ms into the opacity transition", "2.3s into fm-note-rise (opacity, transform)".
function shortClip(c) {
  const at = msWord(Math.max(0, c.offset || 0))
  if (c.kind === "transition") return `${at} into the ${c.property ? c.property + " " : ""}transition`
  const name = c.label || "an animation"
  return `${at} into ${name}${c.property && c.property !== name ? ` (${c.property})` : ""}`
}

// Everything else about the element, folded away.
function details(el, geo = null) {
  const rows = [["Selector", el.selector]]
  if (el.components && el.components.length) rows.push(["Component", el.components.join(" < ")])
  if (el.source) rows.push(["Source", sourceText(el.source)])
  if (el.pseudo) rows.push(["Animation", pseudoSentence(el)])
  if (el.cssSource) rows.push(["CSS", `${el.cssSource.file}${el.cssSource.line ? ":" + el.cssSource.line : ""}`])
  if (el.classes && el.classes.length) rows.push(["Classes", el.classes.join(" ")])
  if (geo && geo.page) rows.push(["Box", `x ${Math.round(geo.page.x)} y ${Math.round(geo.page.y)} · ${Math.round(geo.page.w)}×${Math.round(geo.page.h)} (page)${geo.decomposed && (geo.decomposed.tx || geo.decomposed.ty) ? ` · translate ${geo.decomposed.tx}, ${geo.decomposed.ty}` : ""}${geo.opacity != null && geo.opacity !== 1 ? ` · opacity ${+Number(geo.opacity).toFixed(2)}` : ""}`])
  return `<details class="details"><summary>Details</summary><dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join("")}</dl></details>`
}

function openComposer(el, point, layer) {
  const s = D.last
  if (!D.PT || !s || !isStill()) return
  const t = s.previewing ? s.previewAt : s.now
  const desc = describe(el)
  // The spot that was clicked, as a fraction of the element.
  const r = el.getBoundingClientRect()
  desc.at = point && r.width && r.height ? { dx: clamp((point.x - r.x) / r.width, 0, 1), dy: clamp((point.y - r.y) / r.height, 0, 1) } : { dx: 0.5, dy: 0.5 }
  // A picked ::before/::after animation: the note is about that.
  if (layer && layer.pseudo) {
    desc.pseudo = pseudoInfo(layer)
    desc.label = `<${shortLabel(el)}>${layer.pseudo}`
    lookUpCss(desc, layer.anim)
  }
  const clip = desc.pseudo ? pseudoClip(t, desc) : clipFor(t, desc.selector, el)
  draft = { el: desc, t, clip, picked: layer && layer.picked ? layer.picked : null, asked: null, askedReading: null }
  openNote = null
  // The element becomes the dock's focus: its own animations get a row on the track (32-anims.js).
  focusOn(el, layer, t)
  card.innerHTML = `${meta(t, draft.el)}<div class="note-at" hidden></div><textarea rows="3" placeholder="What should change here?"></textarea>
    <button class="note-asked" data-note-a="asked" hidden></button>
    <div class="note-actions"><button data-note-a="cancel">Cancel</button><button data-note-a="save" class="primary">Add note</button></div>`
  card.hidden = false
  refreshComposer()
  placeCard(anchorOf(draft.el))
  const ta = card.querySelector("textarea")
  setTimeout(() => ta.focus())
  ta.addEventListener("input", updateAsked)
  // Enter saves and folds the note down to its pin; Shift+Enter is a new line.
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      saveDraft()
    }
    if (e.key === "Escape") {
      e.stopPropagation()
      if (!closeFocusClip()) closeCard()
    }
  })
}

function saveDraft() {
  const text = card.querySelector("textarea").value.trim()
  if (draft && text) {
    updateAsked()
    let extra = { t: draft.t, range: null, target: null, anims: null, inside: [], asked: null }
    try {
      extra = notePayload(draft)
    } catch (err) {
      console.error("[retake] couldn't describe the note's animations", err)
    }
    // A note moved to another moment on the element's row: its clip summary follows.
    const clip = extra.t !== draft.t && !draft.el.pseudo ? clipFor(extra.t, draft.el.selector, D.focus && D.focus.el) : draft.clip
    // A dragged range wins over numbers typed in the note.
    const asked = extra.range && D.focus && D.focus.open ? null : extra.asked
    D.notes.push({ id: newNoteId(), t: extra.t, branchId: D.activeId, text, el: draft.el, clip, status: "pending", replies: [], range: extra.range, target: extra.target, anims: extra.anims, inside: extra.inside, asked, group: extra.group || null })
  }
  closeCard()
  // Back to the Hand so the next click is on the prototype, not another note.
  setPicking(null)
}

function showNote(n) {
  // Re-showing the same note (a reply came in) keeps Details as it was.
  const keepOpen = openNote === n && !!card.querySelector(".details[open]")
  openNote = n
  draft = null
  const replies = (n.replies || [])
    .map((r) => `<div class="reply ${r.from === "agent" ? "agent" : "user"}"><span class="who">${r.from === "agent" ? "Agent" : "You"}</span>${esc(r.text)}</div>`)
    .join("")
  const status = n.status || "pending"
  const at = n.anims ? NT.atPhrase(noteForServer(n)) : null
  const clipLine = at || (n.clip ? shortClip(n.clip) : "")
  card.innerHTML = `${meta(n.t, n.el, n.branchId)}<p class="note-text">${esc(n.text)}</p>
    ${clipLine ? `<div class="note-clip">${esc(clipLine)}</div>` : ""}
    ${details(n.el, n.target && n.target.geometry)}
    ${replies ? `<div class="replies">${replies}</div>` : ""}
    <div class="note-actions"><span class="status s-${esc(status)}">${esc(status[0].toUpperCase() + status.slice(1))}</span>
      <button data-note-a="delete" class="quiet">Delete</button>
      <button data-note-a="resolve">${status === "resolved" ? "Reopen" : "Resolve"}</button>
      <button data-note-a="copy" class="primary">Copy for agent</button></div>`
  if (keepOpen) card.querySelector(".details").open = true
  card.hidden = false
  placeCard(anchorOf(n.el))
  // Its element row, opened clip and range come back with it.
  if (((n.anims && n.anims.length) || n.group) && (!D.focus || D.focus.note !== n)) {
    focusFromNote(n)
    if (D.focus) D.focus.note = n
  }
}

// Tell the server about a status change (the session save carries it too).
function patchNote(n, body) {
  if (!net.on) return
  api("PATCH", `notes/${encodeURIComponent(n.id)}`, body).catch(() => {})
}

function closeCard() {
  card.hidden = true
  draft = null
  openNote = null
  clearFocus()
}

// Returns true when the click was one of ours.
function handleNoteClick(b) {
  const act = b.dataset.noteA
  if (act === "save") saveDraft()
  if (act === "cancel") closeCard()
  if (act === "asked" && draft) {
    draft.askedReading = draft.askedReading === "recording" ? null : "recording"
    updateAsked()
  }
  if (act === "copy" && openNote) {
    copy(prompt(openNote), b)
    // Copied: fold the note back to its pin.
    setTimeout(closeCard, 700)
  }
  if (act === "resolve" && openNote) {
    openNote.status = openNote.status === "resolved" ? "pending" : "resolved"
    patchNote(openNote, { status: openNote.status })
    showNote(openNote)
  }
  if (act === "delete" && openNote) {
    D.notes = D.notes.filter((n) => n !== openNote)
    closeCard()
  }
  if (b.dataset.note) goToNoteId(b.dataset.note)
  return !!(act || b.dataset.note)
}

// From a pin, the timeline or the list: go to the note's moment and open it.
function goToNoteId(id) {
  const n = D.notes.find((x) => String(x.id) === String(id))
  if (!n) return
  if (n.branchId !== D.activeId) switchTo(n.branchId, n.t)
  else if (D.PT && D.last && Math.abs(shownTime(D.last) - n.t) > 5) goTo(n.t)
  showNote(n)
}

// ---- the lens: ⌘ held over an element shows its own animations on the lane ----------

// The runtime's clipsFor(element) when it has it; else the clips whose
// element is this one or inside it.
function clipsOfElement(el) {
  const pt = D.PT
  if (pt && typeof pt.clipsFor === "function") {
    try {
      return pt.clipsFor(el) || []
    } catch {}
  }
  const out = []
  const doc = el.ownerDocument
  for (const c of timeline().clips) {
    if (!c.selector) continue
    let node = null
    try {
      node = doc.querySelector(c.selector)
    } catch {}
    if (node && (node === el || el.contains(node))) out.push(c)
  }
  return out
}

function updateLens() {
  const p = pick()
  const target = D.metaHeld && mode() === "comment" && hovered && hovered.isConnected ? hovered : null
  if (!target) {
    D.lens = null
    return
  }
  const want = `${cssPath(target)}${p && p.el === target && p.pseudo ? p.pseudo + p.name : ""}`
  if (D.lens && D.lens.want === want) return
  let clips = clipsOfElement(target)
  // A picked ::after shimmer: only its own activity.
  if (p && p.el === target && p.pseudo) clips = clips.filter((c) => (c.pseudoElement || null) === p.pseudo && (!p.name || !c.label || c.label === p.name || c.label.startsWith(p.name)))
  D.lens = { el: target, clips, want, key: `${want}:${clips.length}` }
}

// ---- drawing on the prototype --------------------------------------------------------

const pinEls = new Map()
const boxAt = (el, box) => {
  const f = D.frame.getBoundingClientRect()
  const r = el.getBoundingClientRect()
  Object.assign(box.style, { display: "block", left: f.left + r.left + "px", top: f.top + r.top + "px", width: r.width + "px", height: r.height + "px" })
}

function renderExtras(s) {
  // Leaving a still moment (recording) drops back to the Hand.
  if (D.picking && !isStill()) setPicking(null)
  for (const t of /** @type {NodeListOf<HTMLButtonElement>} */ (document.querySelectorAll('[data-tool="select"], [data-tool="comment"]'))) {
    t.disabled = !isStill()
    t.classList.toggle("disabled", !isStill())
  }
  const tool = mode() || "hand"
  for (const t of /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll("[data-tool]"))) {
    t.classList.toggle("on", t.dataset.tool === tool)
    t.setAttribute("aria-selected", String(t.dataset.tool === tool))
  }
  syncEmbeds()
  watchClasses(D.frame)
  if (D.building) watchClasses(D.building.frame)
  document.body.classList.toggle("picking-notes", mode() === "comment")

  updateLens()
  renderLayers()
  const target = mode() && hovered && hovered.isConnected ? hovered : null
  hl.style.display = target ? "block" : "none"
  if (target) {
    boxAt(target, hl)
    // A picked ::before/::after: its host, dashed, labelled with the pseudo.
    const p = pick()
    const pseudo = p && p.el === target && p.pseudo
    hl.className = (mode() === "select" ? "select" : "") + (pseudo ? " pseudo" : "")
    hl.dataset.label = pseudo ? `${shortLabel(target)}${p.pseudo}` : `<${shortLabel(target)}>`
  }
  if (D.scopeEl && D.scopeEl.isConnected) boxAt(D.scopeEl, scopeBox)
  else scopeBox.style.display = "none"

  // Numbered pins on the notes of the branch in view, only while it's paused:
  // live or playing, the app is left alone (the count still says how many).
  const paused = !s.playing && !(D.building && D.building.play)
  if (!paused && openNote) closeCard()
  let doc = null
  try {
    doc = D.frame.contentDocument
  } catch {}
  const seen = new Set()
  D.notes.forEach((n, i) => {
    if (n.branchId !== D.activeId || !doc || s.seeking || !paused) return
    const p = anchorOf(n.el)
    let pin = pinEls.get(n.id)
    if (!pin) {
      pin = document.createElement("button")
      pin.className = "canvas-pin"
      pin.dataset.note = n.id
      $("#wb-pins").appendChild(pin)
      pinEls.set(n.id, pin)
    }
    pin.textContent = String(i + 1)
    // A note made at another moment: its pin is dimmed (the element may look
    // different now); clicking it goes there.
    pin.classList.toggle("away", Math.abs(n.t - shownTime(s)) > 60)
    pin.style.background = NOTE_FILL[n.status] || NOTE_FILL.pending
    pin.title = n.text
    pin.style.left = p.x + "px"
    pin.style.top = p.y + "px"
    seen.add(n.id)
  })
  paintCount(D.notes.filter((n) => n.branchId === D.activeId).length)
  for (const [id, pin] of pinEls) {
    if (seen.has(id)) continue
    pin.remove()
    pinEls.delete(id)
  }
}

// ---- the count: how many notes this timeline has, as a badge on the notes icon ----------

const countEl = $(".notes-count")
let shownCount = -1
function paintCount(n) {
  if (n === shownCount) return
  shownCount = n
  countEl.querySelector(".n").textContent = n > 99 ? "99+" : String(n)
  countEl.classList.toggle("has", n > 0)
  countEl.setAttribute("aria-label", n === 0 ? "No notes on this timeline" : n === 1 ? "1 note on this timeline" : `${n} notes on this timeline`)
}
