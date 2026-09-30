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
// Select and Comment only work on a still moment: paused, or dragged back.
const isStill = () => !!(D.last && D.last.started && !D.last.recording)
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

function cssPath(el) {
  const parts = []
  for (let n = el; n && n.nodeType === 1 && n.tagName !== "HTML"; n = n.parentElement) {
    if (n.id) {
      parts.unshift(`#${n.id}`)
      break
    }
    let part = n.tagName.toLowerCase()
    const cls = [...n.classList].filter((c) => /^[a-z][\w-]*$/i.test(c)).slice(0, 2)
    if (cls.length) part += "." + cls.join(".")
    const same = n.parentElement ? [...n.parentElement.children].filter((c) => c.tagName === n.tagName) : []
    if (same.length > 1) part += `:nth-of-type(${same.indexOf(n) + 1})`
    parts.unshift(part)
    if (n.tagName === "BODY") break
  }
  return parts.join(" > ")
}

function reactComponents(el) {
  const key = Object.keys(el).find((k) => k.startsWith("__reactFiber$"))
  const names = []
  for (let f = key && el[key]; f && names.length < 4; f = f.return) {
    const type = f.type
    const name = typeof type === "function" ? type.displayName || type.name : null
    if (name && !names.includes(name)) names.push(name)
  }
  return names
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
    rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    page,
  }
}

function prompt(n) {
  const b = D.branches.find((x) => x.id === n.branchId)
  const start = D.last ? D.last.start : 0
  const parent = b && D.branches.find((x) => x.id === b.parentId)
  const lines = [
    `## Prototype note (${fmt(n.t - start)}, on timeline "${b ? b.name : "Main"}")`,
    parent ? `Timeline "${b.name}" branched from "${parent.name}" at ${fmt(b.forkAt - start)}. Make the change for this timeline.` : null,
    `Page: ${n.el.page}`,
    `Element: ${n.el.label}${n.el.text ? ` "${n.el.text}"` : ""}`,
    `Selector: ${n.el.selector}`,
  ]
  if (n.el.components.length) lines.push(`React: ${n.el.components.join(" < ")}`)
  lines.push(`Size: ${n.el.rect.w}×${n.el.rect.h} at (${n.el.rect.x}, ${n.el.rect.y})`, "", n.text)
  return lines.filter((l) => l != null).join("\n")
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
  draft = { el: describe(el), t }
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
  if (draft && text) D.notes.push({ id: newNoteId(), t: draft.t, branchId: D.activeId, text, el: draft.el, status: "pending", replies: [] })
  closeCard()
  // Back to the Hand so the next click is on the prototype, not another note.
  setPicking(null)
}

function showNote(n) {
  openNote = n
  draft = null
  card.innerHTML = `${meta(n.t, n.el, n.branchId)}<p class="note-text">${esc(n.text)}</p>
    <div class="note-actions"><button data-note-a="delete">Delete</button><button data-note-a="copy" class="primary">Copy for Claude</button></div>`
  card.hidden = false
  placeCard(n.el.rect)
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
    pin.style.left = f.left + r.right - 10 + "px"
    pin.style.top = f.top + r.top - 10 + "px"
    seen.add(n.id)
  })
  for (const [id, pin] of pinEls) {
    if (seen.has(id)) continue
    pin.remove()
    pinEls.delete(id)
  }
}
