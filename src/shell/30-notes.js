// Picking elements in the prototype. Two tools share it:
//  - Comment (or hold ⌘): click an element, down to the innermost child, and
//    write a note. Notes keep their moment and branch, show as numbered pins on
//    the prototype and tags on the timeline, and copy as a prompt.
//  - Select: pick one component; scrubbing then rewinds only that component.

let picking = null // "comment" | "select" | null (button tools)
let metaHeld = false
let hovered = null
let lastPointer = null
let scopeEl = null
let notes = [] // { id, t, branchId, text, el }
let noteSeq = 0
let draft = null
let openNote = null
const hl = $("#wb-hl")
const scopeBox = $("#wb-scope")
const card = $("#wb-note")
const panel = $("#wb-notes")
const mode = () => (metaHeld ? "comment" : picking)

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
shell.pointer = (x, y, meta) => {
  lastPointer = { x, y }
  if (meta !== undefined && meta !== metaHeld) shell.meta(meta)
}
shell.meta = (down) => {
  if (metaHeld === down) return
  metaHeld = down
  syncPicking()
}

// The page itself isn't a thing to comment on.
const usable = (el) => (el && el.tagName !== "HTML" && el.tagName !== "BODY" ? el : null)

// Leaving the Select tool lets go of the selected component.
function setPicking(m) {
  if (m !== "select") setScope(null)
  picking = m
  syncPicking()
}

function syncPicking() {
  shell.inspecting = !!mode()
  hovered = null
  try {
    const doc = frame.contentDocument
    doc.documentElement.style.cursor = mode() ? "crosshair" : ""
    if (mode() && lastPointer) hovered = usable(doc.elementFromPoint(lastPointer.x, lastPointer.y))
  } catch {}
}

// Selecting the same component again clears it.
function setScope(el) {
  scopeEl = el && el === scopeEl ? null : el
  if (PT && last && last.previewing) PT.preview(last.previewAt, scopeEl)
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
    const u = new URL(frame.contentWindow.location.href)
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
  const b = branches.find((x) => x.id === n.branchId)
  const start = last ? last.start : 0
  const parent = b && branches.find((x) => x.id === b.parentId)
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

// ---- the note card -----------------------------------------------------------------

function placeCard(rect) {
  const f = frame.getBoundingClientRect()
  const x = Math.min(Math.max(8, f.left + rect.x), innerWidth - 308)
  let y = f.top + rect.y + rect.h + 10
  if (y + 170 > dock.getBoundingClientRect().top) y = Math.max(8, f.top + rect.y - 180)
  card.style.left = x + "px"
  card.style.top = y + "px"
}

function meta(t, el, branchId = activeId) {
  const start = last ? last.start : 0
  const b = branches.find((x) => x.id === branchId)
  return `<div class="note-meta"><span class="tl">${esc(b ? b.name : "")}</span><span>·</span><span>${fmt(t - start)}</span><span>·</span><span class="el">${esc(el.label)}</span></div>`
}

function openComposer(el) {
  const s = last
  if (!PT || !s) return
  if (!s.started) PT.record()
  // A note belongs to one moment: freeze time while writing it.
  PT.pause()
  const t = s.previewing ? s.previewAt : s.now
  draft = { el: describe(el), t }
  openNote = null
  card.innerHTML = `${meta(t, draft.el)}<textarea rows="3" placeholder="What should change here?"></textarea>
    <div class="note-actions"><button data-note-a="cancel">Cancel</button><button data-note-a="save" class="primary">Add note</button></div>`
  card.hidden = false
  placeCard(draft.el.rect)
  const ta = card.querySelector("textarea")
  setTimeout(() => ta.focus())
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) saveDraft()
    if (e.key === "Escape") closeCard()
  })
}

function saveDraft() {
  const text = card.querySelector("textarea").value.trim()
  if (draft && text) notes.push({ id: ++noteSeq, t: draft.t, branchId: activeId, text, el: draft.el })
  closeCard()
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

function toggleNotesPanel() {
  panel.hidden = !panel.hidden
  if (panel.hidden) return
  const start = last ? last.start : 0
  panel.innerHTML = notes.length
    ? `<div class="panel-head"><span>Notes</span><button data-note-a="copy-all">Copy all</button></div>` +
      notes.map((n) => `<button class="panel-row" data-note="${n.id}"><span class="t">${fmt(n.t - start)}</span><span class="txt">${esc(n.text)}</span></button>`).join("")
    : `<div class="panel-empty">No notes yet. Hold ⌘ and click anything in the prototype.</div>`
}

// Returns true when the click was one of ours.
function handleNoteClick(b) {
  const act = b.dataset.noteA
  if (act === "save") saveDraft()
  if (act === "cancel") closeCard()
  if (act === "copy" && openNote) copy(prompt(openNote), b)
  if (act === "copy-all") copy(notes.map(prompt).join("\n\n---\n\n"), b)
  if (act === "delete" && openNote) {
    notes = notes.filter((n) => n !== openNote)
    closeCard()
  }
  if (b.dataset.note) {
    const n = notes.find((x) => x.id === Number(b.dataset.note))
    if (!n) return true
    panel.hidden = true
    // From the timeline or the list, go to the note's moment too.
    if (!b.classList.contains("canvas-pin")) {
      if (n.branchId !== activeId) switchTo(n.branchId, n.t)
      else if (PT && Math.abs((last.previewing ? last.previewAt : last.now) - n.t) > 5) PT.seek(n.t)
    }
    showNote(n)
  }
  return !!(act || b.dataset.note)
}

// ---- drawing on the prototype --------------------------------------------------------

const pinEls = new Map()
const boxAt = (el, box) => {
  const f = frame.getBoundingClientRect()
  const r = el.getBoundingClientRect()
  Object.assign(box.style, { display: "block", left: f.left + r.left + "px", top: f.top + r.top + "px", width: r.width + "px", height: r.height + "px" })
}

function renderExtras(s) {
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
  if (scopeEl && scopeEl.isConnected) boxAt(scopeEl, scopeBox)
  else scopeBox.style.display = "none"

  // Numbered pins on the notes of the branch in view.
  let doc = null
  try {
    doc = frame.contentDocument
  } catch {}
  const f = frame.getBoundingClientRect()
  const seen = new Set()
  notes.forEach((n, i) => {
    if (n.branchId !== activeId || !doc || s.seeking) return
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
