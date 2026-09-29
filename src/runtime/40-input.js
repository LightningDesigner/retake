// Captures real input into the recording and re-dispatches it during replay.
// Targets are stored as child-index paths from <html>; replay reproduces the
// same DOM, so the same path finds the same element.

const POINTER = ["pointerdown", "pointerup", "pointermove", "pointerover", "pointerout", "pointerenter", "pointerleave", "pointercancel"]
const MOUSE = ["mousedown", "mouseup", "mouseover", "mouseout", "mouseenter", "mouseleave", "click", "dblclick", "contextmenu", "auxclick"]
const KEYS = ["keydown", "keyup"]
const OTHER = ["input", "change", "focusin", "focusout", "scroll"]
const HOVER = new Set(["pointermove", "pointerover", "pointerout", "pointerenter", "pointerleave", "mouseover", "mouseout", "mouseenter", "mouseleave"])
const FORKING = new Set(["pointerdown", "keydown", "wheel", "touchstart"])

let dispatching = 0

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

function serialize(e) {
  const ev = { type: e.type, path: pathOf(e.target), bubbles: e.bubbles, cancelable: e.cancelable, composed: e.composed }
  if (e instanceof MouseEvent) {
    for (const k of ["clientX", "clientY", "screenX", "screenY", "button", "buttons", "detail", "ctrlKey", "shiftKey", "altKey", "metaKey"]) ev[k] = e[k]
    if (e.relatedTarget) ev.related = pathOf(e.relatedTarget)
  }
  if (e instanceof PointerEvent) {
    for (const k of ["pointerId", "pointerType", "isPrimary", "width", "height", "pressure"]) ev[k] = e[k]
  }
  if (e instanceof KeyboardEvent) {
    ev.active = e.target === document.activeElement
    for (const k of ["key", "code", "location", "repeat", "ctrlKey", "shiftKey", "altKey", "metaKey"]) ev[k] = e[k]
  }
  if (e.type === "input" || e.type === "change") {
    const el = e.target
    ev.value = el.isContentEditable ? el.innerHTML : el.value
    ev.inputType = e.inputType
    ev.data = e.data
    if (typeof el.selectionStart === "number") ev.sel = [el.selectionStart, el.selectionEnd]
  }
  if (e.type === "scroll") {
    const el = e.target === document ? document.scrollingElement : e.target
    ev.path = e.target === document ? "d" : ev.path
    ev.top = el.scrollTop
    ev.left = el.scrollLeft
  }
  return ev
}

function onInput(e) {
  if (!e.isTrusted || dispatching || !rec) return
  if ((e.type === "keydown" || e.type === "keyup") && PT.shortcut && PT.shortcut(e)) return
  if (clock.seeking) {
    // Input during a rewind would land at the wrong moment; drop it.
    e.stopImmediatePropagation()
    if (e.cancelable) e.preventDefault()
    return
  }
  if (FORKING.has(e.type)) {
    fork()
    if (!clock.playing) PT.play()
  }
  if (hasFuture()) {
    // The real mouse wandering over the page mustn't disturb the replay.
    if (HOVER.has(e.type)) e.stopImmediatePropagation()
    return
  }
  if (e.type === "wheel" || e.type === "touchstart") return
  const ev = serialize(e)
  if (ev.path) {
    trace("input", ev.type)
    recordEvent(ev)
  }
}

for (const type of [...POINTER, ...MOUSE, ...KEYS, ...OTHER, "wheel", "touchstart"]) {
  W.addEventListener(type, onInput, { capture: true, passive: false })
}

const setters = new Map()
function nativeValueSetter(el) {
  const proto = Object.getPrototypeOf(el)
  if (!setters.has(proto)) {
    let p = proto
    let desc = null
    while (p && !(desc = Object.getOwnPropertyDescriptor(p, "value"))) p = Object.getPrototypeOf(p)
    setters.set(proto, desc && desc.set)
  }
  return setters.get(proto)
}

// Keys go to whatever has focus now; pointers fall back to what's under the
// recorded coordinates if the DOM has shifted.
function findTarget(ev) {
  if (ev.active) return document.activeElement || document.body
  const byPath = resolvePath(ev.path)
  if (byPath) return byPath
  if (ev.clientX == null || HOVER.has(ev.type)) return null
  return document.elementFromPoint(ev.clientX, ev.clientY)
}

function dispatchRecorded(ev) {
  if (ev.type === "fetch") return deliverFetch(ev.i)
  if (ev.type === "async") return settleAsync(ev)
  const target = findTarget(ev)
  if (!target) return console.warn("[wayback] replay target missing", ev.type, ev.path)
  trace("input", ev.type)
  dispatching++
  try {
    replayOne(ev, target)
  } finally {
    dispatching--
  }
}

function replayOne(ev, target) {
  const init = { ...ev, view: W }
  if (ev.related) init.relatedTarget = resolvePath(ev.related)
  switch (true) {
    case ev.type === "scroll": {
      const el = target === document ? document.scrollingElement : target
      el.scrollTop = ev.top
      el.scrollLeft = ev.left
      return
    }
    case ev.type === "focusin":
      return target.focus && target.focus({ preventScroll: true })
    case ev.type === "focusout":
      return document.activeElement === target && target.blur()
    case ev.type === "input" || ev.type === "change": {
      if (target.isContentEditable) target.innerHTML = ev.value
      else if (ev.value != null) nativeValueSetter(target).call(target, ev.value)
      if (ev.sel && target.setSelectionRange) {
        try {
          target.setSelectionRange(ev.sel[0], ev.sel[1])
        } catch {}
      }
      const E = ev.type === "input" ? InputEvent : Event
      return target.dispatchEvent(new E(ev.type, init))
    }
    case POINTER.includes(ev.type):
      return target.dispatchEvent(new PointerEvent(ev.type, init))
    case MOUSE.includes(ev.type):
      return target.dispatchEvent(new MouseEvent(ev.type, init))
    case KEYS.includes(ev.type):
      return target.dispatchEvent(new KeyboardEvent(ev.type, init))
  }
}
