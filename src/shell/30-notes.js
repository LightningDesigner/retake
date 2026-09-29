// Notes: pick any element in the prototype, at any moment, and write a note on
// it. Hold ⌘ (or toggle the comment button) and the element under the pointer
// highlights, down to the innermost child. Each note remembers the time, the
// timeline branch and what the element is, shows as a numbered pin on the
// prototype and on the timeline, and copies as a ready-to-paste prompt.

let commentMode = false // toggled by the button
let metaHeld = false // held ⌘
let commenting = false // either of the above
let lastPointer = null
let hovered = null
let notes = [] // { id, t, branchId, text, el }
let noteSeq = 0
let draft = null // { el, t } while the composer is open
let openNote = null
let panelKey = ""
let pinsKey = ""
let hlFor = null
const hl = $("#wb-hl")
const card = $("#wb-note")
const panel = $("#wb-notes")

window.__waybackShell.inspecting = false
window.__waybackShell.inspect = (e) => {
  if (e.type === "pointermove" || e.type === "pointerover") {
    hovered = e.target.nodeType === 1 ? e.target : null
  } else if (e.type === "click" && e.target.nodeType === 1) {
    openComposer(e.target)
  } else if (e.type === "keydown" && e.key === "Escape") {
    setCommenting(false)
  }
}
window.__waybackShell.pointer = (x, y) => (lastPointer = { x, y })
window.__waybackShell.meta = (down) => {
  if (metaHeld === down) return
  metaHeld = down
  syncPicking()
}

function setCommenting(on) {
  commentMode = on
  if (!on) closeCard()
  syncPicking()
}

function syncPicking() {
  commenting = commentMode || metaHeld
  window.__waybackShell.inspecting = commenting
  hovered = null
  try {
    const doc = frame.contentDocument
    doc.documentElement.style.cursor = commenting ? "crosshair" : ""
    // Highlight straight away when ⌘ goes down over the prototype.
    if (commenting && lastPointer) hovered = doc.elementFromPoint(lastPointer.x, lastPointer.y)
  } catch {}
}

// ---- describing an element ----------------------------------------------------

function cssPath(el) {
  const parts = []
  for (let n = el; n && n.nodeType === 1 && n.tagName !== "HTML"; n = n.parentElement) {
    if (n.id) {
      parts.unshift(`#${n.id}`)
      break
    }
    const test = n.getAttribute("data-testid")
    if (test) {
      parts.unshift(`[data-testid="${test}"]`)
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
  const cls = [...el.classList].slice(0, 3).map((c) => `.${c}`).join("")
  const text = (el.innerText || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 80)
  const r = el.getBoundingClientRect()
  return {
    label: `<${tag}${id}${cls}>`,
    text,
    selector: cssPath(el),
    components: reactComponents(el),
    rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    page: (() => {
      const u = new URL(frame.contentWindow.location.href)
      u.searchParams.delete("__wb")
      return u.pathname + u.search
    })(),
  }
}

function prompt(n) {
  const b = branches.find((x) => x.id === n.branchId)
  const lines = [
    `## Prototype note (${fmt(n.t - (last ? last.start : 0))}, ${b ? b.name : "timeline"})`,
    `Page: ${n.el.page}`,
    `Element: ${n.el.label}${n.el.text ? ` "${n.el.text}"` : ""}`,
    `Selector: ${n.el.selector}`,
  ]
  if (n.el.components.length) lines.push(`React: ${n.el.components.join(" < ")}`)
  lines.push(`Size: ${n.el.rect.w}×${n.el.rect.h} at (${n.el.rect.x}, ${n.el.rect.y})`, "", n.text)
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

// ---- composer and note card -----------------------------------------------------

function placeCard(anchor) {
  const f = frame.getBoundingClientRect()
  const w = 320
  const x = Math.min(Math.max(8, f.left + anchor.x), innerWidth - w - 8)
  let y = f.top + anchor.y + anchor.h + 10
  if (y + 220 > dock.getBoundingClientRect().top) y = Math.max(8, f.top + anchor.y - 230)
  card.style.left = x + "px"
  card.style.top = y + "px"
}

function openComposer(el) {
  const s = PT && PT.state()
  if (!s) return
  // A note belongs to one moment: freeze time while writing it.
  PT.pause()
  draft = { el: describe(el), t: s.now }
  openNote = null
  card.innerHTML = `
    <div class="note-head"><span class="dot"></span>${fmt(draft.t - s.start)} · ${esc(activeBranch().name)}</div>
    <div class="note-el mono">${esc(draft.el.label)}${draft.el.text ? ` <em>“${esc(draft.el.text.slice(0, 40))}”</em>` : ""}</div>
    <textarea placeholder="What should change here?" rows="3"></textarea>
    <div class="note-actions"><span class="hint">⌘↵ to save</span><button data-note-a="cancel">Cancel</button><button data-note-a="save" class="primary">Add note</button></div>`
  card.hidden = false
  placeCard(draft.el.rect)
  const ta = card.querySelector("textarea")
  ta.focus()
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) saveDraft()
    if (e.key === "Escape") closeCard()
  })
}

function saveDraft() {
  const text = card.querySelector("textarea").value.trim()
  if (!draft || !text) return closeCard()
  notes.push({ id: ++noteSeq, t: draft.t, branchId: activeId, text, el: draft.el })
  closeCard()
}

function showNote(n, anchor) {
  openNote = n
  draft = null
  const b = branches.find((x) => x.id === n.branchId)
  const start = last ? last.start : 0
  card.innerHTML = `
    <div class="note-head"><span class="dot"></span>${fmt(n.t - start)} · ${esc(b ? b.name : "")}</div>
    <div class="note-el mono">${esc(n.el.label)}${n.el.text ? ` <em>“${esc(n.el.text.slice(0, 40))}”</em>` : ""}</div>
    <p class="note-text">${esc(n.text)}</p>
    <div class="note-actions"><button data-note-a="delete">Delete</button><button data-note-a="copy" class="primary">Copy for Claude</button></div>`
  card.hidden = false
  placeCard(anchor)
}

function closeCard() {
  card.hidden = true
  draft = null
  openNote = null
}

function toggleNotesPanel() {
  panel.hidden = !panel.hidden
  panelKey = ""
  if (!panel.hidden) renderNotesPanel()
}

function renderNotesPanel() {
  const start = last ? last.start : 0
  panel.innerHTML = notes.length
    ? `<div class="panel-head"><span>Notes</span><button data-note-a="copy-all">Copy all</button></div>` +
      notes
        .map((n) => {
          const b = branches.find((x) => x.id === n.branchId)
          return `<button class="panel-row" data-note="${n.id}"><span class="mono">${fmt(n.t - start)}</span><span class="txt">${esc(n.text)}</span><span class="br">${esc(b ? b.name : "")}</span></button>`
        })
        .join("")
    : `<div class="panel-empty">No notes yet. Press the comment button, then click anything in the prototype.</div>`
}

// Returns true when the click was one of ours.
function handleExtraClick(b) {
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
    // Pins on the timeline also take you to the note's moment.
    if (!b.classList.contains("canvas-pin")) {
      if (n.branchId !== activeId) switchTo(n.branchId, n.t)
      else if (PT) PT.seek(n.t)
    }
    showNote(n, n.el.rect)
  }
  return !!(act || b.dataset.note)
}

// ---- drawing --------------------------------------------------------------------

// Numbered pins on the prototype itself, on the notes of the branch in view.
const canvasPins = $("#wb-pins")
const pinEls = new Map()
function renderCanvasPins(s) {
  const f = frame.getBoundingClientRect()
  let doc = null
  try {
    doc = frame.contentDocument
  } catch {}
  const visible = new Set()
  notes.forEach((n, i) => {
    if (n.branchId !== activeId || !PT || s.seeking || !doc) return
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
      canvasPins.appendChild(pin)
      pinEls.set(n.id, pin)
    }
    pin.textContent = String(i + 1)
    pin.title = n.text
    pin.style.left = f.left + r.right - 10 + "px"
    pin.style.top = f.top + r.top - 10 + "px"
    visible.add(n.id)
  })
  for (const [id, pin] of pinEls) {
    if (visible.has(id)) continue
    pin.remove()
    pinEls.delete(id)
  }
}

function renderExtras(s, rows, width) {
  renderCanvasPins(s)
  renderLoop(s)
  $('[data-a="comment"]').classList.toggle("on", commenting)
  const count = $('[data-a="notes"] b')
  count.textContent = String(notes.length)
  // Re-render lists only when they change, so clicks land on stable buttons.
  const listKey = notes.map((n) => n.id + n.branchId).join() + branches.map((b) => b.name).join() + s.start
  if (!panel.hidden && listKey !== panelKey) {
    panelKey = listKey
    renderNotesPanel()
  }

  // Highlight whatever the pointer is over while picking.
  const target = commenting ? hovered : null
  hl.style.display = target && target.isConnected ? "block" : "none"
  if (target && target.isConnected) {
    const f = frame.getBoundingClientRect()
    const r = target.getBoundingClientRect()
    Object.assign(hl.style, { left: f.left + r.left + "px", top: f.top + r.top + "px", width: r.width + "px", height: r.height + "px" })
    if (hlFor !== target) {
      hlFor = target
      hl.dataset.label = describe(target).label
    }
  }

  // Note pins on their branch's lane.
  const pinKey = notes.map((n) => `${n.id}:${n.branchId}:${n.t}`).join() + JSON.stringify([...rows]) + width + range(s).dur
  if (pinKey === pinsKey) return
  pinsKey = pinKey
  $(".pins").innerHTML = notes
    .filter((n) => rows.has(n.branchId) && n.t >= s.start)
    .map((n) => {
      const r = rows.get(n.branchId)
      return `<button class="pin" data-note="${n.id}" title="${esc(n.text)}" style="left:${frac(s, n.t) * width}px;top:${r.top - 5}px"></button>`
    })
    .join("")
}
