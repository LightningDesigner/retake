// Virtual clock. Every app-visible notion of time (timers, rAF, performance.now,
// Date) reads from `clock.now`, which only the engine advances. All runtime
// files are concatenated into one IIFE by the Vite plugin, in filename order.

const W = window
const PT = (W.__wayback = { emit() {} })
const real = {
  setTimeout: W.setTimeout.bind(W),
  clearTimeout: W.clearTimeout.bind(W),
  setInterval: W.setInterval.bind(W),
  raf: W.requestAnimationFrame.bind(W),
  perfNow: performance.now.bind(performance),
  Date: W.Date,
  random: Math.random,
  fetch: W.fetch.bind(W),
  local: W.localStorage,
  session: W.sessionStorage,
}

const KEY = "wayback:"
// performance.now() and rAF timestamps are offset so they never read 0 (lots of
// code treats a 0 timestamp as "unset").
const PERF_BASE = 1000
// Timers created by the dev server itself must keep real time, or HMR stalls
// whenever the clock is paused.
const EXEMPT = /@vite\/client|@react-refresh|vite\/dist\/client/

const clock = { now: 0, rate: 1, playing: false, seeking: false, booted: false }

// ---- timers ---------------------------------------------------------------

const timers = new Map()
let timerSeq = 1e9

function isExempt() {
  return EXEMPT.test(new Error().stack || "")
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

// Debug aid: `window.__waybackTrace = []` before load collects a log of
// what ran when, to diff a recording against its replay.
const trace = (...entry) => W.__waybackTrace && W.__waybackTrace.push([clock.now, ...entry])

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

// ---- animation frames -----------------------------------------------------

let rafQueue = new Map()
let rafSeq = 1

W.requestAnimationFrame = function (cb) {
  if (W.__waybackTrace) trace("req", (new Error().stack || "").split("\n")[2])
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
function seedRandom(s) {
  seed = s >>> 0
  let state = seed
  Math.random = function () {
    state = (state + 0x6d2b79f5) >>> 0
    let x = state
    x = Math.imul(x ^ (x >>> 15), x | 1)
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61)
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
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

const stats = { settles: 0, stuck: 0, yields: 0 }
async function settle() {
  stats.settles++
  for (let i = 0; i < 60; i++) {
    await yieldTask()
    stats.yields++
    if (appMessages === 0) return
  }
  stats.stuck++
  appMessages = 0 // lost count (a port we can't see); don't stall forever
}
