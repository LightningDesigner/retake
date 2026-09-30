// Network: fetch (streamed), XMLHttpRequest, EventSource and WebSocket are
// recorded as they arrive and replayed at the same virtual moments, without
// touching the network.
//
// - fetch bodies are teed: the app reads a live stream while each chunk is
//   stored (base64) with the moment it arrived, so a streamed reply (an LLM
//   answer) replays token by token.
// - At the live edge while paused, arrivals are held and delivered when time
//   moves again, so pausing freezes streams too.
// - Only complete exchanges are replayed. Anything still in flight when the
//   recording was cut goes to the network for real.
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

function urlKey(url, method) {
  const u = new URL(String(url), location.href)
  return `${(method || "GET").toUpperCase()} ${u.origin === location.origin ? u.pathname + u.search : u.href}`
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

function replayFetch(i, signal) {
  const entry = rec.fetches[i]
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
        entry.error ? reject(netError(entry.error)) : resolve(makeResponse(entry, entry.body))
      })
      return
    }
    onReplay("fetches", i, (ev) => {
      if (ev.kind === "error") {
        doneReplay("fetches", i)
        if (!settled) reject(netError(entry.error))
        else if (controller) controller.error(netError(entry.error))
        settled = true
        return
      }
      if (ev.kind === "head") {
        settled = true
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
        try {
          controller && controller.close()
        } catch {}
      }
    })
  })
}

function liveFetch(input, init, key, hash, record) {
  const list = listOf("fetches")
  const idx = record ? list.length : -1
  const entry = { key, hash, t0: clock.now, chunks: [] }
  if (record) {
    list.push(entry)
    used.fetches.add(idx)
  }
  const ev = (kind, extra) => record && netEvent({ type: "net", list: "fetches", i: idx, kind, ...extra })
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
          const reader = res.body.getReader()
          const stream = new ReadableStream({
            pull(controller) {
              return reader.read().then(
                ({ done, value }) =>
                  new Promise((ok) =>
                    arrive(() => {
                      if (done) {
                        entry.done = true
                        ev("end")
                        controller.close()
                      } else {
                        entry.chunks.push(toB64(value))
                        ev("chunk", { n: entry.chunks.length - 1 })
                        controller.enqueue(value)
                      }
                      ok()
                    }),
                  ),
                (err) =>
                  arrive(() => {
                    entry.error = { name: err && err.name, message: err && err.message }
                    entry.done = true
                    ev("error")
                    controller.error(err)
                  }),
              )
            },
            cancel(reason) {
              entry.done = true
              entry.error = { name: "AbortError", message: "cancelled" }
              ev("error")
              return reader.cancel(reason)
            },
          })
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
  try {
    key = urlKey(typeof input === "string" || input instanceof URL ? input : input.url, (init && init.method) || (input && input.method))
  } catch {
    return real.fetch(input, init)
  }
  const hash = bodyHash(init && init.body)
  const signal = (init && init.signal) || (input && input.signal)
  if (hasFuture()) {
    const i = match("fetches", key, hash)
    if (i >= 0) return replayFetch(i, signal)
    // Not in the recording (or it was cut mid-flight): the past is view-only,
    // so just go to the network, unrecorded.
    return liveFetch(input, init, key, hash, false)
  }
  return liveFetch(input, init, key, hash, true)
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
    const key = urlKey(this._url, this._method)
    const hash = bodyHash(body)
    this._fire("loadstart")
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
      return this._live(body, key, hash, false)
    }
    return this._live(body, key, hash, true)
  }
  _live(body, key, hash, record) {
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
      arrive(() => {
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
      if (isExempt()) return new RealES(url, opts)
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
        return this._live(url, opts, key, false)
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
      if (this._real && !this._types.has(type)) {
        this._types.add(type)
        this._real.addEventListener(type, (e) => this._got({ type, data: e.data, id: e.lastEventId }))
      }
      return super.addEventListener(type, fn, o)
    }
    _live(url, opts, key, record) {
      const es = (this._real = new RealES(url, opts))
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
      // The dev server's own socket (Vite's HMR client) stays real and unheld.
      if (isExempt()) return new RealWS(url, protocols)
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
        return this._live(url, protocols, key, false)
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
