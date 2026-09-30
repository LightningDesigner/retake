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
  if (e.type === "pointermove" || e.type === "pointerover") hovered = usable(el)
  else if (e.type === "click" && usable(el)) {
    if (mode() === "select") setScope(el)
    else openComposer(el)
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

// The page itself isn't a thing to comment on.
const usable = (el) => (el && el.tagName !== "HTML" && el.tagName !== "BODY" ? el : null)

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

// Nearest components, innermost first.
function reactComponents(el) {
  const names = []
  for (let f = fiberOf(el); f && names.length < 4; f = f.return) {
    const name = componentName(f.type)
    if (name && /^[A-Z]/.test(name) && !names.includes(name)) names.push(name)
  }
  return names
}

// Where the element was written: React's debug info. React 18 and older keep
// _debugSource; React 19 keeps a stack (_debugStack) whose first app frame is
// the JSX. Lines are as the dev server serves the file, which for JSX is
// usually the source line.
function sourceOf(el) {
  for (let f = fiberOf(el), i = 0; f && i < 12; f = f.return, i++) {
    const src = f._debugSource
    if (src && src.fileName) return { file: shortPath(src.fileName), line: src.lineNumber || null }
    const stack = f._debugStack && (f._debugStack.stack || String(f._debugStack))
    if (stack) {
      for (const line of stack.split("\n").slice(1)) {
        const m = line.match(/(\S+?):(\d+):\d+\)?\s*$/)
        if (!m || /node_modules|\/\.vite\/deps\/|react-dom|react\.development|jsx-dev-runtime/.test(m[1])) continue
        return { file: shortPath(m[1].replace(/^.*?\(/, "")), line: Number(m[2]) }
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

// The computed styles an agent would ask about first. Defaults are left out.
const KEY_STYLES = ["display", "position", "width", "height", "margin", "padding", "color", "background-color", "font-size", "font-weight", "border-radius", "opacity", "transform", "transition", "animation-name", "z-index", "gap"]
const BORING = new Set(["none", "normal", "auto", "0px", "static", "visible", "rgba(0, 0, 0, 0)", "all 0s ease 0s", "0s", ""])
function keyStyles(el) {
  const out = {}
  try {
    const cs = el.ownerDocument.defaultView.getComputedStyle(el)
    for (const p of KEY_STYLES) {
      const v = cs.getPropertyValue(p)
      if (!BORING.has(v) && !(p === "opacity" && v === "1")) out[p] = v
    }
  } catch {}
  return out
}

function describe(el) {
  const tag = el.tagName.toLowerCase()
  const id = el.id ? `#${el.id}` : ""
  const cls = [...el.classList].slice(0, 2).map((c) => `.${c}`).join("")
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

// What was moving on the element (or the nearest thing that was) at t.
function clipFor(t, selector) {
  const hit = clipAt(t, selector) || clipAt(t)
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

function placeCard(rect) {
  const f = D.frame.getBoundingClientRect()
  const x = Math.min(Math.max(8, f.left + rect.x), innerWidth - 308)
  let y = f.top + rect.y + rect.h + 10
  if (y + 170 > dock.getBoundingClientRect().top) y = Math.max(8, f.top + rect.y - 180)
  card.style.left = x + "px"
  card.style.top = y + "px"
}

function meta(t, el, branchId = D.activeId) {
  const start = D.last ? D.last.start : 0
  const b = D.branches.find((x) => x.id === branchId)
  return `<div class="note-meta"><span class="tl">${esc(b ? b.name : "")}</span><span>·</span><span>${fmt(t - start)}</span><span>·</span><span class="el">${esc(el.label)}</span></div>`
}

function openComposer(el) {
  const s = D.last
  if (!D.PT || !s || !isStill()) return
  const t = s.previewing ? s.previewAt : s.now
  const desc = describe(el)
  draft = { el: desc, t, clip: clipFor(t, desc.selector) }
  openNote = null
  card.innerHTML = `${meta(t, draft.el)}<textarea rows="3" placeholder="What should change here?"></textarea>
    <div class="note-actions"><button data-note-a="cancel">Cancel</button><button data-note-a="save" class="primary">Add note</button></div>`
  card.hidden = false
  placeCard(draft.el.rect)
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
  openNote = n
  draft = null
  const replies = (n.replies || [])
    .map((r) => `<div class="reply ${r.from === "agent" ? "agent" : "user"}"><span class="who">${r.from === "agent" ? "Agent" : "You"}</span>${esc(r.text)}</div>`)
    .join("")
  const status = n.status || "pending"
  card.innerHTML = `${meta(n.t, n.el, n.branchId)}<p class="note-text">${esc(n.text)}</p>
    ${n.clip ? `<div class="note-clip">${esc(clipPhrase(n.clip))}</div>` : ""}
    ${replies ? `<div class="replies">${replies}</div>` : ""}
    <div class="note-actions"><span class="status s-${esc(status)}">${esc(status)}</span>
      <button data-note-a="delete">Delete</button>
      <button data-note-a="resolve">${status === "resolved" ? "Reopen" : "Resolve"}</button>
      <button data-note-a="copy" class="primary">Copy for Claude</button></div>`
  card.hidden = false
  placeCard(n.el.rect)
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
  if (b.dataset.note) {
    const n = D.notes.find((x) => String(x.id) === b.dataset.note)
    if (!n) return true
    // From the timeline or the list, go to the note's moment too.
    if (!b.classList.contains("canvas-pin")) {
      if (n.branchId !== D.activeId) switchTo(n.branchId, n.t)
      else if (D.PT && Math.abs((D.last.previewing ? D.last.previewAt : D.last.now) - n.t) > 5) D.PT.seek(n.t)
    }
    showNote(n)
  }
  return !!(act || b.dataset.note)
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

  const target = mode() && hovered && hovered.isConnected ? hovered : null
  hl.style.display = target ? "block" : "none"
  if (target) {
    boxAt(target, hl)
    hl.className = mode() === "select" ? "select" : ""
    hl.dataset.label = describe(target).label
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
    let r = null
    try {
      const el = doc.querySelector(n.el.selector)
      if (el) r = el.getBoundingClientRect()
    } catch {}
    if (!r) r = { right: n.el.rect.x + n.el.rect.w, top: n.el.rect.y }
    let pin = pinEls.get(n.id)
    if (!pin) {
      pin = document.createElement("button")
      pin.className = "canvas-pin"
      pin.dataset.note = n.id
      $("#wb-pins").appendChild(pin)
      pinEls.set(n.id, pin)
    }
    pin.textContent = String(i + 1)
    pin.style.background = NOTE_FILL[n.status] || NOTE_FILL.pending
    pin.title = n.text
    pin.style.left = f.left + r.right - 10 + "px"
    pin.style.top = f.top + r.top - 10 + "px"
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
function toggleList() {
  if (!list.hidden) return closeList()
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
    : `<div class="list-empty">No notes on this timeline. Go back in time, then hold ⌘ and click anything.</div>`
  const r = $('[data-a="notes"]').getBoundingClientRect()
  list.style.left = Math.min(r.left, innerWidth - 340) + "px"
  list.style.top = r.top - list.offsetHeight - 8 + "px"
}
