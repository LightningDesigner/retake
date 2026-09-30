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
    dispatchRecorded(rec.events[cursor.event++])
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
const animating = () => {
  for (const st of managed.values()) if (!st.done && !st.userPaused) return true
  return false
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
  while (futureFrame() != null && futureFrame() <= B) cursor.frame++
  recordFrame(B)
  if (!clock.seeking || appRan || appMessages > 0 || idbBusy > 0 || animating()) {
    syncAnimations()
    await settle()
    appRan = false
  }
  await dispatchUpTo(B)
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

async function runSeek() {
  const seekStart = real.perfNow()
  clock.seeking = true
  quietStacks(true)
  syncMedia()
  PT.emit()
  let lastPaint = real.perfNow()
  while (seekTarget != null && clock.now < seekTarget) {
    const B = nextBoundary(seekTarget, true)
    if (B == null) {
      clock.now = seekTarget // rest between recorded frames, like the original did
      break
    }
    await processBoundary(B)
    if (real.perfNow() - lastPaint > 400) {
      PT.emit()
      await new Promise((r) => real.raf(r))
      lastPaint = real.perfNow()
    }
  }
  stats.seekMs = Math.round(real.perfNow() - seekStart)
  seekTarget = null
  clock.seeking = false
  quietStacks(false)
  pace = clock.now
  syncAnimations()
  alignMedia()
  syncMedia()
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
        for (let B = nextBoundary(pace, false); B != null; B = nextBoundary(pace, false)) {
          await processBoundary(B)
          if (seekTarget != null || !clock.playing) break
        }
      }
      syncAnimations()
      syncMedia()
      PT.emit()
    } catch (err) {
      console.error("[wayback]", err)
    }
  }
}

// ---- controls ----------------------------------------------------------------

function play() {
  if (clock.playing) return
  clock.playing = true
  pace = clock.now
  syncMedia()
  releaseHeld() // network arrivals held while paused at the live edge
  PT.emit()
}

function pause() {
  clock.playing = false
  syncMedia()
  PT.emit()
}

function setRate(rate) {
  clock.rate = rate
  syncMedia()
  PT.emit()
}

function seek(t, then) {
  t = Math.max(0, t)
  if (t >= clock.now) {
    clock.playing = false
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
function rewind(t, playAfter, json = JSON.stringify(rec)) {
  if (shell) shell.rebuild({ rec: json, target: t, play: playAfter, rate: clock.rate })
}
