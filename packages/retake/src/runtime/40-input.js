// Captures real input into the recording and re-dispatches it during replay.
// Targets are stored as child-index paths from <html>; replay reproduces the
// same DOM, so the same path finds the same element.
//
// Events are stored compactly: fields at their usual value are left out and
// filled back in on replay (see DEFAULTS).

const POINTER = ["pointerdown", "pointerup", "pointermove", "pointerover", "pointerout", "pointerenter", "pointerleave", "pointercancel"]
const MOUSE = ["mousedown", "mouseup", "mousemove", "mouseover", "mouseout", "mouseenter", "mouseleave", "click", "dblclick", "contextmenu", "auxclick"]
const KEYS = ["keydown", "keyup", "keypress"]
const TOUCH = ["touchstart", "touchmove", "touchend", "touchcancel"]
const DRAG = ["dragstart", "drag", "dragenter", "dragover", "dragleave", "drop", "dragend"]
const CLIP = ["paste", "copy", "cut"]
const COMPOSE = ["compositionstart", "compositionupdate", "compositionend"]
const OTHER = ["input", "beforeinput", "change", "focusin", "focusout", "focus", "blur", "scroll", "wheel", "submit"]
const HOVER = new Set(["pointermove", "pointerover", "pointerout", "pointerenter", "pointerleave", "mousemove", "mouseover", "mouseout", "mouseenter", "mouseleave"])
// Acting on a paused app at the live edge resumes recording (CONTRACT.md).
// Input that "acts" (used to wake a scoped preview into a real rebuild).
const RESUMES = new Set(["pointerdown", "mousedown", "keydown", "touchstart", "input", "beforeinput", "change", "paste", "cut", "drop", "compositionstart", "submit"])
const SCROLL_KEYS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageUp", "PageDown", "Home", "End", " "])

let dispatching = 0
let missingTargets = 0
let lastScreenOffset = null // recording
let replayScreenOffset = [0, 0] // replay

// True from an input event until the current task ends (a message on a
// private channel clears it at the start of the next task).
let inputTask = false
const taskChannel = new RealChannel()
taskChannel.port1.onmessage = () => (inputTask = false)
function markInputTask() {
  if (inputTask) return
  inputTask = true
  portPost.call(taskChannel.port2, 0)
}

// Virtual focus: while rebuilding, the frame being built doesn't have real
// focus (the visible frame or the dock does), so the browser keeps moving
// focus away from what the recording focused. The recording's own focus is
// tracked here: keys go to it, and document.activeElement reports it.
let vFocus = null
const realActive = Object.getOwnPropertyDescriptor(Document.prototype, "activeElement").get
const focused = () => (vFocus && vFocus.isConnected ? vFocus : null)
Object.defineProperty(document, "activeElement", {
  configurable: true,
  get() {
    return (clock.seeking && focused()) || realActive.call(document)
  },
})

function pathOf(node) {
  if (node === W) return "w"
  if (node === document) return "d"
  const path = []
  while (node && node !== document.documentElement) {
    const parent = node.parentNode
    if (!parent || parent.nodeType !== 1) return null
    path.unshift(Array.prototype.indexOf.call(parent.childNodes, node))
    node = parent
  }
  return node ? path : null
}

function resolvePath(path) {
  if (path === "w") return W
  if (path === "d") return document
  let node = document.documentElement
  for (const i of path || []) {
    node = node && node.childNodes[i]
  }
  return node || null
}

// Usual values, left out of the recording.
const DEFAULTS = {
  bubbles: true,
  cancelable: true,
  composed: true,
  pointerId: 1,
  pointerType: "mouse",
  isPrimary: true,
  width: 1,
  height: 1,
}
const NUMS = ["clientX", "clientY", "screenX", "screenY", "button", "buttons", "detail", "movementX", "movementY", "pressure", "location", "keyCode", "which", "charCode", "deltaX", "deltaY", "deltaZ", "deltaMode"]
const BOOLS = ["ctrlKey", "shiftKey", "altKey", "metaKey", "repeat", "isComposing"]

function put(ev, k, v) {
  if (v === undefined || v === null) return
  if (k in DEFAULTS) {
    if (v !== DEFAULTS[k]) ev[k] = v
  } else if (typeof v === "number") {
    if (v !== 0) ev[k] = v
  } else if (typeof v === "boolean") {
    if (v) ev[k] = v
  } else if (v !== "") ev[k] = v
}

function touchList(list) {
  return [...(list || [])].map((t) => ({ id: t.identifier, x: t.clientX, y: t.clientY, sx: t.screenX, sy: t.screenY, path: pathOf(t.target) }))
}

function transferData(dt) {
  if (!dt) return undefined
  const out = {}
  try {
    for (const type of dt.types || []) if (type !== "Files") out[type] = dt.getData(type)
  } catch {}
  return Object.keys(out).length ? out : undefined
}

function serialize(e) {
  const ev = { type: e.type, path: pathOf(e.target) }
  for (const k of ["bubbles", "cancelable", "composed"]) put(ev, k, e[k])
  if (e instanceof MouseEvent) {
    for (const k of ["clientX", "clientY", "buttons", "detail", "movementX", "movementY"]) put(ev, k, e[k])
    // button: -1 is usual for moves, 0 otherwise
    if (e.button !== (/move|over|out|enter|leave/.test(e.type) ? -1 : 0)) ev.button = e.button
    // screen = client + the window's offset, stored only when it changes
    const so = [e.screenX - e.clientX, e.screenY - e.clientY]
    if (!lastScreenOffset || lastScreenOffset[0] !== so[0] || lastScreenOffset[1] !== so[1]) ev.so = lastScreenOffset = so
    if (e.relatedTarget) ev.related = pathOf(e.relatedTarget)
  }
  if (e instanceof PointerEvent) for (const k of ["pointerId", "pointerType", "isPrimary", "width", "height", "pressure"]) put(ev, k, e[k])
  if (typeof WheelEvent !== "undefined" && e instanceof WheelEvent) for (const k of ["deltaX", "deltaY", "deltaZ", "deltaMode"]) put(ev, k, e[k])
  if (e instanceof MouseEvent || e instanceof KeyboardEvent || (typeof TouchEvent !== "undefined" && e instanceof TouchEvent)) for (const k of BOOLS) put(ev, k, e[k])
  if (e instanceof KeyboardEvent) {
    if (e.target === document.activeElement) ev.active = true
    for (const k of ["key", "code"]) put(ev, k, e[k])
    for (const k of ["location", "keyCode", "which", "charCode"]) put(ev, k, e[k])
  }
  if (typeof TouchEvent !== "undefined" && e instanceof TouchEvent) {
    ev.touches = touchList(e.touches)
    ev.targetTouches = touchList(e.targetTouches)
    ev.changedTouches = touchList(e.changedTouches)
  }
  if (typeof DragEvent !== "undefined" && e instanceof DragEvent) ev.dt = transferData(e.dataTransfer)
  if (typeof ClipboardEvent !== "undefined" && e instanceof ClipboardEvent) ev.dt = transferData(e.clipboardData)
  if (typeof CompositionEvent !== "undefined" && e instanceof CompositionEvent) put(ev, "data", e.data)
  if (e.type === "beforeinput") {
    put(ev, "inputType", e.inputType)
    put(ev, "data", e.data)
  }
  if (e.type === "input" || e.type === "change") {
    const el = e.target
    ev.value = el.isContentEditable ? el.innerHTML : el.value
    put(ev, "inputType", e.inputType)
    put(ev, "data", e.data)
    if (el.type === "checkbox" || el.type === "radio") ev.checked = !!el.checked
    try {
      if (typeof el.selectionStart === "number") ev.range = [el.selectionStart, el.selectionEnd]
    } catch {}
  }
  if (e.type === "submit") {
    if (e.submitter) ev.submitter = pathOf(e.submitter)
    // Submitted by a click we recorded (a button, or Enter's implicit click)?
    // Then replaying that click submits it; don't submit twice.
    const last = rec.events[rec.events.length - 1]
    ev.viaClick = !!(last && last.type === "click" && last.t === clock.now)
  }
  // For the dock's markers: what was acted on, readably.
  if (e.type === "focusin" && isEditable(e.target)) {
    ev.css = selectorOf(e.target)
    ev.label = labelOf(e.target)
    ev.editable = 1
  }
  if (e.type === "click" || e.type === "keydown" || e.type === "input" || e.type === "change" || e.type === "submit") {
    const el = e.target && e.target.nodeType === 1 ? e.target : null
    if (el) {
      ev.css = selectorOf(el)
      ev.label = e.type === "keydown" ? e.key : labelOf(el)
      if (e.type === "keydown") ev.inField = !!(el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))
    }
  }
  if (e.type === "scroll") {
    const el = e.target === document ? document.scrollingElement : e.target
    ev.path = e.target === document ? "d" : ev.path
    ev.top = el.scrollTop
    ev.left = el.scrollLeft
  }
  return ev
}

// ---- view-only input and scrolling while paused ----------------------------------
// Scroll positions as the recording has them (live recording and replay), and
// the elements the user scrolled just to look while paused. Those go back to
// the recorded position when playback resumes or on a seek.
const scrollRec = new Map() // path key -> { top, left }
const viewScrolled = new Map() // path key -> path
const restoredScroll = new Map() // path key -> { top, left } just set by restoreScroll
const keyOf = (path) => (Array.isArray(path) ? path.join(",") : String(path))

function noteScroll(ev) {
  scrollRec.set(keyOf(ev.path), { top: ev.top, left: ev.left })
}

function scrollElOf(path) {
  if (path === "d") return document.scrollingElement
  const n = resolvePath(path)
  return n && n.nodeType === 1 ? n : null
}

function restoreScroll() {
  for (const [key, path] of viewScrolled) {
    const el = scrollElOf(path)
    if (!el) continue
    const r = scrollRec.get(key) || { top: 0, left: 0 }
    if (el.scrollTop !== r.top || el.scrollLeft !== r.left) {
      restoredScroll.set(key, r)
      el.scrollTop = r.top
      el.scrollLeft = r.left
    }
  }
  viewScrolled.clear()
}

// The scroll event that restoreScroll itself causes isn't the user's.
function ignoreRestoredScroll(e) {
  const path = e.target === document ? "d" : pathOf(e.target)
  const key = keyOf(path)
  const r = restoredScroll.get(key)
  if (!r) return false
  restoredScroll.delete(key)
  const el = scrollElOf(path)
  return !!el && el.scrollTop === r.top && el.scrollLeft === r.left
}

function isEditable(el) {
  return !!el && el.nodeType === 1 && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))
}

function viewOnly(e) {
  if (e.type === "scroll") {
    // Looking around: the browser scrolls, the app doesn't hear of it, and
    // it isn't part of the recording.
    const path = e.target === document ? "d" : pathOf(e.target)
    if (path) viewScrolled.set(keyOf(path), path)
    e.stopImmediatePropagation()
    return
  }
  if (e.type === "wheel" || e.type === "touchstart" || e.type === "touchmove" || e.type === "touchend") {
    e.stopImmediatePropagation() // default (scrolling) still happens
    return
  }
  if (e.type === "keydown" || e.type === "keyup" || e.type === "keypress") {
    // The dock drives space/arrows/F/+ while focus is in the app.
    let handled = false
    if (e.type === "keydown" && shell && typeof shell.key === "function") {
      try {
        handled = !!shell.key(e)
      } catch {}
    }
    if (!handled && SCROLL_KEYS.has(e.key) && !isEditable(e.target)) {
      e.stopImmediatePropagation() // keyboard scrolling still works
      return
    }
    return block(e)
  }
  return block(e)
}

function block(e) {
  e.stopImmediatePropagation()
  if (e.cancelable && e.type !== "scroll") e.preventDefault()
}

function onInput(e) {
  if (!e.isTrusted || dispatching || !rec) return
  // Holding ⌘ is the dock's "pick an element" gesture, never app input.
  // (The dock may still be wiring these up while the prototype boots.)
  if (shell && shell.meta && e.key === "Meta") return shell.meta(e.type === "keydown")
  if (shell && shell.pointer && e.type === "pointermove") shell.pointer(e.clientX, e.clientY, e.metaKey)
  // A click in the prototype folds away an open note, like a click anywhere else.
  if (shell && shell.appPointerDown && e.type === "pointerdown" && !shell.inspecting) shell.appPointerDown()
  // Comment mode: the dock is picking an element. The app sees nothing.
  if (shell && shell.inspecting) {
    shell.inspect(e)
    e.stopImmediatePropagation()
    if (e.cancelable && e.type !== "scroll" && e.type !== "input") e.preventDefault()
    return
  }
  // A dock tool (comment/select) is on: the app sees nothing.
  if (toolActive) return block(e)
  if ((e.type === "keydown" || e.type === "keyup") && PT.shortcut && PT.shortcut(e)) return
  // Input during a rewind would land at the wrong moment; drop it.
  if (clock.seeking) return block(e)
  // While a past moment is on show (or being rebuilt), the page is a picture.
  if (previewing || (shell && shell.rebuilding)) {
    block(e)
    if (previewing && RESUMES.has(e.type) && shell && shell.wake) shell.wake()
    return
  }
  // Paused, or in the past (rewound, or playing the recorded future back):
  // the app is view-only, like a paused video. Nothing it gets reaches it or
  // moves time, except that you can scroll around to look (CONTRACT.md).
  // Only Play starts the clock.
  if (!clock.playing || hasFuture()) return viewOnly(e)
  // A mousemove right after the pointermove it mirrors is one event.
  // (It may come after the pointerover/out events the same move fired.)
  if (e.type === "mousemove") {
    for (let i = rec.events.length - 1, n = 0; i >= 0 && n < 8; i--, n++) {
      const ev = rec.events[i]
      if (ev.t !== clock.now) break
      if (ev.type === "pointermove") {
        if (Math.abs((ev.clientX || 0) - e.clientX) < 1 && Math.abs((ev.clientY || 0) - e.clientY) < 1 && !ev.mm) {
          ev.mm = 1
          return
        }
        break
      }
    }
  }
  // mouseover/mouseout mirror the pointerover/pointerout just before them:
  // folded in the same way (replayed right after their pointer twin).
  if (e.type === "mouseover" || e.type === "mouseout") {
    const twin = e.type === "mouseover" ? "pointerover" : "pointerout"
    const path = pathOf(e.target)
    for (let i = rec.events.length - 1, n = 0; i >= 0 && n < 6; i--, n++) {
      const ev = rec.events[i]
      if (ev.t !== clock.now) break
      if (ev.type === twin) {
        if (!ev.mo && ev.path + "" === path + "") {
          ev.mo = 1
          return
        }
        break
      }
    }
  }
  // Wheel ticks within one frame add up to one event.
  if (e.type === "wheel") {
    const last = rec.events[rec.events.length - 1]
    if (last && last.type === "wheel" && last.t === clock.now && last.path + "" === pathOf(e.target) + "") {
      last.deltaX = (last.deltaX || 0) + e.deltaX
      last.deltaY = (last.deltaY || 0) + e.deltaY
      return
    }
  }
  if (e.type === "focus" || e.type === "blur") return // focusin/focusout carry these
  if (e.type === "focusin") vFocus = e.target
  if (e.type === "focusout" && vFocus === e.target) vFocus = null
  if (e.type === "scroll" && ignoreRestoredScroll(e)) return
  appRan = true // the app is handling input: it may start animations
  const ev = serialize(e)
  if (ev.type === "scroll" && ev.path) noteScroll(ev)
  if (ev.path) {
    trace("input", ev.type)
    const before = rec.events.length
    // Fired by the browser in the same task as the previous input event?
    if (inputTask && before && rec.events[before - 1].t === clock.now) ev.g = 1
    recordEvent(ev)
    markInputTask()
  }
}

for (const type of [...POINTER, ...MOUSE, ...KEYS, ...TOUCH, ...DRAG, ...CLIP, ...COMPOSE, ...OTHER]) {
  W.addEventListener(type, onInput, { capture: true, passive: false })
}

// Back/forward (and hash changes) are navigation the app reacts to; they're
// recorded as one "nav" event with where the page ended up.
let lastNav = null
function onNav(e) {
  if (!e.isTrusted || dispatching || !rec || hasFuture() || clock.seeking) return
  const url = location.href
  if (lastNav && lastNav.t === clock.now && lastNav.url === url) {
    if (e.type === "hashchange") lastNav.hash = 1
    return
  }
  let state = null
  try {
    state = JSON.parse(JSON.stringify(history.state))
  } catch {}
  const ev = { type: "nav", path: "w", url, state }
  if (e.type === "hashchange") ev.hash = 1
  recordEvent(ev)
  lastNav = ev
}
W.addEventListener("popstate", onNav, true)
W.addEventListener("hashchange", onNav, true)

const setters = new Map()
function nativeSetter(el, prop) {
  const proto = Object.getPrototypeOf(el)
  const key = proto
  if (!setters.has(key)) setters.set(key, {})
  const cache = setters.get(key)
  if (!(prop in cache)) {
    let p = proto
    let desc = null
    while (p && !(desc = Object.getOwnPropertyDescriptor(p, prop))) p = Object.getPrototypeOf(p)
    cache[prop] = desc && desc.set
  }
  return cache[prop]
}

// Keys go to whatever has focus now; pointers fall back to what's under the
// recorded coordinates if the DOM has shifted.
function findTarget(ev) {
  if (ev.active) {
    const f = focused()
    if (f) return f
    const a = realActive.call(document)
    if (a && a !== document.body) return a
    // Focus got lost altogether: fall back to what the key was pressed in.
    if (ev.css) {
      try {
        const el = document.querySelector(ev.css)
        if (el) return el
      } catch {}
    }
    return a || document.body
  }
  const byPath = resolvePath(ev.path)
  if (byPath) return byPath
  if (ev.clientX == null || HOVER.has(ev.type)) return null
  return document.elementFromPoint(ev.clientX, ev.clientY)
}

function dispatchRecorded(ev) {
  if (ev.type === "net") return deliverNet(ev)
  if (ev.type === "fetch") return deliverNet({ list: "fetches", i: ev.i }) // older recordings
  if (ev.type === "async") return settleAsync(ev)
  if (ev.type === "obs") return deliverObserved(ev)
  if (ev.type === "worker") return deliverWorker(ev)
  if (ev.type === "ready") return deliverReady(ev)
  const target = findTarget(ev)
  if (!target) {
    // The DOM came out different (code changed?). Say so a few times, not 10,000.
    if (++missingTargets <= 3) console.warn("[retake] replay target missing", ev.type, ev.path, missingTargets === 3 ? "(further ones not shown)" : "")
    return
  }
  trace("input", ev.type)
  dispatching++
  try {
    replayOne(ev, target)
  } finally {
    dispatching--
  }
}

function makeTransfer(data) {
  const dt = new DataTransfer()
  for (const [type, value] of Object.entries(data || {})) {
    try {
      dt.setData(type, value)
    } catch {}
  }
  return dt
}

function makeTouches(list) {
  return (list || []).map((t) => {
    try {
      const target = resolvePath(t.path) || document.body
      return new Touch({ identifier: t.id, target, clientX: t.x, clientY: t.y, screenX: t.sx, screenY: t.sy, pageX: t.x + scrollX, pageY: t.y + scrollY })
    } catch {
      return null
    }
  }).filter(Boolean)
}

// Legacy key fields can't go through the KeyboardEvent constructor.
function withLegacyKeys(event, ev) {
  for (const k of ["keyCode", "which", "charCode"]) {
    const v = ev[k] || 0
    try {
      Object.defineProperty(event, k, { get: () => v })
    } catch {}
  }
  return event
}

function replayOne(ev, target) {
  if (ev.type.startsWith("pointer") || ev.type.startsWith("mouse")) replayHover(ev, target)
  const init = { ...DEFAULTS, ...ev, view: W }
  if (ev.so) replayScreenOffset = ev.so
  if (ev.clientX != null || ev.so) {
    if (init.screenX == null) init.screenX = (ev.clientX || 0) + replayScreenOffset[0]
    if (init.screenY == null) init.screenY = (ev.clientY || 0) + replayScreenOffset[1]
  }
  if (init.button == null && /move|over|out|enter|leave/.test(ev.type)) init.button = -1
  if (ev.related) init.relatedTarget = resolvePath(ev.related)
  switch (true) {
    case ev.type === "scroll": {
      const el = target === document ? document.scrollingElement : target
      el.scrollTop = ev.top
      el.scrollLeft = ev.left
      noteScroll(ev)
      return
    }
    case ev.type === "nav": {
      const moved = location.href !== ev.url
      if (!moved) return // the replayed click already navigated there
      const oldURL = location.href
      history.replaceState(ev.state, "", ev.url)
      W.dispatchEvent(new PopStateEvent("popstate", { state: ev.state }))
      if (ev.hash) W.dispatchEvent(new HashChangeEvent("hashchange", { oldURL, newURL: ev.url }))
      return
    }
    case ev.type === "focusin":
      vFocus = target
      return target.focus && target.focus({ preventScroll: true })
    case ev.type === "focusout":
      if (vFocus === target) vFocus = null
      return realActive.call(document) === target && target.blur()
    case ev.type === "submit": {
      if (ev.viaClick) return // the replayed click submits it
      const submitter = ev.submitter ? resolvePath(ev.submitter) : null
      if (typeof target.requestSubmit === "function") {
        try {
          return submitter ? target.requestSubmit(submitter) : target.requestSubmit()
        } catch {
          return target.requestSubmit()
        }
      }
      return target.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }))
    }
    case ev.type === "input" || ev.type === "change": {
      // A checkbox or radio is toggled by the replayed click, which fires its
      // own input/change; only step in if the state didn't come out the same.
      if (target.type === "checkbox" || target.type === "radio") {
        if (!!target.checked === !!ev.checked) return
        nativeSetter(target, "checked").call(target, !!ev.checked)
      } else if (target.isContentEditable) target.innerHTML = ev.value
      else if (ev.value != null) nativeSetter(target, "value").call(target, ev.value)
      if (ev.range && target.setSelectionRange) {
        try {
          target.setSelectionRange(ev.range[0], ev.range[1])
        } catch {}
      }
      const E = ev.type === "input" ? InputEvent : Event
      return target.dispatchEvent(new E(ev.type, init))
    }
    case ev.type === "beforeinput":
      return target.dispatchEvent(new InputEvent("beforeinput", init))
    case POINTER.includes(ev.type): {
      target.dispatchEvent(new PointerEvent(ev.type, init))
      if (ev.mm) target.dispatchEvent(new MouseEvent("mousemove", init))
      if (ev.mo) target.dispatchEvent(new MouseEvent(ev.type === "pointerover" ? "mouseover" : "mouseout", init))
      return
    }
    case ev.type === "wheel":
      return target.dispatchEvent(new WheelEvent("wheel", init))
    case MOUSE.includes(ev.type):
      return target.dispatchEvent(new MouseEvent(ev.type, init))
    case KEYS.includes(ev.type):
      return target.dispatchEvent(withLegacyKeys(new KeyboardEvent(ev.type, init), ev))
    case TOUCH.includes(ev.type):
      return target.dispatchEvent(new TouchEvent(ev.type, { ...init, touches: makeTouches(ev.touches), targetTouches: makeTouches(ev.targetTouches), changedTouches: makeTouches(ev.changedTouches) }))
    case DRAG.includes(ev.type):
      return target.dispatchEvent(new DragEvent(ev.type, { ...init, dataTransfer: makeTransfer(ev.dt) }))
    case CLIP.includes(ev.type):
      return target.dispatchEvent(new ClipboardEvent(ev.type, { ...init, clipboardData: makeTransfer(ev.dt) }))
    case COMPOSE.includes(ev.type):
      return target.dispatchEvent(new CompositionEvent(ev.type, init))
  }
}
