// Things the browser tells the app on its own schedule: IntersectionObserver
// and ResizeObserver callbacks (on real rendering steps) and Worker messages
// (from another thread). Each delivery is recorded with its entries and
// moment and replayed from the recording, so they land at the same virtual
// time and with the same values.

// ---- IntersectionObserver / ResizeObserver --------------------------------------

let obsSeq = 0
const observers = new Map() // creation order -> wrapper

const rectOf = (r) => (r ? [r.x, r.y, r.width, r.height] : null)
const toRect = (a) => (a ? DOMRectReadOnly.fromRect({ x: a[0], y: a[1], width: a[2], height: a[3] }) : null)
const sizeOf = (list) => [...(list || [])].map((s) => [s.inlineSize, s.blockSize])
const toSizes = (a) => (a || []).map(([inlineSize, blockSize]) => ({ inlineSize, blockSize }))

function wrapObserver(Real, pack, unpack) {
  const Wrapped = function (callback, options) {
    if (!new.target) throw new TypeError("Failed to construct: Please use the 'new' operator")
    const self = this
    this._id = ++obsSeq
    this._cb = callback
    this._targets = []
    this._off = false
    observers.set(this._id, this)
    this._real = new Real((entries) => self._got(entries), options)
  }
  Wrapped.prototype.observe = function (target, opts) {
    if (!this._targets.includes(target)) this._targets.push(target)
    this._off = false
    return this._real.observe(target, opts)
  }
  Wrapped.prototype.unobserve = function (target) {
    return this._real.unobserve(target)
  }
  Wrapped.prototype.disconnect = function () {
    this._off = true
    return this._real.disconnect()
  }
  Wrapped.prototype.takeRecords = function () {
    return this._real.takeRecords ? this._real.takeRecords() : []
  }
  for (const k of ["root", "rootMargin", "thresholds", "scrollMargin", "delay", "trackVisibility"]) {
    Object.defineProperty(Wrapped.prototype, k, {
      get() {
        return this._real[k]
      },
    })
  }
  Wrapped.prototype._got = function (entries) {
    // In the past, the recording delivers them; while rebuilding, too.
    if (hasFuture() || clock.seeking) return
    const data = []
    for (const e of entries) {
      let k = this._targets.indexOf(e.target)
      if (k < 0) {
        this._targets.push(e.target)
        k = this._targets.length - 1
      }
      data.push(pack(e, k))
    }
    recordEvent({ type: "obs", o: this._id, entries: data })
    this._deliver(data)
  }
  Wrapped.prototype._deliver = function (data) {
    if (this._off) return
    const list = data.map((d) => unpack(d, this._targets[d.k])).filter((e) => e.target)
    if (list.length) safeCall(this._cb, [list, this])
  }
  return Wrapped
}

function deliverObserved(ev) {
  const o = observers.get(ev.o)
  if (o) o._deliver(ev.entries)
}

if (W.IntersectionObserver) {
  W.IntersectionObserver = wrapObserver(
    W.IntersectionObserver,
    (e, k) => ({ k, i: e.isIntersecting ? 1 : 0, r: e.intersectionRatio, b: rectOf(e.boundingClientRect), n: rectOf(e.intersectionRect), rb: rectOf(e.rootBounds), v: e.isVisible ? 1 : 0 }),
    (d, target) => ({
      target,
      time: performance.now(),
      isIntersecting: !!d.i,
      intersectionRatio: d.r,
      boundingClientRect: toRect(d.b),
      intersectionRect: toRect(d.n),
      rootBounds: toRect(d.rb),
      isVisible: !!d.v,
    }),
  )
}
if (W.ResizeObserver) {
  W.ResizeObserver = wrapObserver(
    W.ResizeObserver,
    (e, k) => ({ k, cr: rectOf(e.contentRect), bb: sizeOf(e.borderBoxSize), cb: sizeOf(e.contentBoxSize), dp: sizeOf(e.devicePixelContentBoxSize) }),
    (d, target) => ({
      target,
      contentRect: toRect(d.cr),
      borderBoxSize: toSizes(d.bb),
      contentBoxSize: toSizes(d.cb),
      devicePixelContentBoxSize: toSizes(d.dp),
    }),
  )
}

// ---- Workers ------------------------------------------------------------------------
// A worker's messages are recorded (when they're plain data) and replayed
// without starting the worker. A worker that sends anything else (transferables,
// class instances) runs for real on replay too, and isn't deterministic.

let workerSeq = 0
const workers = new Map()
const clockedWorkers = new Set()
function tickWorkers(t) {
  for (const w of clockedWorkers) {
    if (w._clocked && w._real && !w._dead) {
      try {
        w._real.postMessage({ __retakeTick: t })
      } catch {}
    }
  }
}
const RealWorker = W.Worker

function plainData(v, depth = 0) {
  if (depth > 50) return false
  if (v === null || ["string", "number", "boolean", "undefined"].includes(typeof v)) return true
  if (Array.isArray(v)) return v.every((x) => plainData(x, depth + 1))
  if (typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype) return Object.values(v).every((x) => plainData(x, depth + 1))
  return false
}

// Workers run on the page's virtual clock too: each one starts with a prelude
// that replaces its timers, rAF, performance.now, Date and Math.random with
// versions driven by the page (a tick per frame) and seeded per worker, then
// loads the real worker script. So a worker drawing confetti on an
// OffscreenCanvas draws the same thing at the same moment on every replay.
function workerPrelude(url, type, seedFor, epochAt) {
  const load = type === "module" ? `await import(${JSON.stringify(url)})` : `importScripts(${JSON.stringify(url)})`
  return `(() => {
  const BASE = ${JSON.stringify(url)}, PERF = 1000, EPOCH = ${epochAt}
  let now = 0, state = ${seedFor} >>> 0, seq = 1
  const timers = new Map(), rafs = new Map()
  Math.random = () => { state = (state + 0x6d2b79f5) >>> 0; let x = state; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296 }
  performance.now = () => now + PERF
  const RD = Date
  function VDate(...a) { if (!new.target) return new RD(EPOCH + now).toString(); return a.length ? new RD(...a) : new RD(EPOCH + now) }
  VDate.prototype = RD.prototype; VDate.now = () => EPOCH + now; VDate.parse = RD.parse; VDate.UTC = RD.UTC
  self.Date = VDate
  const add = (fn, d, a, rep) => { const id = seq++; const delay = Math.max(rep ? 4 : 0, Number(d) || 0); timers.set(id, { fn, a, due: now + delay, delay, rep }); return id }
  self.setTimeout = (fn, d, ...a) => (typeof fn === "function" ? add(fn, d, a, false) : 0)
  self.setInterval = (fn, d, ...a) => (typeof fn === "function" ? add(fn, d, a, true) : 0)
  self.clearTimeout = self.clearInterval = (id) => timers.delete(id)
  self.requestAnimationFrame = (cb) => { const id = seq++; rafs.set(id, cb); return id }
  self.cancelAnimationFrame = (id) => rafs.delete(id)
  if (self.importScripts) { const ri = self.importScripts.bind(self); self.importScripts = (...u) => ri(...u.map((x) => new URL(x, BASE).href)) }
  function advance(t) {
    for (let n = 0; n < 5000; n++) {
      let best = null
      for (const x of timers.values()) if (x.due <= t && (!best || x.due < best.due)) best = x
      if (!best) break
      now = Math.max(now, best.due)
      if (best.rep) best.due += best.delay; else for (const [k, v] of timers) if (v === best) timers.delete(k)
      try { best.fn(...best.a) } catch (e) { setTimeout(() => { throw e }) }
    }
    now = t
    const q = [...rafs.values()]; rafs.clear()
    for (const cb of q) try { cb(now + PERF) } catch (e) {}
  }
  self.addEventListener("message", (e) => { if (e.data && e.data.__retakeTick != null) { e.stopImmediatePropagation(); advance(e.data.__retakeTick) } })
})();
${load}
`
}

if (RealWorker) {
  class RetakeWorker extends EventTarget {
    constructor(url, opts) {
      if (isExempt()) return new RealWorker(url, opts)
      super()
      this.onmessage = this.onerror = this.onmessageerror = null
      this._id = ++workerSeq
      workers.set(this._id, this)
      const list = rec.workers || (rec.workers = {})
      const known = list[this._id]
      if (hasFuture() && known && known.ok) {
        this._replay = true // messages come from the recording
        return
      }
      if (!known) list[this._id] = { url: String(url), ok: true }
      let real = null
      try {
        const abs = new URL(String(url), location.href).href
        const type = opts && opts.type === "module" ? "module" : "classic"
        const code = workerPrelude(abs, type, (seed ^ Math.imul(this._id, 0x9e3779b1)) >>> 0, rec.epoch)
        const blob = URL.createObjectURL(new Blob([code], { type: "text/javascript" }))
        real = new RealWorker(blob, { ...opts, type: type === "module" ? "module" : "classic" })
        this._clocked = true
      } catch {
        real = new RealWorker(url, opts) // e.g. a CSP that forbids blob: workers
      }
      this._real = real
      clockedWorkers.add(this)
      this._real.onmessage = (e) => this._got(e.data)
      this._real.onmessageerror = (e) => this._emit("messageerror", e)
      this._real.onerror = (e) => {
        const ev = new ErrorEvent("error", { message: e.message, filename: e.filename, lineno: e.lineno, colno: e.colno, error: e.error })
        this._emit("error", ev)
        if (ev.defaultPrevented) e.preventDefault()
      }
    }
    _emit(type, ev) {
      const prop = this["on" + type]
      if (typeof prop === "function") safeCall(prop.bind(this), [ev])
      this.dispatchEvent(ev)
    }
    _got(data) {
      arrive(() => {
        if (!hasFuture() && !clock.seeking) {
          const entry = rec.workers[this._id]
          if (entry && entry.ok && plainData(data)) recordEvent({ type: "worker", w: this._id, d: data === undefined ? { $u: 1 } : { v: data } })
          else if (entry) entry.ok = false
        }
        this._emit("message", new MessageEvent("message", { data }))
      })
    }
    postMessage(msg, transfer) {
      // A worker handed a canvas draws on the page: it has to run for real on
      // replays (on the virtual clock), not be stood in for by its messages.
      const list = [].concat((transfer && transfer.transfer) || transfer || [])
      if (typeof OffscreenCanvas !== "undefined" && list.some((x) => x instanceof OffscreenCanvas)) {
        const entry = rec.workers && rec.workers[this._id]
        if (entry) entry.ok = false
      }
      if (this._real) this._real.postMessage(msg, transfer)
    }
    terminate() {
      this._dead = true
      clockedWorkers.delete(this)
      if (this._real) this._real.terminate()
    }
  }
  W.Worker = RetakeWorker
}

function deliverWorker(ev) {
  const w = workers.get(ev.w)
  if (!w || !w._replay || w._dead) return
  w._emit("message", new MessageEvent("message", { data: ev.d && "v" in ev.d ? ev.d.v : undefined }))
}
