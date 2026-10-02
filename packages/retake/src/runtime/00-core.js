// Virtual clock. Every app-visible notion of time (timers, rAF, performance.now,
// Date) reads from `clock.now`, which only the engine advances. All runtime
// files are concatenated into one IIFE by the Vite plugin, in filename order.

const W = window
const PT = (W.__retake = { emit() {} })
const real = {
  setTimeout: W.setTimeout.bind(W),
  clearTimeout: W.clearTimeout.bind(W),
  setInterval: W.setInterval.bind(W),
  raf: W.requestAnimationFrame.bind(W),
  perfNow: performance.now.bind(performance),
  Date: W.Date,
  random: Math.random,
  fetch: W.fetch.bind(W),
  idle: W.requestIdleCallback ? W.requestIdleCallback.bind(W) : null,
  local: W.localStorage,
  session: W.sessionStorage,
}

const KEY = "retake:"
// performance.now() and rAF timestamps are offset so they never read 0 (lots of
// code treats a 0 timestamp as "unset").
const PERF_BASE = 1000
// Timers created by the dev server itself must keep real time, or HMR stalls
// whenever the clock is paused. (Turbopack's HMR client is a chunk of its own.)
const EXEMPT = /@vite\/client|@react-refresh|vite\/dist\/client|dev_hmr-client_hmr-client/
// The dev server's own traffic, by URL (RT.exemptUrls, picked by the server
// for the framework): its HMR socket, overlay and hot-update requests. A call
// stack can't always tell (Turbopack bundles Next's router and its HMR client
// together), a URL can. Exempt traffic is never recorded, held or replayed.
let exemptUrlRe = null
try {
  if (RT.exemptUrls && RT.exemptUrls.length) exemptUrlRe = new RegExp(RT.exemptUrls.join("|"))
} catch {}
function isExemptUrl(url) {
  if (!exemptUrlRe) return false
  try {
    const u = new URL(String(url), location.href)
    return exemptUrlRe.test(u.pathname + u.search)
  } catch {
    return false
  }
}

const clock = { now: 0, rate: 1, playing: false, seeking: false, booted: false }

// ---- timers ---------------------------------------------------------------

const timers = new Map()
let timerSeq = 1e9

function isExempt() {
  return EXEMPT.test(new Error().stack || "")
}

// While rebuilding, React's per-element console tasks (async stack tagging
// for devtools) are skipped. Its per-element Error stacks are NOT: notes read
// an element's source file:line from them, and notes are made in rebuilt frames.
const realCreateTask = console.createTask
if (realCreateTask) {
  const noTask = { run: (fn) => fn() }
  console.createTask = function (name) {
    return clock.seeking ? noTask : realCreateTask.call(console, name)
  }
}

function addTimer(fn, delay, args, repeat) {
  const id = timerSeq++
  const d = Math.max(repeat ? 4 : 0, Number(delay) || 0)
  timers.set(id, { id, fn, args, due: clock.now + d, delay: d, repeat })
  return id
}

function nextTimer() {
  let best = null
  for (const t of timers.values()) if (!best || t.due < best.due) best = t
  return best
}

// Debug aid: `window.__retakeTrace = []` before load collects a log of
// what ran when, to diff a recording against its replay.
const trace = (...entry) => W.__retakeTrace && W.__retakeTrace.push([clock.now, ...entry])

function runTimer(t) {
  trace("timer", t.due, String(t.fn).slice(0, 80))
  if (t.repeat) t.due += t.delay
  else timers.delete(t.id)
  safeCall(t.fn, t.args)
}

function safeCall(fn, args) {
  try {
    fn.apply(W, args)
  } catch (err) {
    // Rethrow outside our loop so the app's error overlay still sees it.
    real.setTimeout(() => {
      throw err
    })
  }
}

W.setTimeout = function (fn, delay, ...args) {
  if (typeof fn !== "function" || isExempt()) return real.setTimeout(fn, delay, ...args)
  return addTimer(fn, delay, args, false)
}
W.setInterval = function (fn, delay, ...args) {
  if (typeof fn !== "function" || isExempt()) return real.setInterval(fn, delay, ...args)
  return addTimer(fn, delay, args, true)
}
W.clearTimeout = W.clearInterval = function (id) {
  if (timers.has(id)) timers.delete(id)
  else real.clearTimeout(id)
}

// requestIdleCallback runs on the virtual clock too: "idle" is right after
// the current moment's work.
if (W.requestIdleCallback) {
  W.requestIdleCallback = function (cb, opts) {
    if (typeof cb !== "function" || isExempt()) return real.setTimeout(cb, 1)
    return addTimer(() => cb({ didTimeout: false, timeRemaining: () => 50 }), 1, [], false)
  }
  W.cancelIdleCallback = function (id) {
    W.clearTimeout(id)
  }
}

// ---- animation frames -----------------------------------------------------

let rafQueue = new Map()
let rafSeq = 1

W.requestAnimationFrame = function (cb) {
  if (W.__retakeTrace) trace("req", (new Error().stack || "").split("\n")[2])
  const id = rafSeq++
  rafQueue.set(id, cb)
  return id
}
W.cancelAnimationFrame = function (id) {
  rafQueue.delete(id)
}

function runRaf() {
  if (!rafQueue.size) return
  const queue = rafQueue
  rafQueue = new Map()
  trace("raf", queue.size)
  for (const cb of queue.values()) safeCall(cb, [clock.now + PERF_BASE])
}

// ---- performance.now / Date -----------------------------------------------

performance.now = () => clock.now + PERF_BASE
try {
  Object.defineProperty(document.timeline, "currentTime", {
    get: () => clock.now + PERF_BASE,
    configurable: true,
  })
} catch {}

let epoch = real.Date.now()
function VDate(...args) {
  if (!new.target) return new real.Date(epoch + clock.now).toString()
  return args.length ? new real.Date(...args) : new real.Date(epoch + clock.now)
}
VDate.prototype = real.Date.prototype
VDate.now = () => epoch + clock.now
VDate.parse = real.Date.parse
VDate.UTC = real.Date.UTC
W.Date = VDate

// ---- seeded randomness ----------------------------------------------------

let seed = 0
let byteState = 0
function seedRandom(s) {
  seed = s >>> 0
  byteState = (seed ^ 0x9e3779b9) >>> 0
  let state = seed
  Math.random = function () {
    state = (state + 0x6d2b79f5) >>> 0
    let x = state
    x = Math.imul(x ^ (x >>> 15), x | 1)
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61)
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
}
// crypto.getRandomValues from its own seeded stream, so ids made with it
// (nanoid, uuid v4) come out the same on replay without shifting Math.random.
function nextByteWord() {
  byteState = (byteState + 0x6d2b79f5) >>> 0
  let x = byteState
  x = Math.imul(x ^ (x >>> 15), x | 1)
  x ^= x + Math.imul(x ^ (x >>> 7), x | 61)
  return (x ^ (x >>> 14)) >>> 0
}
if (W.crypto && crypto.getRandomValues) {
  const realGetRandomValues = crypto.getRandomValues.bind(crypto)
  crypto.getRandomValues = function (arr) {
    if (!arr || !ArrayBuffer.isView(arr) || isExempt()) return realGetRandomValues(arr)
    if (arr.byteLength > 65536) throw new DOMException("The ArrayBufferView's byte length exceeds 65536", "QuotaExceededError")
    const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength)
    for (let i = 0; i < bytes.length; i += 4) {
      const w = nextByteWord()
      for (let j = 0; j < 4 && i + j < bytes.length; j++) bytes[i + j] = (w >>> (j * 8)) & 255
    }
    return arr
  }
}
if (W.crypto && crypto.randomUUID) {
  crypto.randomUUID = function () {
    const h = () => Math.floor(Math.random() * 16).toString(16)
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) =>
      c === "x" ? h() : ((Math.random() * 4) | 8).toString(16),
    )
  }
}

// ---- event-loop yield (no 4ms clamp, unlike setTimeout) -------------------

const yieldChannel = new MessageChannel()
const yieldQueue = []
yieldChannel.port1.onmessage = () => yieldQueue.shift()()
function yieldTask() {
  return new Promise((resolve) => {
    yieldQueue.push(resolve)
    yieldChannel.port2.postMessage(0)
  })
}
// React's scheduler (and similar) queue work through MessageChannel. Counting
// in-flight messages on app channels tells us when the app has gone idle, so
// time only advances once the previous moment's renders and effects are done.
// Recording and replay both wait this way, which is what makes replay exact.
let appMessages = 0
const appPorts = new WeakSet()
const RealChannel = W.MessageChannel
W.MessageChannel = function MessageChannel() {
  const ch = new RealChannel()
  appPorts.add(ch.port1)
  appPorts.add(ch.port2)
  return ch
}
W.MessageChannel.prototype = RealChannel.prototype
const MPP = MessagePort.prototype
const portPost = MPP.postMessage
MPP.postMessage = function (...args) {
  if (appPorts.has(this)) appMessages++
  return portPost.apply(this, args)
}
const portOnMessage = Object.getOwnPropertyDescriptor(MPP, "onmessage")
Object.defineProperty(MPP, "onmessage", {
  configurable: true,
  get() {
    return portOnMessage.get.call(this)
  },
  set(fn) {
    if (!appPorts.has(this) || typeof fn !== "function") return portOnMessage.set.call(this, fn)
    portOnMessage.set.call(this, function (e) {
      if (appMessages > 0) appMessages--
      return fn.call(this, e)
    })
  },
})

const stats = { settles: 0, stuck: 0, yields: 0, idbWaits: 0, fastSettles: 0 }
// Set when a replay hands the app something that may finish in real time (a
// network reply, a worker message, media readiness): the next settle then
// yields a real task, whatever else is true.
let dispatchedSinceYield = true
// Wait until the app is idle: no pending MessageChannel work (React's
// scheduler) and no IndexedDB work or replayed script load in flight (they
// answer in real time).
// fastOk (replay only): when the app has nothing queued, a few microtask turns
// do instead of a task round trip, which is most of a canvas-heavy page's
// rebuild time. The dock's `fastReplay = false` turns it off (a kill switch).
async function settle(fastOk) {
  stats.settles++
  if (fastOk && clock.seeking && !dispatchedSinceYield && appMessages === 0 && !otherBusy() && !(shell && shell.fastReplay === false)) {
    for (let i = 0; i < 8; i++) await null
    if (appMessages === 0) {
      stats.fastSettles++
      return
    }
  }
  const deadline = real.perfNow() + 2000
  for (let round = 0; round < 20; round++) {
    let i = 0
    for (; i < 60; i++) {
      await yieldTask()
      dispatchedSinceYield = false
      stats.yields++
      if (appMessages === 0) break
    }
    if (i === 60) {
      stats.stuck++
      appMessages = 0 // lost count (a port we can't see); don't stall forever
    }
    if (!otherBusy() || real.perfNow() > deadline) return
    stats.idbWaits++
    while (otherBusy() && real.perfNow() < deadline) await new Promise((r) => real.setTimeout(r, 0))
  }
}
// Work that answers in real time and that time waits for: IndexedDB requests
// (32-state.js) and, replaying, scripts the recording loaded at this moment (36-scripts.js).
const otherBusy = () => (typeof idbBusy !== "undefined" && idbBusy > 0) || (typeof scriptBusy !== "undefined" && scriptBusy > 0)
