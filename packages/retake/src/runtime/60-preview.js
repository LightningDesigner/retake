// Live preview: show any earlier moment instantly, without replaying. The DOM
// changes (from a MutationObserver) and every animation's timing are logged as
// they happen; previewing t undoes the DOM changes made after t and puts each
// animation at its currentTime for t. A scope element limits all of it to one
// component. Leaving the preview redoes everything back to the live page.

let previewing = false
const domLog = [] // { t, kind, node, ... }
let domAt = 0 // how many domLog entries are applied to the page right now
const animLog = [] // { anim, target, keyframes, timing, rate, vStart, vEnd, clone }
const animEntry = new WeakMap()
let observer = null

function logAnim(a, s, created) {
  if (previewing || animEntry.has(a) || !a.effect || !a.effect.target) return
  const rate = rateOf(a) || 1
  let keyframes = []
  try {
    keyframes = a.effect.getKeyframes()
  } catch {}
  const e = { anim: a, target: a.effect.target, keyframes, timing: a.effect.getTiming(), rate, vStart: clock.now - s.t / rate, vEnd: null, clone: null }
  // From when it's on the page: made right now (element.animate()), or, for a
  // CSS transition or animation (seen only at the frame boundary after its
  // cause), from just after the boundary before (input there lands just after
  // its own boundary; until it starts, it's in its delay/"before" phase).
  e.after = created ? clock.now : frameBefore(clock.now)
  e.strict = !created
  animLog.push(e)
  animEntry.set(a, e)
  recordClip(e)
}

// The last recorded frame boundary before x (-Infinity: none).
function frameBefore(x) {
  const fr = (rec && rec.frames) || []
  let lo = 0
  let hi = fr.length
  while (lo < hi) {
    const m = (lo + hi) >> 1
    if (fr[m] < x) lo = m + 1
    else hi = m
  }
  return lo ? fr[lo - 1] : -Infinity
}

// Was this animation on the page at t?
const thereAt = (e, t) => t >= e.vStart || (e.strict ? t > e.after : t >= e.after)

function endAnim(a) {
  const e = animEntry.get(a)
  if (e && e.vEnd == null) {
    e.vEnd = clock.now
    endClip(e)
  }
}

// ---- DOM log --------------------------------------------------------------------

// Input recorded at a frame boundary B happens just after B (a rebuild to
// exactly B stops short of it), so what it changes is logged just after B as
// well (inputAt, 30-recorder.js): a preview of exactly B shows the page before
// it, like the rebuild.
const INPUT_EPS = 0.001
const logTime = () => (clock.now === inputAt ? clock.now + INPUT_EPS : clock.now)

function logMutations(records) {
  if (records.length) appRan = true // style may have changed: look for new animations
  const t = logTime()
  for (let i = 0; i < records.length; i++) {
    const r = records[i]
    const later = (pred) => records.slice(i + 1).find(pred)
    if (r.type === "attributes" && r.attributeName === HOVER_ATTR) continue // our :hover stand-in
    if (r.type === "attributes") {
      const next = later((x) => x.type === "attributes" && x.target === r.target && x.attributeName === r.attributeName)
      domLog.push({ t, kind: "attr", node: r.target, name: r.attributeName, old: r.oldValue, now: next ? next.oldValue : r.target.getAttribute(r.attributeName) })
    } else if (r.type === "characterData") {
      const next = later((x) => x.type === "characterData" && x.target === r.target)
      domLog.push({ t, kind: "text", node: r.target, old: r.oldValue, now: next ? next.oldValue : r.target.data })
    } else {
      domLog.push({ t, kind: "list", node: r.target, added: [...r.addedNodes], removed: [...r.removedNodes], next: r.nextSibling })
      for (const n of r.addedNodes) if (n.nodeType === 1) findSmil(n)
      // A subtree taken off the page can still change: Astro's ClientRouter
      // swaps the body, then React empties the old body's islands. Those
      // changes are logged too, or a preview putting the old body back shows
      // them empty. (One record per change even where registrations overlap.)
      for (const n of r.removedNodes) {
        if (n.nodeType !== 1 || !n.firstChild || n.isConnected) continue
        offPage.add(n)
        observer.observe(n, OBSERVE)
      }
    }
  }
  domAt = domLog.length
}

const OBSERVE = { subtree: true, childList: true, attributes: true, attributeOldValue: true, characterData: true, characterDataOldValue: true }
const offPage = new Set() // subtrees taken off the page, still watched (the log keeps them anyway)
function observe() {
  observer = observer || new MutationObserver(logMutations)
  observer.observe(document, OBSERVE)
  // (A preview disconnects the observer; back on, the subtrees still off the page.)
  for (const n of offPage) n.isConnected ? offPage.delete(n) : observer.observe(n, OBSERVE)
  // Where the page was scrolled when this document's log starts.
  const se = document.scrollingElement
  if (se && !scrollLog.has("d")) logScroll("d", se, se.scrollTop, se.scrollLeft)
}

function applyEntry(e, forward) {
  try {
    if (e.kind === "attr") {
      const v = forward ? e.now : e.old
      v == null ? e.node.removeAttribute(e.name) : e.node.setAttribute(e.name, v)
    } else if (e.kind === "text") {
      e.node.data = forward ? e.now : e.old
    } else if (e.kind === "value") {
      setField(e.node, forward ? e.now : e.old)
    } else {
      const out = forward ? e.removed : e.added
      const into = forward ? e.added : e.removed
      for (const n of out) if (n.parentNode === e.node) e.node.removeChild(n)
      const ref = e.next && e.next.parentNode === e.node ? e.next : null
      for (const n of into) e.node.insertBefore(n, ref)
    }
  } catch {}
}

const inScope = (node, scope) => !scope || scope === node || scope.contains(node)

function moveDom(t, scope) {
  let k = domLog.length
  while (k > 0 && domLog[k - 1].t > t) k--
  while (domAt > k) {
    const e = domLog[--domAt]
    if (inScope(e.node, scope)) applyEntry(e, false)
  }
  while (domAt < k) {
    const e = domLog[domAt++]
    if (inScope(e.node, scope)) applyEntry(e, true)
  }
}

// ---- form fields ------------------------------------------------------------------
// A field's value and a box's checked state are properties, not markup: the
// MutationObserver never sees them. Typing (input/change events, live or
// replayed) and the app setting them are logged as "value" entries in the DOM
// log, so a preview before the user typed shows the field as it was then.
const fieldSeen = new WeakMap() // field -> { value, checked } as last logged
const fieldNative = new Map() // prototype -> { value, checked, ... }: the setters we wrapped
const isField = (el) => !!el && (el.tagName === "INPUT" ? el.type !== "file" : el.tagName === "TEXTAREA" || el.tagName === "SELECT")
const fieldOf = (el) => ({ value: el.value, checked: !!el.checked })

function setField(el, v) {
  const own = fieldNative.get(Object.getPrototypeOf(el)) || {}
  try {
    if (el.value !== v.value) (own.value || nativeSetter(el, "value")).call(el, v.value)
    if (el.type === "checkbox" || el.type === "radio") (own.checked || nativeSetter(el, "checked")).call(el, v.checked)
  } catch {}
}

function fieldChanged(el, old) {
  const now = fieldOf(el)
  fieldSeen.set(el, now)
  if (!observer || previewing || (old.value === now.value && old.checked === now.checked)) return
  // DOM changes made before this one come first in the log.
  logMutations(observer.takeRecords())
  domLog.push({ t: logTime(), kind: "value", node: el, old, now })
  domAt = domLog.length
}

// The app setting a field (React's controlled inputs included: React wraps
// whatever setter the prototype has when it first sees the field).
for (const [C, props] of [
  [W.HTMLInputElement, ["value", "checked"]],
  [W.HTMLTextAreaElement, ["value"]],
  [W.HTMLSelectElement, ["value", "selectedIndex"]],
]) {
  const proto = C && C.prototype
  if (!proto) continue
  const own = {}
  for (const p of props) {
    const d = Object.getOwnPropertyDescriptor(proto, p)
    if (!d || !d.set || !d.configurable) continue
    own[p] = d.set
    Object.defineProperty(proto, p, {
      ...d,
      set(v) {
        if (!observer || previewing || !isField(this)) return d.set.call(this, v)
        const old = fieldOf(this)
        d.set.call(this, v)
        fieldChanged(this, old)
      },
    })
  }
  fieldNative.set(proto, own)
}

// The user (or a replay of them) changing one. Its value before: as seen when
// they got to it (focus, a press, a key); else what a click on a box changed.
const seeField = (e) => isField(e.target) && !fieldSeen.has(e.target) && fieldSeen.set(e.target, fieldOf(e.target))
for (const type of ["focusin", "pointerdown", "mousedown", "keydown", "beforeinput"]) W.addEventListener(type, seeField, true)
for (const type of ["input", "change"])
  W.addEventListener(
    type,
    (e) => {
      const el = e.target
      if (!isField(el)) return
      const box = el.type === "checkbox" || el.type === "radio"
      fieldChanged(el, fieldSeen.get(el) || { value: box ? el.value : el.defaultValue, checked: box ? el.type === "checkbox" && !el.checked : !!el.checked })
      // Checking a radio unchecks the one before it, with no event of its own.
      if (el.type === "radio" && el.checked && el.name) {
        for (const r of (el.form || el.getRootNode()).querySelectorAll(`input[type=radio]`)) {
          const seen = r !== el && r.name === el.name && fieldSeen.get(r)
          if (seen && seen.checked && !r.checked) fieldChanged(r, seen)
        }
      }
    },
    true,
  )

// ---- animations at t --------------------------------------------------------------

function placeAnimations(t, scope) {
  // Anything the undo/redo itself started (restarted CSS animations,
  // transitions) is noise: the log already knows what was running.
  for (const a of document.getAnimations()) {
    if (!animEntry.has(a) && !isClone(a)) orig.cancel.call(a)
  }
  for (const e of animLog) {
    if (!inScope(e.target, scope)) {
      unpark(e.anim)
      continue
    }
    const time = (t - e.vStart) * e.rate
    const there = thereAt(e, t)
    const live = stateOf(e.anim) !== "idle"
    if (live) {
      // One that only started after t isn't there yet. Paused at a negative
      // time it would still show its start value (CSS transitions fill
      // backwards), over the one really running then (a later transition of
      // the same property wins): its effect comes off the page meanwhile.
      if (!there) {
        park(e.anim)
        continue
      }
      unpark(e.anim)
      orig.pause.call(e.anim)
      orig.currentTime.set.call(e.anim, time)
      continue
    }
    const alive = there && (e.vEnd == null || t < e.vEnd)
    if (alive && !e.clone && e.target.isConnected) {
      e.clone = orig.animate.call(e.target, e.keyframes, { ...e.timing })
      orig.pause.call(e.clone)
    }
    if (e.clone && !alive) {
      orig.cancel.call(e.clone)
      e.clone = null
    }
    if (e.clone) orig.currentTime.set.call(e.clone, time)
  }
}

const isClone = (a) => animLog.some((e) => e.clone === a)

// Animations whose effect is off the page for the preview, with the element
// it goes back on (the target of their effect).
const parked = new Map()
function park(a) {
  const fx = a.effect
  if (parked.has(a) || !fx || !fx.target) return
  parked.set(a, fx.target)
  try {
    fx.target = null
  } catch {
    parked.delete(a)
  }
}
function unpark(a) {
  if (!parked.has(a)) return
  const target = parked.get(a)
  parked.delete(a)
  try {
    a.effect.target = target
  } catch {}
}
function unparkAll() {
  for (const a of [...parked.keys()]) unpark(a)
}

// ---- entering and leaving -----------------------------------------------------------

// ---- scroll at t ------------------------------------------------------------------------
// Each scroller the recording moved goes where it was at t, except the ones
// the user has scrolled to look while paused (their view stays). Leaving the
// preview puts the rest back.
const liveScroll = new Map() // key -> { top, left } before the preview moved it
const shownScroll = new Map() // key -> { top, left } the preview last put it at

function placeScroll(t, scope) {
  for (const [key, L] of scrollLog) {
    if (viewScrolled.has(key)) continue
    const el = scrollerOf(L)
    if (!el || (scope && !scope.contains(el))) continue
    const v = scrollAt(L, t)
    const last = shownScroll.get(key)
    if (last && last.top === v.top && last.left === v.left) continue
    if (!liveScroll.has(key)) liveScroll.set(key, { top: el.scrollTop, left: el.scrollLeft, L })
    shownScroll.set(key, v)
    setOwnScroll(key, el, v.top, v.left)
  }
}

function restoreLiveScroll() {
  for (const [key, v] of liveScroll) {
    if (viewScrolled.has(key)) continue // scrolled by the user meanwhile: theirs now
    const el = scrollerOf(v.L)
    if (el) setOwnScroll(key, el, v.top, v.left)
  }
  liveScroll.clear()
  shownScroll.clear()
}

// ---- entering and leaving -----------------------------------------------------------

let previewScope = null
const liveTimes = new Map() // each live animation's state before the preview

function preview(t, scope) {
  // Only this document's past can be shown (earlier pages need a rebuild).
  t = Math.max(t, segmentAt(clock.now).t)
  // An in-place seek is running (or about to): stop it where it is and show
  // the moment once it has (previewing mid-seek would lose DOM changes the
  // replay is making).
  if (clock.seeking || seekTarget != null) {
    PT.cancelSeek()
    pendingPreview = { t, scope: scope || null }
    return
  }
  if (!previewing) {
    reclaimNative()
    logMutations(observer.takeRecords())
    observer.disconnect()
    previewing = true
    pause()
    liveTimes.clear()
    for (const [a, st] of managed) liveTimes.set(a, { t: orig.currentTime.get.call(a), done: st.done })
  }
  if (scope !== previewScope) {
    // A new scope starts from the live page.
    moveDom(Infinity, previewScope)
    restoreLiveScroll()
    previewScope = scope || null
  }
  moveDom(t, previewScope)
  setHover(hoverAt(t))
  alignMedia(t)
  placeAnimations(t, previewScope)
  syncSmil(t, previewScope)
  placeScroll(t, previewScope)
  previewAt = t
  PT.emit()
}

let previewAt = null

function endPreview() {
  pendingPreview = null
  if (!previewing) return
  unparkAll()
  moveDom(Infinity, previewScope)
  restoreLiveScroll()
  for (const e of animLog) {
    if (e.clone) orig.cancel.call(e.clone)
    e.clone = null
  }
  for (const [a, was] of liveTimes) {
    if (stateOf(a) === "idle") continue
    if (was.done) orig.finish.call(a)
    else orig.currentTime.set.call(a, was.t)
  }
  // Undo/redo restarted some CSS animations as new objects; carry on the
  // original timing in them. Anything else it started is dropped.
  for (const a of document.getAnimations()) {
    if (animEntry.has(a)) continue
    const lost =
      typeof CSSAnimation !== "undefined" &&
      a instanceof CSSAnimation &&
      animLog.find((e) => e.vEnd == null && e.target === /** @type {KeyframeEffect} */ (a.effect).target && stateOf(e.anim) === "idle" && e.anim.animationName === a.animationName)
    if (!lost) {
      orig.cancel.call(a)
      continue
    }
    managed.set(a, { t: (clock.now - lost.vStart) * lost.rate, v: clock.now, userPaused: false, done: false })
    orig.pause.call(a)
    lost.anim = a
    animEntry.set(a, lost)
  }
  previewing = false
  previewScope = null
  previewAt = null
  if (hasFuture()) setHover(hoverAt())
  else clearHover()
  alignMedia()
  observe()
  syncAnimations()
  PT.emit()
}

// ---- activity, for the timeline's marks ------------------------------------------

// When input happened (clicks and keys) and when animations were running.
let activityCache = null
function activity() {
  const key = rec.events.length + ":" + animLog.length + ":" + Math.round(clock.now / 250)
  if (activityCache && activityCache.key === key) return activityCache.value
  const inputs = []
  for (const ev of rec.events) if (ev.type === "pointerdown" || ev.type === "keydown") inputs.push(ev.t)
  const spans = []
  for (const e of animLog) {
    let end = e.vEnd
    if (end == null) {
      const total = (e.timing.delay || 0) + (Number(e.timing.duration) || 0) * (e.timing.iterations || 1)
      end = Number.isFinite(total) ? e.vStart + total / (e.rate || 1) : clock.now
    }
    spans.push([e.vStart, Math.min(end, clock.now)])
  }
  // Merge overlapping runs into bands.
  spans.sort((a, b) => a[0] - b[0])
  const bands = []
  for (const [a, b] of spans) {
    const last = bands[bands.length - 1]
    if (last && a <= last[1] + 30) last[1] = Math.max(last[1], b)
    else bands.push([a, b])
  }
  activityCache = { key, value: { inputs, bands } }
  return activityCache.value
}
