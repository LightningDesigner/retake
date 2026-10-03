// Web Animations + CSS animations/transitions. Every animation is held paused
// underneath and its currentTime is driven from the virtual clock, so pausing,
// slow motion and seeking all apply. App-facing calls (play, pause, startTime…)
// are translated so libraries like motion still see a normal running animation.

const managed = new Map() // Animation -> { t, v, userPaused, done }
const AP = Animation.prototype
const orig = {
  play: AP.play,
  pause: AP.pause,
  finish: AP.finish,
  cancel: AP.cancel,
  reverse: AP.reverse,
  updatePlaybackRate: AP.updatePlaybackRate,
  currentTime: Object.getOwnPropertyDescriptor(AP, "currentTime"),
  startTime: Object.getOwnPropertyDescriptor(AP, "startTime"),
  playbackRate: Object.getOwnPropertyDescriptor(AP, "playbackRate"),
  playState: Object.getOwnPropertyDescriptor(AP, "playState"),
  animate: Element.prototype.animate,
}
const rateOf = (a) => orig.playbackRate.get.call(a)
const stateOf = (a) => orig.playState.get.call(a)
const endOf = (a) => (a.effect ? a.effect.getComputedTiming().endTime : Infinity)

// created: the app just made it (element.animate()), rather than it being
// found on a scan (a CSS transition or animation, seen a frame after its cause).
function adopt(a, created) {
  if (managed.has(a)) return managed.get(a)
  const ps = stateOf(a)
  if (ps === "idle") return null
  // A running animation seen for the first time starts from 0 at this
  // boundary, whatever real time the browser gave it before we saw it: live,
  // a CSS transition has usually run a few real ms by then, in a rebuild
  // none, and the two must agree.
  // Replaying: if the recording has this animation, it starts when it did
  // live. (Live, which frame first sees a new CSS transition races with the
  // browser's own scheduling; the recorded start settles it.)
  const recorded = ps === "running" && (hasFuture() || clock.seeking) ? recordedStart(a) : null
  const s = {
    t: recorded != null ? (clock.now - recorded) * (rateOf(a) || 1) : ps === "running" ? 0 : Number(orig.currentTime.get.call(a)) || 0,
    v: clock.now,
    userPaused: ps === "paused",
    done: ps === "finished",
    native: false,
    checks: 0,
  }
  managed.set(a, s)
  if (!s.done && !s.userPaused) orig.pause.call(a)
  // The browser drops finished animations once a later one covers them; the
  // timeline still needs them to show earlier moments.
  if (a.persist) a.persist()
  logAnim(a, s, !!created)
  return s
}

// A CSS animation paused via `animation-play-state` stays frozen.
function cssPaused(a) {
  if (typeof CSSAnimation === "undefined" || !(a instanceof CSSAnimation)) return false
  const el = a.effect && /** @type {KeyframeEffect} */ (a.effect).target
  if (!el) return false
  const cs = getComputedStyle(el)
  const names = cs.animationName.split(", ")
  const states = cs.animationPlayState.split(", ")
  const i = names.indexOf(a.animationName)
  return i >= 0 && states[i % states.length] === "paused"
}

function catchUp(a, s) {
  if (!s.done && !s.userPaused && !cssPaused(a)) s.t += (clock.now - s.v) * rateOf(a)
  s.v = clock.now
}

let syncCount = 0
// scan: look for new animations too. A new CSS animation needs a style
// change, which comes from a DOM change, input, a timer or a frame callback;
// when none of those happened, only the running ones need driving.
function syncAnimations(scan = true) {
  // While previewing another moment, the preview owns every animation.
  if (previewing) return
  syncSmil(clock.now)
  if (scan) for (const a of document.getAnimations()) adopt(a)
  // Finished animations are only checked for removal now and then; a long
  // session collects hundreds of them.
  const sweep = ++syncCount % 30 === 0
  for (const [a, s] of managed) {
    if (s.done && !sweep) continue
    if (stateOf(a) === "idle") {
      managed.delete(a)
      endAnim(a)
      continue
    }
    if (s.done) continue
    catchUp(a, s)
    const rate = rateOf(a)
    // An endless loop (a spinner, a shimmer) runs natively on the compositor
    // while recording at normal pace, lined up with the virtual clock and
    // re-lined if it drifts; the clock takes it back on pause, seek or preview.
    const endless = endOf(a) === Infinity && !s.userPaused && !cssPaused(a)
    const native = endless && clock.playing && !clock.seeking && clock.rate === 1 && !hasFuture()
    if (native) {
      if (!s.native) {
        orig.currentTime.set.call(a, s.t)
        orig.play.call(a)
        orig.currentTime.set.call(a, s.t)
        s.native = true
      } else if (++s.checks % 30 === 0 && Math.abs((Number(orig.currentTime.get.call(a)) || 0) - s.t) > 20) {
        orig.currentTime.set.call(a, s.t)
      }
      continue
    }
    if (s.native) {
      orig.pause.call(a)
      s.native = false
    }
    s.checks = 0
    if ((rate > 0 && s.t >= endOf(a)) || (rate < 0 && s.t <= 0)) {
      finishNow(a, s)
    } else {
      orig.currentTime.set.call(a, s.t)
    }
  }
}

// ---- SMIL ---------------------------------------------------------------------
// SVG's own animations (<animate>, <set>, <animateMotion>, <animateTransform>)
// aren't on the document's animation timeline: they run on their outermost
// <svg>'s clock, from when it came onto the page. Each of those clocks is held
// paused and set from the virtual one, so pausing pauses them, a rebuild lands
// them where they were, and a preview shows them at t (instead of every frame
// swapped in starting them again from 0).
const SVG_NS = "http://www.w3.org/2000/svg"
const SMIL = "animate, set, animateMotion, animateTransform"
const smilSvgs = new Set() // outermost <svg>s with SMIL animations in them, as found
const smilBegin = new WeakMap() // outermost <svg> -> the virtual ms its clock started at
const smilShown = new WeakMap() // outermost <svg> -> the clock time (s) last set
// Look for SMIL in a subtree: the document at boot, then what the app adds
// (logMutations), so nothing walks the whole page every frame.
function findSmil(root) {
  if (!root || !root.querySelectorAll || (root.nodeType === 1 && root.namespaceURI !== SVG_NS && !root.firstElementChild)) return
  let els
  try {
    els = [...root.querySelectorAll(SMIL)]
    if (root.nodeType === 1 && root.matches(SMIL)) els.push(root)
  } catch {
    return
  }
  for (const el of els) {
    if (el.namespaceURI !== SVG_NS) continue
    let svg = el.ownerSVGElement
    while (svg && svg.ownerSVGElement) svg = svg.ownerSVGElement
    if (svg) smilSvgs.add(svg)
  }
}
// Show every SMIL clock at virtual time `at` (only those inside `scope`).
// A clock seen for the first time starts at `begin`: the page's start for the
// page's own svgs (at boot), else now (one the app put in since).
function syncSmil(at, scope, begin = clock.now) {
  if (!smilSvgs.size) return
  for (const svg of smilSvgs) {
    if (!svg.isConnected || (scope && !scope.contains(svg))) continue
    let b = smilBegin.get(svg)
    if (b == null) {
      if (previewing) continue // never seen live: nothing known to show
      smilBegin.set(svg, (b = begin))
      try {
        svg.pauseAnimations()
      } catch {}
    }
    if (clock.seeking) continue // set where the seek lands
    const sec = Math.max(0, at - b) / 1000
    if (smilShown.get(svg) === sec) continue
    smilShown.set(svg, sec)
    try {
      svg.setCurrentTime(sec)
    } catch {}
  }
}

// The clock stopped or jumped: endless loops come back under its control now.
function reclaimNative() {
  for (const [a, s] of managed) {
    if (!s.native) continue
    orig.pause.call(a)
    s.native = false
    orig.currentTime.set.call(a, s.t)
  }
}

Element.prototype.animate = function (...args) {
  const a = orig.animate.apply(this, args)
  adopt(a, true)
  return a
}

AP.play = function () {
  const s = managed.get(this)
  if (!s) return orig.play.call(this)
  catchUp(this, s)
  const rate = rateOf(this)
  if (rate > 0 && (s.done || s.t >= endOf(this))) s.t = 0
  if (rate < 0 && (s.done || s.t <= 0)) s.t = endOf(this)
  s.done = false
  s.userPaused = false
  orig.play.call(this) // renews the `finished` promise
  orig.pause.call(this)
  orig.currentTime.set.call(this, s.t)
}
AP.pause = function () {
  const s = managed.get(this)
  if (!s) return orig.pause.call(this)
  catchUp(this, s)
  s.userPaused = true
}
AP.finish = function () {
  const s = managed.get(this)
  if (!s) return orig.finish.call(this)
  finishNow(this, s)
}
AP.cancel = function () {
  managed.delete(this)
  endAnim(this)
  return orig.cancel.call(this)
}
AP.reverse = function () {
  const s = managed.get(this)
  if (!s) return orig.reverse.call(this)
  catchUp(this, s)
  orig.playbackRate.set.call(this, -rateOf(this))
  s.t = Math.min(Math.max(s.t, 0), endOf(this))
  s.done = false
  s.userPaused = false
}
AP.updatePlaybackRate = function (r) {
  const s = managed.get(this)
  if (!s) return orig.updatePlaybackRate.call(this, r)
  catchUp(this, s)
  orig.playbackRate.set.call(this, r)
}

Object.defineProperty(AP, "currentTime", {
  configurable: true,
  get() {
    return orig.currentTime.get.call(this)
  },
  set(value) {
    const s = managed.get(this)
    if (s && value != null) {
      s.t = Number(value)
      s.v = clock.now
      s.done = false
    }
    orig.currentTime.set.call(this, value)
  },
})
Object.defineProperty(AP, "startTime", {
  configurable: true,
  get() {
    const s = managed.get(this)
    if (!s) return orig.startTime.get.call(this)
    catchUp(this, s)
    return clock.now + PERF_BASE - s.t / (rateOf(this) || 1)
  },
  set(value) {
    const s = managed.get(this) || adopt(this, true)
    if (!s || value == null) return orig.startTime.set.call(this, value)
    s.t = (clock.now + PERF_BASE - Number(value)) * rateOf(this)
    s.v = clock.now
    s.done = false
    s.userPaused = false
    orig.currentTime.set.call(this, s.t)
  },
})
Object.defineProperty(AP, "playbackRate", {
  configurable: true,
  get() {
    return rateOf(this)
  },
  set(value) {
    const s = managed.get(this)
    if (s) catchUp(this, s)
    orig.playbackRate.set.call(this, value)
  },
})
Object.defineProperty(AP, "playState", {
  configurable: true,
  get() {
    const s = managed.get(this)
    const ps = stateOf(this)
    if (!s || ps === "idle" || ps === "finished") return ps
    return s.userPaused ? "paused" : "running"
  },
})

// ---- deterministic end events -----------------------------------------------
// The browser delivers `finish`, `animationend` and `transitionend` on its next
// rendering step, i.e. at a real-time moment. We fire them ourselves, right when
// the virtual clock finishes the animation, and drop the browser's copies.

const finishHandlers = new WeakMap() // Animation -> { prop, listeners: Set }
const handlersOf = (a) => {
  if (!finishHandlers.has(a)) finishHandlers.set(a, { prop: null, listeners: new Set() })
  return finishHandlers.get(a)
}
Object.defineProperty(AP, "onfinish", {
  configurable: true,
  get() {
    return finishHandlers.get(this)?.prop ?? null
  },
  set(fn) {
    handlersOf(this).prop = typeof fn === "function" ? fn : null
  },
})
const animAdd = AP.addEventListener
const animRemove = AP.removeEventListener
AP.addEventListener = function (type, fn, opts) {
  if (type !== "finish" || !fn) return animAdd.call(this, type, fn, opts)
  handlersOf(this).listeners.add(fn)
}
AP.removeEventListener = function (type, fn, opts) {
  if (type !== "finish") return animRemove.call(this, type, fn, opts)
  finishHandlers.get(this)?.listeners.delete(fn)
}

let synthesizing = 0
function finishNow(a, s) {
  if (s.done) return
  s.done = true
  orig.finish.call(a)
  const h = finishHandlers.get(a)
  const ev = new AnimationPlaybackEvent("finish", { currentTime: a.currentTime, timelineTime: clock.now + PERF_BASE })
  if (h) {
    for (const fn of [h.prop, ...h.listeners]) {
      if (!fn) continue
      safeCall(typeof fn === "function" ? fn : fn.handleEvent.bind(fn), [ev])
    }
  }
  const target = a.effect && a.effect.target
  if (!target) return
  let dom = null
  if (typeof CSSAnimation !== "undefined" && a instanceof CSSAnimation) {
    dom = new AnimationEvent("animationend", { bubbles: true, animationName: a.animationName, elapsedTime: endOf(a) / 1000 })
  } else if (typeof CSSTransition !== "undefined" && a instanceof CSSTransition) {
    dom = new TransitionEvent("transitionend", { bubbles: true, propertyName: a.transitionProperty, elapsedTime: endOf(a) / 1000 })
  }
  if (!dom) return
  synthesizing++
  try {
    target.dispatchEvent(dom)
  } finally {
    synthesizing--
  }
}

for (const type of ["animationend", "transitionend"]) {
  W.addEventListener(
    type,
    (e) => {
      if (e.isTrusted && !synthesizing) e.stopImmediatePropagation()
    },
    true,
  )
}
