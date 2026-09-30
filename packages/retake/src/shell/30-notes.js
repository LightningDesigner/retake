// Picking elements in the prototype. Two tools share it:
//  - Comment (or hold ⌘): click an element, down to the innermost child, and
//    write a note. Notes keep their moment and branch, show as numbered pins on
//    the prototype and tags on the timeline, and copy as a prompt.
//  - Select: pick one component; scrubbing then rewinds only that component.

let hovered = null
let lastPointer = null
let draft = null
let openNote = null
const hl = $("#wb-hl")
const scopeBox = $("#wb-scope")
const card = $("#wb-note")
// Select and Comment work on the past (the app is view-only there).
const isStill = () => !!(D.last && D.last.started && !isInteractive())
const mode = () => (!isStill() ? null : D.metaHeld ? "comment" : D.picking)

const shell = window.__waybackShell
shell.inspecting = false
shell.inspect = (e) => {
  const el = e.target.nodeType === 1 ? e.target : e.target.parentElement
  if (e.type === "pointermove" || e.type === "pointerover") {
    buildLayers(e.clientX, e.clientY, usable(el))
  } else if (e.type === "wheel") {
    if (Math.abs(e.deltaY) >= 4) cycleLayer(e.deltaY > 0 ? 1 : -1)
  } else if (e.type === "keydown" && e.key === "Tab") {
    cycleLayer(e.shiftKey ? -1 : 1)
  } else if (e.type === "click" && usable(el)) {
    const p = pick()
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
shell.pointer = (x, y, meta) => {
  lastPointer = { x, y }
  if (meta !== undefined && meta !== D.metaHeld) shell.meta(meta)
}
shell.meta = (down) => {
  if (D.metaHeld === down) return
  D.metaHeld = down
  syncPicking()
}

// ---- the layer picker: what's under the pointer, including pseudo-elements ----------
// ⌘ over the app lists the layers at that point, topmost first: each element,
// and after it any animation running on its ::before/::after (a shimmer on a
// skeleton, say). Wheel or Tab moves through them; a click picks the
// highlighted one.

let layers = [] // [{ el, pseudo, anim, name, label }]
let layerIdx = 0
let layersKey = ""
const layersEl = $("#wb-layers")
const pick = () => layers[layerIdx] || null

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

function buildLayers(x, y, fallback) {
  let els = []
  try {
    els = D.frame.contentDocument.elementsFromPoint(x, y)
  } catch {}
  const seen = new Set()
  const out = []
  for (const raw of els) {
    const el = usable(raw)
    if (!el || seen.has(el)) continue
    seen.add(el)
    if (seen.size > 4) break
    out.push({ el, pseudo: null, anim: null, name: null, label: shortLabel(el) })
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
      out.push({ el, pseudo: pe, anim: a, name, label: `${pe} · ${name} · ${animTiming(a)}` })
    }
  }
  if (!out.length && fallback) out.push({ el: fallback, pseudo: null, anim: null, name: null, label: shortLabel(fallback) })
  const key = out.map((l) => l.label).join("|")
  if (key !== layersKey) {
    layersKey = key
    layerIdx = 0
  }
  layers = out
  hovered = pick() ? pick().el : null
}

function cycleLayer(dir) {
  if (layers.length < 2) return
  layerIdx = (layerIdx + dir + layers.length) % layers.length
  hovered = pick().el
}

// The chip beside the pointer: the top layers, the pick highlighted.
let layersHtml = ""
function renderLayers() {
  const show = mode() === "comment" && layers.length > 0 && lastPointer
  layersEl.hidden = !show
  if (!show) return
  const top = layers.slice(0, 4)
  const html = top.map((l, i) => `<div class="layer${i === layerIdx ? " on" : ""}${l.pseudo ? " pseudo" : ""}">${esc(l.label)}</div>`).join("") + (layers.length > 4 ? `<div class="more">+${layers.length - 4}</div>` : "")
  if (html !== layersHtml) {
    layersHtml = html
    layersEl.innerHTML = html
  }
  const f = D.frame.getBoundingClientRect()
  const w = layersEl.offsetWidth
  const h = layersEl.offsetHeight
  layersEl.style.left = clamp(f.left + lastPointer.x + 16, 8, innerWidth - w - 8) + "px"
  layersEl.style.top = clamp(f.top + lastPointer.y + 16, 8, dock.getBoundingClientRect().top - h - 8) + "px"
}

// The page itself isn't a thing to comment on.
// Inside an SVG icon, the thing you mean is the icon's control (a button or
// link), or at least the whole <svg>, not one of its paths.
function usable(el) {
  if (!el || el.tagName === "HTML" || el.tagName === "BODY") return null
  if (el instanceof el.ownerDocument.defaultView.SVGElement) {
    const svgRoot = el.ownerSVGElement ? el.closest("svg:not(svg svg)") || el.ownerSVGElement : el
    const control = svgRoot.parentElement && svgRoot.parentElement.closest("button, a, [role=button], [role=link], label, [id]")
    return control && control.tagName !== "BODY" ? control : svgRoot
  }
  return el
}

// Leaving the Select tool lets go of the selected component.
function setPicking(m) {
  if (m !== "select") setScope(null)
  D.picking = m
  syncPicking()
}

function syncPicking() {
  shell.inspecting = !!mode()
  setToolActive(!!mode())
  hovered = null
  try {
    const doc = D.frame.contentDocument
    doc.documentElement.style.cursor = mode() ? "crosshair" : ""
    if (mode() && lastPointer) hovered = usable(doc.elementFromPoint(lastPointer.x, lastPointer.y))
  } catch {}
}

// Selecting the same component again clears it.
function setScope(el) {
  D.scopeEl = el && el === D.scopeEl ? null : el
  if (D.PT && D.last && D.last.previewing) D.PT.preview(D.last.previewAt, D.scopeEl)
}

// ---- describing an element ------------------------------------------------------

const cssEsc = (v) => (window.CSS && CSS.escape ? CSS.escape(v) : String(v).replace(/[^\w-]/g, (c) => "\\" + c))

// A valid selector for the element (ids like React's ":r1:" or "1st" are
// escaped): an id if there is one, else tag.class chains with :nth-of-type.
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

const fiberOf = (el) => {
  const key = Object.keys(el).find((k) => k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$"))
  return key ? el[key] : null
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
const INTERNAL = /^(PopChild|PopChildMeasure|PresenceChild|AnimatePresence|MotionComponent|MotionDOMComponent|LayoutGroup|LazyMotion|MotionConfig|Slot|SlotClone|Slottable|Primitive\b.*|Presence|Portal|DismissableLayer|FocusScope|RemoveScroll|Suspense|StrictMode|Fragment|.*Provider|.*Consumer|.*Context)$/

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
// whose first app frame is the JSX; those are lines of the file as served
// (types stripped, JSX compiled), which mapSource() turns back into source
// lines with the module's own source map.
function sourceOf(el) {
  for (let f = fiberOf(el), i = 0; f && i < 12; f = f.return, i++) {
    const src = f._debugSource
    if (src && src.fileName) return { file: shortPath(src.fileName), line: src.lineNumber || null, mapped: true }
    const stack = f._debugStack && (f._debugStack.stack || String(f._debugStack))
    if (stack) {
      for (const line of stack.split("\n").slice(1)) {
        const m = line.match(/(\S+?):(\d+):(\d+)\)?\s*$/)
        if (!m || /node_modules|\/\.vite\/deps\/|react-dom|react\.development|jsx-dev-runtime/.test(m[1])) continue
        const url = m[1].replace(/^.*?\(/, "")
        const src = { file: shortPath(url), line: Number(m[2]), col: Number(m[3]), url, mapped: false }
        mapSource(src)
        return src
      }
    }
  }
  return null
}
function shortPath(p) {
  try {
    if (/^https?:/.test(p)) p = new URL(p).pathname
  } catch {}
  return p.replace(/\?.*$/, "").replace(/^\/@fs/, "")
}

// ---- source maps: served line → source line ----------------------------------------

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
function decodeMappings(mappings) {
  const lines = []
  let src = 0, oLine = 0, oCol = 0
  for (const text of mappings.split(";")) {
    const segs = []
    let gCol = 0
    for (const seg of text.split(",")) {
      if (!seg) continue
      const v = []
      for (let i = 0, shift = 0, acc = 0; i < seg.length; i++) {
        const d = B64.indexOf(seg[i])
        acc += (d & 31) << shift
        if (d & 32) shift += 5
        else {
          v.push(acc & 1 ? -(acc >> 1) : acc >> 1)
          acc = shift = 0
        }
      }
      gCol += v[0]
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

const sourceMaps = new Map() // module url (without query) → Promise<{ map, lines } | null>
function loadMap(url) {
  const key = url.replace(/\?.*$/, "")
  if (!sourceMaps.has(key))
    sourceMaps.set(
      key,
      (async () => {
        try {
          const code = await (await fetch(url)).text()
          const m = code.match(/\/\/[#@] sourceMappingURL=(\S+)\s*$/)
          if (!m) return null
          let json
          if (m[1].startsWith("data:")) {
            const b64 = m[1].slice(m[1].indexOf(",") + 1)
            json = /;base64/.test(m[1].slice(0, m[1].indexOf(","))) ? new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))) : decodeURIComponent(b64)
          } else json = await (await fetch(new URL(m[1], url))).text()
          const map = JSON.parse(json)
          return { map, lines: decodeMappings(map.mappings || "") }
        } catch {
          return null
        }
      })(),
    )
  return sourceMaps.get(key)
}

// Rewrites src.line (and file, if the map names another) in place, so the
// note that holds it is saved with the source line.
async function mapSource(src) {
  const m = await loadMap(src.url)
  const segs = m && m.lines[src.line - 1]
  if (segs && segs.length) {
    let best = segs[0]
    for (const s of segs) if (s[0] <= src.col - 1) best = s
    src.line = best[2] + 1
    const name = m.map.sources && m.map.sources[best[1]]
    if (name && !name.startsWith("\0") && shortPath(name).split("/").pop() !== src.file.split("/").pop()) src.file = shortPath(name)
  }
  src.mapped = true
  delete src.col
  delete src.url
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
  return {
    label: `<${tag}${id}${cls}>`,
    text,
    selector: cssPath(el),
    components: reactComponents(el),
    source: sourceOf(el),
    classes: [...el.classList],
    styles: keyStyles(el),
    rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    page,
  }
}

// What was moving on the element at t: on it or inside it, else on one of its
// nearest ancestors (a label inside a sliding button). Never a clip from
// elsewhere on the page: a note on a still element says nothing is animating.
const CLIP_ANCESTORS = 4
function clipFor(t, selector, el) {
  let hit = clipAt(t, selector)
  for (let n = el && el.parentElement, i = 0; !hit && n && n.tagName !== "BODY" && i < CLIP_ANCESTORS; n = n.parentElement, i++) hit = clipAt(t, cssPath(n))
  if (!hit || !hit.clip) return null
  const c = hit.clip
  const end = c.end == null ? null : c.end
  return { id: c.id, offset: Math.round(hit.offset), duration: end == null ? null : Math.round(end - c.start), label: c.label || c.property || c.kind, kind: c.kind, property: c.property || null, selector: c.selector || null }
}
const clipPhrase = (c) =>
  `${c.offset}ms into ${c.duration != null ? `a ${c.duration}ms` : "a running"} ${c.property ? `${c.property} ` : ""}${c.kind === "transition" ? "transition" : c.kind === "css-animation" ? `animation (${c.label})` : c.kind === "waapi" ? "animation" : c.label || "animation"}${c.selector ? ` on ${c.selector}` : ""}`

// The note as a prompt for a coding agent: what to change, where it is in
// the code, and the moment it's about.
function prompt(n) {
  const b = branchById(n.branchId)
  const start = D.last ? D.last.start : 0
  const parent = b && branchById(b.parentId)
  const el = n.el
  const lines = [`## ${n.text}`, "", `Page: ${el.page}`, `Element: ${el.label}${el.text ? ` "${el.text}"` : ""}`, `Selector: ${el.selector}`]
  if (el.components.length) lines.push(`Component: ${el.components.join(" < ")}`)
  if (el.pseudo) lines.push(`Animation: ${pseudoSentence(el)}`)
  if (el.cssSource) lines.push(`CSS: ${el.cssSource.file}${el.cssSource.line ? `:${el.cssSource.line}` : ""}${el.cssSource.keyframes && el.cssSource.keyframes.line ? ` (@keyframes ${el.cssSource.keyframes.name} at ${el.cssSource.keyframes.file}:${el.cssSource.keyframes.line})` : ""}`)
  if (el.source) lines.push(`Source: ${el.source.file}${el.source.line ? `:${el.source.line}` : ""}`)
  if (el.classes && el.classes.length) lines.push(`Classes: ${el.classes.join(" ")}`)
  const st = el.styles || {}
  if (Object.keys(st).length) lines.push(`Computed: ${Object.entries(st).map(([k, v]) => `${k}: ${v}`).join("; ")}`)
  lines.push(`Size: ${el.rect.w}×${el.rect.h} at (${el.rect.x}, ${el.rect.y})`)
  lines.push(`Moment: ${fmt(n.t - start)} into the recording${n.clip ? `, ${clipPhrase(n.clip)}` : ", nothing animating"}`)
  lines.push(`Timeline: "${b ? b.name : "Timeline"}"${parent ? `, branched from "${parent.name}" at ${fmt(b.forkAt - start)}` : ""}`)
  const agent = (n.replies || []).filter((r) => r.from === "agent")
  if (agent.length) lines.push("", "Earlier replies:", ...agent.map((r) => `- ${r.text}`))
  return lines.join("\n")
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
  return { id: n.id, branchId: n.branchId, t: n.t, text: n.text || "", el, clip: n.clip || null, status: n.status || "pending", replies: n.replies || [] }
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
    const node = el.selector && D.frame.contentDocument.querySelector(el.selector)
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
  const c = clips.find((c) => c.selector === desc.selector + desc.pseudo.pseudoElement) || clips[0]
  if (!c) return null
  return { id: c.id, offset: Math.round(t - c.start), duration: c.end == null ? null : Math.round(c.end - c.start), label: c.label || desc.pseudo.animationName, kind: c.kind, property: c.property || null, selector: c.selector || null }
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
function details(el) {
  const rows = [["Selector", el.selector]]
  if (el.components && el.components.length) rows.push(["Component", el.components.join(" < ")])
  if (el.source) rows.push(["Source", `${el.source.file}${el.source.line ? ":" + el.source.line : ""}`])
  if (el.pseudo) rows.push(["Animation", pseudoSentence(el)])
  if (el.cssSource) rows.push(["CSS", `${el.cssSource.file}${el.cssSource.line ? ":" + el.cssSource.line : ""}`])
  if (el.classes && el.classes.length) rows.push(["Classes", el.classes.join(" ")])
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
  draft = { el: desc, t, clip }
  openNote = null
  card.innerHTML = `${meta(t, draft.el)}<textarea rows="3" placeholder="What should change here?"></textarea>
    <div class="note-actions"><button data-note-a="cancel">Cancel</button><button data-note-a="save" class="primary">Add note</button></div>`
  card.hidden = false
  placeCard(anchorOf(draft.el))
  const ta = card.querySelector("textarea")
  setTimeout(() => ta.focus())
  // Enter saves and folds the note down to its pin; Shift+Enter is a new line.
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      saveDraft()
    }
    if (e.key === "Escape") closeCard()
  })
}

function saveDraft() {
  const text = card.querySelector("textarea").value.trim()
  if (draft && text) D.notes.push({ id: newNoteId(), t: draft.t, branchId: D.activeId, text, el: draft.el, clip: draft.clip, status: "pending", replies: [] })
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
  card.innerHTML = `${meta(n.t, n.el, n.branchId)}<p class="note-text">${esc(n.text)}</p>
    ${n.clip ? `<div class="note-clip">${esc(shortClip(n.clip))}</div>` : ""}
    ${details(n.el)}
    ${replies ? `<div class="replies">${replies}</div>` : ""}
    <div class="note-actions"><span class="status s-${esc(status)}">${esc(status[0].toUpperCase() + status.slice(1))}</span>
      <button data-note-a="delete" class="quiet">Delete</button>
      <button data-note-a="resolve">${status === "resolved" ? "Reopen" : "Resolve"}</button>
      <button data-note-a="copy" class="primary">Copy for Claude</button></div>`
  if (keepOpen) card.querySelector(".details").open = true
  card.hidden = false
  placeCard(anchorOf(n.el))
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
}

// Returns true when the click was one of ours.
function handleNoteClick(b) {
  const act = b.dataset.noteA
  if (act === "save") saveDraft()
  if (act === "cancel") closeCard()
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
  else if (D.PT && D.last && Math.abs(shownTime(D.last) - n.t) > 5) {
    if (D.last.previewing) D.PT.endPreview()
    D.PT.seek(n.t)
  }
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
  for (const t of document.querySelectorAll('[data-tool="select"], [data-tool="comment"]')) {
    t.disabled = !isStill()
    t.classList.toggle("disabled", !isStill())
  }
  const tool = mode() || "hand"
  for (const t of document.querySelectorAll("[data-tool]")) {
    t.classList.toggle("on", t.dataset.tool === tool)
    t.setAttribute("aria-selected", String(t.dataset.tool === tool))
  }

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

  // Numbered pins on the notes of the branch in view.
  let doc = null
  try {
    doc = D.frame.contentDocument
  } catch {}
  const f = D.frame.getBoundingClientRect()
  const seen = new Set()
  D.notes.forEach((n, i) => {
    if (n.branchId !== D.activeId || !doc || s.seeking) return
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
  renderList()
  $('[data-a="notes"] .n').textContent = String(D.notes.filter((n) => n.branchId === D.activeId).length)
  for (const [id, pin] of pinEls) {
    if (seen.has(id)) continue
    pin.remove()
    pinEls.delete(id)
  }
}

// ---- the notes list: this timeline's notes, compact ------------------------------------

const list = $("#wb-list")
// With no notes on this timeline, the button just says 0.
function toggleList() {
  if (!list.hidden) return closeList()
  if (!D.notes.some((n) => n.branchId === D.activeId)) return
  list.hidden = false
  renderList()
}
function closeList() {
  list.hidden = true
  $('[data-a="notes"]').classList.remove("on")
}
let listKey = ""
function renderList() {
  if (list.hidden) return (listKey = "")
  const key = D.activeId + JSON.stringify(D.notes.map((n) => [n.id, n.status, n.text, n.branchId]))
  if (key === listKey) return
  listKey = key
  $('[data-a="notes"]').classList.add("on")
  const start = D.last ? D.last.start : 0
  const mine = D.notes.map((n, i) => ({ n, i })).filter(({ n }) => n.branchId === D.activeId)
  list.innerHTML = mine.length
    ? mine
        .map(
          ({ n, i }) =>
            `<button class="list-row" data-note="${n.id}"><span class="num" style="background:${NOTE_FILL[n.status] || NOTE_FILL.pending}">${i + 1}</span><span class="t">${fmt(n.t - start)}</span><span class="txt">${esc(n.text)}</span><span class="st">${esc(n.status || "pending")}</span></button>`,
        )
        .join("")
    : ""
  const r = $('[data-a="notes"]').getBoundingClientRect()
  list.style.left = Math.min(r.left, innerWidth - 340) + "px"
  list.style.top = r.top - list.offsetHeight - 8 + "px"
}
