// The driver. Time moves in "frames": at each frame boundary B, due timers run,
// the clock lands on B, rAF callbacks run, then any input recorded at B is
// re-dispatched. Recording keeps the boundaries, so a replay walks exactly the
// same frames and the app sees an identical sequence of moments.

const FF_STEP = 50 // max virtual ms between frames when skipping ahead live
let pace = 0 // where playback wants the clock to be, in virtual ms
let seekTarget = null
let afterSeek = null

const nextEventT = () => (cursor.event < rec.events.length ? rec.events[cursor.event].t : Infinity)
const futureFrame = () => (cursor.frame < rec.frames.length ? rec.frames[cursor.frame] : null)

// Input recorded at exactly a seek target happened just *after* that moment,
// so a seek stops short of it.
let timersBefore = 0
async function dispatchUpTo(B) {
  const exclusive = clock.seeking && B === seekTarget
  timersBefore = timers.size
  while (exclusive ? nextEventT() < B : nextEventT() <= B) {
    const before = domLog.length
    const ev = rec.events[cursor.event++]
    dispatchRecorded(ev)
    // Events the browser fired in one task (one mouse move: pointermove,
    // pointerover/out, mouseover/out…) go out back to back, as they did live;
    // the app gets its turn after the group.
    const next = rec.events[cursor.event]
    if (next && next.g && next.t === ev.t && !(exclusive && next.t >= B)) continue
    await settle()
    // An event that changed the DOM may have started CSS transitions, which
    // the next frame adopts; one that changed nothing leaves nothing behind.
    if (observer && !previewing) logMutations(observer.takeRecords())
    if (domLog.length !== before || timers.size !== timersBefore || rafQueue.size) appRan = true
  }
}

// Did any app code run since the last settle? While rebuilding, a boundary
// where nothing ran (no input, timer, frame callback, animation, pending
// work) has nothing to wait for, so it's skipped through. That's most frames
// of a long session, and it gives the same result as waiting.
let appRan = true
// While rebuilding, animations only need a sync when one could have started
// (app code ran) or one finishes by this frame (its end events must fire
// here); in between, their state at the target is all that matters.
function nextAnimationEnd() {
  let min = Infinity
  for (const [a, st] of managed) {
    if (st.done || st.userPaused) continue
    const end = endOf(a)
    const rate = rateOf(a) || 1
    if (!Number.isFinite(end)) continue
    const at = rate > 0 ? st.v + (end - st.t) / rate : st.v + st.t / -rate
    if (at < min) min = at
  }
  return min
}

async function processBoundary(B) {
  await dispatchUpTo(clock.now)
  let ran = 0
  for (let t = nextTimer(); t && t.due <= B && ran < 5000; t = nextTimer(), ran++) {
    clock.now = Math.max(clock.now, t.due)
    runTimer(t)
  }
  if (ran) appRan = true
  clock.now = B
  if (rafQueue.size) appRan = true
  runRaf()
  tickWorkers(B)
  while (futureFrame() != null && futureFrame() <= B) cursor.frame++
  const own0 = real.perfNow()
  recordFrame(B)
  let own = real.perfNow() - own0
  if (!clock.seeking || appRan || appMessages > 0 || idbBusy > 0 || nextAnimationEnd() <= B) {
    const s0 = real.perfNow()
    syncAnimations(appRan || clock.seeking)
    own += real.perfNow() - s0
    await settle()
    // Live, whatever the app started while settling belongs to this moment
    // too (a rebuild takes recorded starts instead).
    if (!clock.seeking && appRan) syncAnimations()
    appRan = false
  }
  await dispatchUpTo(B)
  const a0 = real.perfNow()
  sampleActivity()
  own += real.perfNow() - a0
  // The runtime's own work per recorded frame (not the app's), for the perf budget.
  if (!clock.seeking) {
    stats.ownFrames = (stats.ownFrames || 0) + 1
    stats.ownMs = (stats.ownMs || 0) + own
    if (own > (stats.ownMax || 0)) stats.ownMax = own
  }
  if (hoverChain.length && !clock.seeking && !hasFuture()) clearHover()
}

// The next frame boundary at or before `limit`, or null if time should rest.
function nextBoundary(limit, skipping) {
  const f = futureFrame()
  if (f != null) return f <= limit ? f : null
  if (limit <= clock.now) return null
  if (!skipping) return limit
  // Skipping ahead: jump straight to the next timer, but keep rAF-driven work
  // (streaming text, JS animations) ticking at least every FF_STEP.
  const timer = nextTimer()
  let B = limit
  if (rafQueue.size) B = Math.min(B, clock.now + FF_STEP)
  if (timer) B = Math.min(B, Math.max(timer.due, clock.now + 1))
  return B
}

function catchUpAll() {
  for (const [a, st] of managed) if (!st.done) catchUp(a, st)
}

// A frame being built in the background (a checkpoint) replays in idle
// slices, so the frame you're looking at stays smooth.
let background = false
const idleSlice = () => new Promise((r) => (W.requestIdleCallback && real.idle ? real.idle(r, { timeout: 200 }) : real.setTimeout(r, 0)))

async function runSeek() {
  const seekStart = real.perfNow()
  clock.seeking = true
  reclaimNative()
  syncMedia()
  PT.emit()
  let lastPaint = real.perfNow()
  let sliceStart = real.perfNow()
  while (seekTarget != null && clock.now < seekTarget) {
    if (background && real.perfNow() - sliceStart > 8) {
      await idleSlice()
      sliceStart = real.perfNow()
      if (seekTarget == null) break
    }
    const B = nextBoundary(seekTarget, true)
    if (B == null) {
      clock.now = seekTarget // rest between recorded frames, like the original did
      break
    }
    await processBoundary(B)
    if (!background && real.perfNow() - lastPaint > 400) {
      PT.emit()
      await new Promise((r) => real.raf(r))
      lastPaint = real.perfNow()
    }
  }
  stats.seekMs = Math.round(real.perfNow() - seekStart)
  seekTarget = null
  clock.seeking = false
  pace = clock.now
  syncAnimations()
  alignMedia()
  syncMedia()
  restoreScroll()
  if (!hasFuture()) clearHover() // live again: the real :hover takes over
  // Put real focus back where the recording had it.
  const f = focused()
  if (f && realActive.call(document) !== f) {
    try {
      f.focus({ preventScroll: true })
    } catch {}
  }
  const then = afterSeek
  afterSeek = null
  if (then) then()
  PT.emit()
}

async function drive() {
  let last = real.perfNow()
  for (;;) {
    const ts = await new Promise((r) => real.raf(r))
    // Cap the step so a backgrounded tab doesn't come back to a huge jump.
    const dt = Math.min(ts - last, 100)
    last = ts
    if (!clock.booted) continue
    try {
      if (seekTarget != null) {
        await runSeek()
      } else if (clock.playing) {
        pace = Math.max(pace, clock.now) + dt * clock.rate
        const nextSeg = hasFuture() && segmentsOf().find((sg) => sg.t > clock.now)
        if (nextSeg && pace >= nextSeg.t) {
          clock.playing = false
          rewind(nextSeg.t, true) // the recorded future reloaded here: carry on from a fresh page
          continue
        }
        for (let B = nextBoundary(pace, false); B != null; B = nextBoundary(pace, false)) {
          await processBoundary(B)
          if (seekTarget != null || !clock.playing) break
        }
      }
      syncAnimations(appRan) // new ones only if something happened since the frame
      syncMedia()
      PT.emit()
    } catch (err) {
      console.error("[wayback]", err)
    }
  }
}

// ---- controls ----------------------------------------------------------------

// Play state changes, for the dock (PT.onPlayState).
const playListeners = new Set()
function playStateChanged() {
  for (const fn of playListeners) safeCall(fn, [{ playing: clock.playing, now: clock.now }])
}

function play() {
  if (clock.playing) return
  restoreScroll() // anything scrolled just to look goes back first
  clock.playing = true
  pace = clock.now
  syncMedia()
  releaseHeld() // network arrivals held while paused at the live edge
  playStateChanged()
  PT.emit()
}

function pause() {
  const was = clock.playing
  clock.playing = false
  catchUpAll()
  reclaimNative()
  syncMedia()
  PT.emit()
  if (was) playStateChanged()
}

function setRate(rate) {
  catchUpAll()
  reclaimNative()
  clock.rate = rate
  syncMedia()
  PT.emit()
}

function seek(t, then) {
  t = Math.max(0, t)
  // Past a reload, the moment needs a fresh page: rebuild instead.
  if (t >= clock.now && segmentIndex(t) !== segmentIndex(clock.now)) return rewind(t, !!then)
  if (t >= clock.now) {
    if (clock.playing) {
      clock.playing = false
      playStateChanged()
    }
    seekTarget = t
    afterSeek = then || null
  } else {
    rewind(t, !!then)
  }
}

// Going back means rebuilding: reload the prototype frame and replay what
// happened up to t. The dock (parent window) holds the history meanwhile.
// The dock builds the moment in a fresh frame behind this one and swaps it in
// when it's ready, so going back never flashes.
// url: the page the moment's segment started on (the dock loads it; a frame
// on another URL moves there itself).
function rewind(t, playAfter, json = JSON.stringify(rec)) {
  let url
  try {
    url = segmentAt(t, readRec(json)).url
  } catch {}
  if (shell) shell.rebuild({ rec: json, target: t, play: playAfter, rate: clock.rate, url })
}
