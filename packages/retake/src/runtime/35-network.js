// Network: fetch (streamed), XMLHttpRequest, EventSource and WebSocket are
// recorded as they arrive and replayed at the same virtual moments, without
// touching the network.
//
// - fetch bodies are teed: the app reads a live stream while each chunk is
//   stored (base64) with the moment it arrived, so a streamed reply (an LLM
//   answer) replays token by token.
// - At the live edge while paused, arrivals are held and delivered when time
//   moves again, so pausing freezes streams too.
// - Only complete exchanges are replayed. One still in flight when the
//   recording was cut waits until its frame is on show at the live edge, then
//   goes to the network for real, once (F52); so does anything a frame built
//   behind (or a checkpoint) asks that the recording can't answer. In the frame
//   on show, the view-only past just goes to the network, unrecorded.
// - The dev server's own traffic (HMR sockets, overlays; by call stack or by
//   URL, see isExemptUrl) goes straight to the real API: never recorded, held
//   or replayed. Its sockets are kept in `devSockets`.
// - Nothing here forks a timeline; only the dock's + does.

const NET = { fetch: "fetches", xhr: "xhrs", sse: "sses", ws: "sockets" }
const used = { fetches: new Set(), xhrs: new Set(), sses: new Set(), sockets: new Set() }
// Replays in progress: `${list}:${i}` -> handler receiving recorded net events.
const replaying = new Map()
const earlyNet = new Map() // events that arrived before their request was made

const listOf = (name) => rec[name] || (rec[name] = [])

// ---- helpers ------------------------------------------------------------------

function toB64(bytes) {
  let s = ""
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
  return btoa(s)
}
function fromB64(b64) {
  const s = atob(b64)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

// Short stable hash for request bodies (FNV-1a).
function hashText(s) {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193)
  return (h >>> 0).toString(36)
}
function bodyHash(body) {
  try {
    if (body == null) return ""
    if (typeof body === "string") return hashText(body)
    if (body instanceof URLSearchParams) return hashText(body.toString())
    if (body instanceof ArrayBuffer) return hashText(toB64(new Uint8Array(body)))
    if (ArrayBuffer.isView(body)) return hashText(toB64(new Uint8Array(body.buffer, body.byteOffset, body.byteLength)))
  } catch {}
  return "?" // FormData, Blob, streams: not hashed; matched by order
}

// Request headers that decide which answer a URL gets (Next's router asks the
// same URL for a prefetch, a page's RSC payload or a server action): part of
// the key, so a prefetch and a navigation never swap answers on replay.
const KEY_HEADERS = ["rsc", "next-router-prefetch", "next-router-segment-prefetch", "next-action"]
function urlKey(url, method, headers) {
  const u = new URL(String(url), location.href)
  // Our frame marker, and Next's `_rsc` (a cache-busting hash of the request's
  // headers, which are in the key themselves), aren't part of what's asked.
  for (const p of ["__wb", "_rsc"]) if (u.searchParams.has(p)) u.searchParams.delete(p)
  let key = `${(method || "GET").toUpperCase()} ${u.origin === location.origin ? u.pathname + u.search : u.href}`
  if (headers) for (const h of KEY_HEADERS) if (headers.has(h)) key += ` ${h}=${headers.get(h)}`
  return key
}
// A request's headers as a Headers object (fetch's init wins over a Request's).
function headersOf(input, init) {
  try {
    if (init && init.headers) return new Headers(init.headers)
    if (typeof Request !== "undefined" && input instanceof Request) return input.headers
  } catch {}
  return null
}
// The body hash, plus Next's router state (which page it's coming from): the
// exact one is preferred, any other still matches in order.
function requestHash(body, headers) {
  const tree = headers && headers.get("next-router-state-tree")
  return bodyHash(body) + (tree ? "~" + hashText(tree) : "")
}

// Find a recorded, complete, unused exchange: same key and body first, then
// same key in order (the body can change after a code edit).
function match(list, key, hash) {
  const arr = rec[list] || []
  const complete = (e) => e.done || (!e.chunks && (e.body != null || e.error != null)) // older recordings
  const ok = (e, j) => e && complete(e) && !used[list].has(j) && e.key === key
  let i = arr.findIndex((e, j) => ok(e, j) && (e.hash || "") === (hash || ""))
  if (i < 0) i = arr.findIndex((e, j) => ok(e, j))
  if (i >= 0) used[list].add(i)
  return i
}
// Was this request in flight when the recording was cut (recorded, never
// answered)? Then it waits for the live edge in any frame (see defer below).
function cutInFlight(list, key) {
  const arr = rec[list] || []
  const j = arr.findIndex((e, k) => e && e.key === key && !e.done && !(e.body != null || e.error != null) && !used[list].has(k))
  if (j >= 0) used[list].add(j)
  return j >= 0
}

// Live arrivals: delivered now, or (at the live edge while paused) held until
// time moves again, and recorded at the moment they reach the app.
const held = []
function arrive(fn) {
  if (!clock.playing && !hasFuture() && !clock.seeking) held.push(fn)
  else fn()
}
function releaseHeld() {
  while (held.length && clock.playing) held.shift()()
}

function netEvent(ev) {
  recordEvent(ev)
}

// ---- frames built behind don't go to the network ---------------------------------
// A frame built behind the one on show (or a checkpoint) replays the past.
// A request there that the recording has no complete answer for (the
// recording was cut while it was in flight) would reach the server again from
// every such frame, ones that change data included. It waits instead, and goes
// out for real (recorded) once this frame is on show at the live edge. So does
// one cut in flight that the frame on show makes again, playing the past.
const deferred = []
const hiddenFrame = () => !!shell && !onShow()
function defer(go) {
  const d = { go, dead: false }
  deferred.push(d)
  return d
}
function releaseDeferred() {
  if (!deferred.length || hasFuture() || clock.seeking || !onShow()) return
  for (const d of deferred.splice(0)) {
    if (d.dead) continue
    d.dead = true
    d.go()
  }
}
function deferFetch(input, init, key, hash, signal, headers) {
  return new Promise((resolve, reject) => {
    const d = defer(() => liveFetch(input, init, key, hash, !hasFuture(), headers).then(resolve, reject))
    if (!signal) return
    const abort = () => {
      if (d.dead) return
      d.dead = true
      reject(new DOMException("The operation was aborted.", "AbortError"))
    }
    if (signal.aborted) return abort()
    signal.addEventListener("abort", abort, { once: true })
  })
}

// The dev server's own sockets (HMR), live and unrecorded: 37-next.js talks to them.
const devSockets = new Set()

// While the dock switches a timeline's code on disk (code timelines), what the
// dev server pushes (hot updates, full reloads) waits: a half-written tree must
// not hot-update or reload the frame on show. That frame is replaced by a
// rebuild once the files are in place, and the held messages go with it; if
// the switch fails they're delivered (PT.holdDev(false)).
const devHold = { on: false, queue: [] }
function holdable(target) {
  target.addEventListener("message", (e) => {
    if (!devHold.on || e.__retakeFlush) return
    e.stopImmediatePropagation()
    devHold.queue.push([target, e])
  })
  return target
}
PT.holdDev = (on) => {
  devHold.on = !!on
  if (devHold.on) return
  for (const [target, e] of devHold.queue.splice(0)) {
    const copy = new W.MessageEvent("message", { data: e.data, origin: e.origin, lastEventId: e.lastEventId })
    copy.__retakeFlush = true
    target.dispatchEvent(copy)
  }
}

// Recorded net events during replay.
function deliverNet(ev) {
  const key = `${ev.list}:${ev.i}`
  const h = replaying.get(key)
  if (h) return h(ev)
  const q = earlyNet.get(key) || []
  q.push(ev)
  earlyNet.set(key, q)
}
function onReplay(list, i, handler) {
  const key = `${list}:${i}`
  replaying.set(key, handler)
  const q = earlyNet.get(key)
  if (q) {
    earlyNet.delete(key)
    for (const ev of q) handler(ev)
  }
}
const doneReplay = (list, i) => replaying.delete(`${list}:${i}`)

// Cutting the future at a fork: unused exchanges go, and replays still
// delivering (a stream half-way through) get the rest of their recording now,
// recorded into the new timeline, so nothing is left hanging.
function netFork(cutEvents) {
  for (const list of Object.values(NET)) {
    if (rec[list]) rec[list] = rec[list].map((e, j) => (used[list].has(j) ? e : null))
  }
  for (const ev of cutEvents) {
    if (ev.type !== "net") continue
    const h = replaying.get(`${ev.list}:${ev.i}`)
    if (h) {
      h(ev)
      recordEvent({ ...ev })
    }
  }
}

// ---- fetch -------------------------------------------------------------------------

function netError(e) {
  if (e && e.name === "AbortError") return new DOMException(e.message || "The operation was aborted.", "AbortError")
  return new TypeError((e && e.message) || "Failed to fetch")
}
const NO_BODY = [101, 204, 205, 304]

function makeResponse(entry, body) {
  const res = new Response(NO_BODY.includes(entry.status) ? null : body, { status: entry.status, statusText: entry.statusText, headers: entry.headers })
  try {
    Object.defineProperty(res, "url", { value: entry.url || "" })
    Object.defineProperty(res, "redirected", { value: !!entry.redirected })
  } catch {}
  return res
}

function replayFetch(i, signal, headers) {
  const entry = rec.fetches[i]
  // (Next 16 waits for debug data about this request over its HMR socket.)
  const ended = () => nextReplayEnd(headers)
  return new Promise((resolve, reject) => {
    let controller = null
    let settled = false
    const abort = () => {
      const err = new DOMException("The operation was aborted.", "AbortError")
      if (!settled) reject(err)
      else if (controller) {
        try {
          controller.error(err)
        } catch {}
      }
      settled = true
      doneReplay("fetches", i)
    }
    if (signal) {
      if (signal.aborted) return abort()
      signal.addEventListener("abort", abort, { once: true })
    }
    // Old recordings kept the whole body as text on one "fetch" event.
    if (entry.body != null && !entry.chunks) {
      onReplay("fetches", i, () => {
        settled = true
        doneReplay("fetches", i)
        nextReplayStart(entry, headers)
        ended()
        entry.error ? reject(netError(entry.error)) : resolve(makeResponse(entry, entry.body))
      })
      return
    }
    onReplay("fetches", i, (ev) => {
      if (ev.kind === "error") {
        doneReplay("fetches", i)
        ended()
        if (!settled) reject(netError(entry.error))
        else if (controller) controller.error(netError(entry.error))
        settled = true
        return
      }
      if (ev.kind === "head") {
        settled = true
        nextReplayStart(entry, headers)
        const stream = new ReadableStream({ start: (c) => (controller = c) })
        resolve(makeResponse(entry, stream))
        return
      }
      if (ev.kind === "chunk" && controller) {
        try {
          controller.enqueue(fromB64(entry.chunks[ev.n]))
        } catch {}
      }
      if (ev.kind === "end") {
        doneReplay("fetches", i)
        ended()
        try {
          controller && controller.close()
        } catch {}
      }
    })
  })
}

function liveFetch(input, init, key, hash, record, headers) {
  const list = listOf("fetches")
  const idx = record ? list.length : -1
  const entry = { key, hash, t0: clock.now, chunks: [] }
  if (record) {
    list.push(entry)
    used.fetches.add(idx)
    nextLiveRequest(entry, headers)
  }
  const ev = (kind, extra) => record && netEvent({ type: "net", list: "fetches", i: idx, kind, ...extra })
  ;[input, init] = nextLiveInit(input, init) // (a kept Next page: its own socket's id)
  return new Promise((resolve, reject) => {
    real.fetch(input, init).then(
      (res) => {
        arrive(() => {
          entry.status = res.status
          entry.statusText = res.statusText
          entry.headers = [...res.headers]
          entry.url = res.url
          entry.redirected = res.redirected
          ev("head")
          if (!res.body || NO_BODY.includes(res.status)) {
            entry.done = true
            ev("end")
            return resolve(makeResponse(entry, null))
          }
          // The body is read as it arrives, whether or not the app reads it:
          // a response the app only checks (res.ok) still gets recorded whole,
          // so replays never have to go back to the network for it.
          const reader = res.body.getReader()
          let appStream = null
          let cancelled = false
          const stream = new ReadableStream({
            start(controller) {
              appStream = controller
            },
            cancel(reason) {
              cancelled = true // the app is done with it; the recording keeps reading
            },
          })
          const pump = () =>
            reader.read().then(
              ({ done, value }) =>
                arrive(() => {
                  if (done) {
                    entry.done = true
                    ev("end")
                    if (!cancelled) {
                      try {
                        appStream.close()
                      } catch {}
                    }
                    return
                  }
                  entry.chunks.push(toB64(value))
                  ev("chunk", { n: entry.chunks.length - 1 })
                  if (!cancelled) {
                    try {
                      appStream.enqueue(value)
                    } catch {}
                  }
                  pump()
                }),
              (err) =>
                arrive(() => {
                  entry.error = { name: err && err.name, message: err && err.message }
                  entry.done = true
                  ev("error")
                  if (!cancelled) {
                    try {
                      appStream.error(err)
                    } catch {}
                  }
                }),
            )
          pump()
          resolve(makeResponse(entry, stream))
        })
      },
      (err) =>
        arrive(() => {
          entry.error = { name: err && err.name, message: err && err.message }
          entry.done = true
          ev("error")
          reject(err) // the app gets the real error (AbortError stays AbortError)
        }),
    )
  })
}

W.fetch = function (input, init) {
  if (isExempt()) return real.fetch(input, init)
  let key
  let hash
  let headers
  try {
    const url = typeof input === "string" || input instanceof URL ? input : input.url
    if (isExemptUrl(url)) return real.fetch(input, init)
    headers = headersOf(input, init)
    // Next's router refetching the page after a server component edit: the dev
    // server's traffic too (F77), but with its socket's id like a live request.
    if (nextHmrRefresh(headers)) return real.fetch(...nextLiveInit(input, init))
    key = urlKey(url, (init && init.method) || (input && input.method), headers)
    hash = requestHash(init && init.body, headers)
  } catch {
    return real.fetch(input, init)
  }
  const signal = (init && init.signal) || (input && input.signal)
  if (hasFuture()) {
    const i = match("fetches", key, hash)
    if (i >= 0) return replayFetch(i, signal, headers)
    // Cut mid-flight, or (in a frame built behind) not in the recording: it
    // waits until the frame is on show at the live edge. Anything else in the
    // view-only past just goes to the network, unrecorded.
    if (hiddenFrame() || cutInFlight("fetches", key)) return deferFetch(input, init, key, hash, signal, headers)
    return liveFetch(input, init, key, hash, false, headers)
  }
  return liveFetch(input, init, key, hash, true, headers)
}

// ---- XMLHttpRequest -------------------------------------------------------------------

const RealXHR = W.XMLHttpRequest
const XHR_EVENTS = ["readystatechange", "loadstart", "progress", "load", "loadend", "error", "abort", "timeout"]

class RetakeXHR extends EventTarget {
  constructor() {
    super()
    this.readyState = 0
    this.status = 0
    this.statusText = ""
    this.responseType = ""
    this.responseURL = ""
    this.timeout = 0
    this.withCredentials = false
    this.upload = new EventTarget()
    this._headers = []
    this._resHeaders = ""
    this._response = null
    this._text = ""
    for (const t of XHR_EVENTS) this["on" + t] = null
  }
  get response() {
    return this.responseType === "" || this.responseType === "text" ? this._text : this._response
  }
  get responseText() {
    if (this.responseType !== "" && this.responseType !== "text") throw new DOMException("responseText is only for text responses", "InvalidStateError")
    return this._text
  }
  get responseXML() {
    return null
  }
  open(method, url, async = true) {
    this._method = String(method || "GET").toUpperCase()
    this._url = url
    this._async = async !== false
    this._exempt = isExempt() || isExemptUrl(url) // the dev server's own: straight through
    this._fire("readystatechange", 1)
  }
  setRequestHeader(k, v) {
    this._headers.push([k, v])
  }
  overrideMimeType() {}
  getAllResponseHeaders() {
    return this.readyState >= 2 ? this._resHeaders : ""
  }
  getResponseHeader(name) {
    if (this.readyState < 2) return null
    const n = String(name).toLowerCase()
    const vals = this._resHeaders
      .split(/\r?\n/)
      .filter(Boolean)
      .map((l) => [l.slice(0, l.indexOf(":")).trim().toLowerCase(), l.slice(l.indexOf(":") + 1).trim()])
      .filter(([k]) => k === n)
      .map(([, v]) => v)
    return vals.length ? vals.join(", ") : null
  }
  abort() {
    this._aborted = true
    if (this._deferred) this._deferred.dead = true
    if (this._real) this._real.abort()
    if (this.readyState > 0 && this.readyState < 4) {
      this._fire("readystatechange", 4)
      this._fire("abort")
      this._fire("loadend")
    }
    this.readyState = 0
    if (this._list && this._i != null) doneReplay(this._list, this._i)
  }
  _fire(type, state) {
    if (state != null) this.readyState = state
    const ev = new ProgressEvent(type)
    const prop = this["on" + type]
    if (typeof prop === "function") safeCall(prop.bind(this), [ev])
    this.dispatchEvent(ev)
  }
  _apply(entry) {
    this.status = entry.status
    this.statusText = entry.statusText || ""
    this.responseURL = entry.url || ""
    this._resHeaders = entry.headers || ""
    this._fire("readystatechange", 2)
    this._fire("readystatechange", 3)
    if (entry.b64 != null) {
      const bytes = fromB64(entry.b64)
      const type = this.responseType
      if (type === "arraybuffer") this._response = bytes.buffer
      else if (type === "blob") this._response = new Blob([bytes], { type: this.getResponseHeader("content-type") || "" })
      else {
        this._text = new TextDecoder().decode(bytes)
        if (type === "json") {
          try {
            this._response = JSON.parse(this._text)
          } catch {
            this._response = null
          }
        } else this._response = this._text
      }
    }
    this._fire("readystatechange", 4)
    this._fire("load")
    this._fire("loadend")
  }
  _fail(kind) {
    this.status = 0
    this._fire("readystatechange", 4)
    this._fire(kind || "error")
    this._fire("loadend")
  }
  send(body) {
    let headers = null
    try {
      headers = new Headers(this._headers)
    } catch {}
    const key = urlKey(this._url, this._method, headers)
    const hash = requestHash(body, headers)
    this._fire("loadstart")
    if (this._exempt) return this._live(body, key, hash, false, true)
    if (hasFuture()) {
      const i = match("xhrs", key, hash)
      if (i >= 0) {
        this._list = "xhrs"
        this._i = i
        onReplay("xhrs", i, () => {
          doneReplay("xhrs", i)
          if (this._aborted) return
          const e = rec.xhrs[i]
          e.fail ? this._fail(e.fail) : this._apply(e)
        })
        return
      }
      if (hiddenFrame() || cutInFlight("xhrs", key)) {
        this._deferred = defer(() => this._live(body, key, hash, !hasFuture()))
        return
      }
      return this._live(body, key, hash, false)
    }
    return this._live(body, key, hash, true)
  }
  // raw: the dev server's own request, delivered as it comes (never held).
  _live(body, key, hash, record, raw) {
    const x = (this._real = new RealXHR())
    x.open(this._method, this._url, this._async)
    if (this._async) x.responseType = "arraybuffer"
    x.timeout = this.timeout
    x.withCredentials = this.withCredentials
    for (const [k, v] of this._headers) x.setRequestHeader(k, v)
    for (const t of ["progress", "load", "loadend", "error", "abort", "timeout", "loadstart"]) {
      x.upload.addEventListener(t, (e) => this.upload.dispatchEvent(new ProgressEvent(t, e)))
    }
    const list = listOf("xhrs")
    const idx = record ? list.length : -1
    const entry = { key, hash, t0: clock.now }
    if (record) {
      list.push(entry)
      used.xhrs.add(idx)
    }
    const finish = (fail) =>
      (raw ? (fn) => fn() : arrive)(() => {
        if (this._aborted) return
        if (fail) entry.fail = fail
        else {
          entry.status = x.status
          entry.statusText = x.statusText
          entry.headers = x.getAllResponseHeaders()
          entry.url = x.responseURL
          entry.b64 = !this._async ? toB64(new TextEncoder().encode(x.responseText || "")) : x.response ? toB64(new Uint8Array(x.response)) : ""
        }
        entry.done = true
        if (record) netEvent({ type: "net", list: "xhrs", i: idx, kind: "done" })
        fail ? this._fail(fail) : this._apply(entry)
      })
    x.onload = () => finish(null)
    x.onerror = () => finish("error")
    x.ontimeout = () => finish("timeout")
    x.send(body)
  }
}
for (const [k, v] of Object.entries({ UNSENT: 0, OPENED: 1, HEADERS_RECEIVED: 2, LOADING: 3, DONE: 4 })) {
  RetakeXHR[k] = v
  RetakeXHR.prototype[k] = v
}
W.XMLHttpRequest = RetakeXHR

// ---- EventSource ------------------------------------------------------------------------

const RealES = W.EventSource
if (RealES) {
  class RetakeEventSource extends EventTarget {
    constructor(url, opts) {
      if (isExempt() || isExemptUrl(url)) return holdable(new RealES(url, opts))
      super()
      this.url = new URL(String(url), location.href).href
      this.withCredentials = !!(opts && opts.withCredentials)
      this.readyState = 0
      this.onopen = this.onmessage = this.onerror = null
      this._types = new Set(["message", "open", "error"])
      const key = urlKey(url, "GET")
      if (hasFuture()) {
        const i = match("sses", key, "")
        if (i >= 0) {
          this._i = i
          onReplay("sses", i, (ev) => this._play(rec.sses[i].msgs[ev.n]))
          return
        }
        if (hiddenFrame() || cutInFlight("sses", key)) {
          this._deferred = defer(() => this._live(url, opts, key, !hasFuture()))
          return
        }
        this._live(url, opts, key, false)
        return
      }
      this._live(url, opts, key, true)
    }
    get CONNECTING() {
      return 0
    }
    get OPEN() {
      return 1
    }
    get CLOSED() {
      return 2
    }
    _emit(m) {
      const ev = m.type === "open" || m.type === "error" ? new Event(m.type) : new MessageEvent(m.type, { data: m.data, lastEventId: m.id || "", origin: location.origin })
      const prop = this["on" + m.type]
      if (typeof prop === "function") safeCall(prop.bind(this), [ev])
      this.dispatchEvent(ev)
    }
    _play(m) {
      if (this.readyState === 2 || !m) return
      if (m.type === "open") this.readyState = 1
      if (m.type === "error") this.readyState = m.closed ? 2 : 0
      this._emit(m)
    }
    addEventListener(type, fn, o) {
      if (!this._types.has(type)) {
        this._types.add(type)
        if (this._real) this._wire(type)
      }
      return super.addEventListener(type, fn, o)
    }
    _wire(type) {
      this._real.addEventListener(type, (e) => this._got({ type, data: e.data, id: e.lastEventId }))
    }
    _live(url, opts, key, record) {
      const es = (this._real = new RealES(url, opts))
      for (const type of this._types) if (type !== "message" && type !== "open" && type !== "error") this._wire(type)
      const list = listOf("sses")
      this._record = record
      this._entry = { key, t0: clock.now, msgs: [] }
      if (record) {
        this._idx = list.length
        list.push(this._entry)
        used.sses.add(this._idx)
      }
      es.onopen = () => this._got({ type: "open" })
      es.onmessage = (e) => this._got({ type: "message", data: e.data, id: e.lastEventId })
      es.onerror = () => this._got({ type: "error", closed: es.readyState === 2 })
    }
    _got(m) {
      arrive(() => {
        if (this.readyState === 2) return
        const e = this._entry
        e.msgs.push(m)
        if (m.type === "error" && m.closed) e.done = true
        if (this._record) netEvent({ type: "net", list: "sses", i: this._idx, n: e.msgs.length - 1 })
        this._play(m)
      })
    }
    close() {
      this.readyState = 2
      if (this._deferred) this._deferred.dead = true
      if (this._real) this._real.close()
      if (this._entry) this._entry.done = true
      if (this._i != null) doneReplay("sses", this._i)
    }
  }
  W.EventSource = RetakeEventSource
}

// ---- WebSocket -------------------------------------------------------------------------

const RealWS = W.WebSocket
if (RealWS) {
  class RetakeWebSocket extends EventTarget {
    constructor(url, protocols) {
      // The dev server's own socket (Vite's or Next's HMR client) stays real and unheld.
      if (isExempt() || isExemptUrl(url) || [].concat(protocols || []).some((p) => p === "vite-hmr" || p === "vite-ping")) {
        const ws = holdable(new RealWS(nextSocketUrl(url), protocols))
        devSockets.add(ws)
        ws.addEventListener("open", () => (nextDocReplay(), flushNext()))
        ws.addEventListener("message", nextDevMessage)
        ws.addEventListener("close", () => devSockets.delete(ws))
        return ws
      }
      super()
      this.url = new URL(String(url), location.href).href
      this.readyState = 0
      this.protocol = ""
      this.extensions = ""
      this.bufferedAmount = 0
      this.binaryType = "blob"
      this.onopen = this.onmessage = this.onerror = this.onclose = null
      const key = `WS ${this.url}`
      if (hasFuture()) {
        const i = match("sockets", key, "")
        if (i >= 0) {
          this._i = i
          onReplay("sockets", i, (ev) => this._play(rec.sockets[i].msgs[ev.n]))
          return
        }
        if (hiddenFrame() || cutInFlight("sockets", key)) {
          this._deferred = defer(() => this._live(url, protocols, key, !hasFuture()))
          return
        }
        this._live(url, protocols, key, false)
        return
      }
      this._live(url, protocols, key, true)
    }
    _emit(m) {
      let ev
      if (m.type === "message") {
        let data = m.data
        if (m.b64 != null) {
          const bytes = fromB64(m.b64)
          data = this.binaryType === "arraybuffer" ? bytes.buffer : new Blob([bytes])
        }
        ev = new MessageEvent("message", { data, origin: new URL(this.url).origin })
      } else if (m.type === "close") ev = new CloseEvent("close", { code: m.code, reason: m.reason, wasClean: m.wasClean })
      else ev = new Event(m.type)
      const prop = this["on" + m.type]
      if (typeof prop === "function") safeCall(prop.bind(this), [ev])
      this.dispatchEvent(ev)
    }
    _play(m) {
      if (!m || this.readyState === 3) return
      if (m.type === "open") {
        this.readyState = 1
        this.protocol = m.protocol || ""
      }
      if (m.type === "close") this.readyState = 3
      this._emit(m)
    }
    _live(url, protocols, key, record) {
      const ws = (this._real = new RealWS(url, protocols))
      ws.binaryType = "arraybuffer"
      const list = listOf("sockets")
      this._record = record
      this._entry = { key, t0: clock.now, msgs: [] }
      if (record) {
        this._idx = list.length
        list.push(this._entry)
        used.sockets.add(this._idx)
      }
      ws.onopen = () => this._got({ type: "open", protocol: ws.protocol })
      ws.onmessage = (e) => this._got(typeof e.data === "string" ? { type: "message", data: e.data } : { type: "message", b64: toB64(new Uint8Array(e.data)) })
      ws.onerror = () => this._got({ type: "error" })
      ws.onclose = (e) => this._got({ type: "close", code: e.code, reason: e.reason, wasClean: e.wasClean })
    }
    _got(m) {
      arrive(() => {
        const e = this._entry
        e.msgs.push(m)
        if (m.type === "close") e.done = true
        if (this._record) netEvent({ type: "net", list: "sockets", i: this._idx, n: e.msgs.length - 1 })
        this._play(m)
      })
    }
    send(data) {
      if (this.readyState !== 1) throw new DOMException("WebSocket is not open", "InvalidStateError")
      if (this._real) this._real.send(data) // a replayed socket talks to no one
    }
    close(code, reason) {
      if (this._deferred) this._deferred.dead = true
      if (this._real) this._real.close(code, reason)
      else if (this.readyState < 2) {
        this.readyState = 3
        if (this._i != null) doneReplay("sockets", this._i)
        this._emit({ type: "close", code: code || 1000, reason: reason || "", wasClean: true })
      }
    }
  }
  for (const [k, v] of Object.entries({ CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 })) {
    RetakeWebSocket[k] = v
    RetakeWebSocket.prototype[k] = v
  }
  W.WebSocket = RetakeWebSocket
}
