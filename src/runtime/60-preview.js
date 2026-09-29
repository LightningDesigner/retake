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

function logAnim(a, s) {
  if (previewing || animEntry.has(a) || !a.effect || !a.effect.target) return
  const rate = rateOf(a) || 1
  let keyframes = []
  try {
    keyframes = a.effect.getKeyframes()
  } catch {}
  const e = { anim: a, target: a.effect.target, keyframes, timing: a.effect.getTiming(), rate, vStart: clock.now - s.t / rate, vEnd: null, clone: null }
  animLog.push(e)
  animEntry.set(a, e)
}

function endAnim(a) {
  const e = animEntry.get(a)
  if (e && e.vEnd == null) e.vEnd = clock.now
}

// ---- DOM log --------------------------------------------------------------------

function logMutations(records) {
  for (let i = 0; i < records.length; i++) {
    const r = records[i]
    const later = (pred) => records.slice(i + 1).find(pred)
    if (r.type === "attributes") {
      const next = later((x) => x.type === "attributes" && x.target === r.target && x.attributeName === r.attributeName)
      domLog.push({ t: clock.now, kind: "attr", node: r.target, name: r.attributeName, old: r.oldValue, now: next ? next.oldValue : r.target.getAttribute(r.attributeName) })
    } else if (r.type === "characterData") {
      const next = later((x) => x.type === "characterData" && x.target === r.target)
      domLog.push({ t: clock.now, kind: "text", node: r.target, old: r.oldValue, now: next ? next.oldValue : r.target.data })
    } else {
      domLog.push({ t: clock.now, kind: "list", node: r.target, added: [...r.addedNodes], removed: [...r.removedNodes], next: r.nextSibling })
    }
  }
  domAt = domLog.length
}

function observe() {
  observer = observer || new MutationObserver(logMutations)
  observer.observe(document, { subtree: true, childList: true, attributes: true, attributeOldValue: true, characterData: true, characterDataOldValue: true })
}

function applyEntry(e, forward) {
  try {
    if (e.kind === "attr") {
      const v = forward ? e.now : e.old
      v == null ? e.node.removeAttribute(e.name) : e.node.setAttribute(e.name, v)
    } else if (e.kind === "text") {
      e.node.data = forward ? e.now : e.old
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

// ---- animations at t --------------------------------------------------------------

function placeAnimations(t, scope) {
  // Anything the undo/redo itself started (restarted CSS animations,
  // transitions) is noise: the log already knows what was running.
  for (const a of document.getAnimations()) {
    if (!animEntry.has(a) && !isClone(a)) orig.cancel.call(a)
  }
  for (const e of animLog) {
    if (!inScope(e.target, scope)) continue
    const time = (t - e.vStart) * e.rate
    const live = stateOf(e.anim) !== "idle"
    if (live) {
      orig.pause.call(e.anim)
      orig.currentTime.set.call(e.anim, time)
      continue
    }
    const alive = e.vStart <= t && (e.vEnd == null || t < e.vEnd)
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

// ---- entering and leaving -----------------------------------------------------------

let previewScope = null
const liveTimes = new Map() // each live animation's state before the preview

function preview(t, scope) {
  if (!previewing) {
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
    previewScope = scope || null
  }
  moveDom(t, previewScope)
  placeAnimations(t, previewScope)
  previewAt = t
  PT.emit()
}

let previewAt = null

function endPreview() {
  if (!previewing) return
  moveDom(Infinity, previewScope)
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
      animLog.find((e) => e.vEnd == null && e.target === a.effect.target && stateOf(e.anim) === "idle" && e.anim.animationName === a.animationName)
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
  observe()
  syncAnimations()
  PT.emit()
}
