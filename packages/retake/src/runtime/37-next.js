// Next.js 16's debug channel (F49). In development, Next sends React's debug
// data for each request over its HMR socket, keyed by the request's
// `x-nextjs-request-id` header, and React waits for that stream (and its
// end) before it shows a soft navigation or a server action's result. A
// replayed request never reached the server, so nothing would come. So the
// debug data that arrives for a recorded request is kept with it
// (`entry.debug`), and a replay hands it, then its end, to Next's HMR client
// the way the server sent it: the data as the answer starts, the end once the
// answer has ended.
//
// The page's own debug data (for its HTML request, `self.__next_r`) is kept
// with its segment too: a rebuild given the page as it was recorded (F56)
// gets it the same way, since the server sent it to the original page only.
//
// The message (next@16.3, client/dev/hot-reloader/app/web-socket.js) is
// binary: [0 (REACT_DEBUG_CHUNK), id length, id bytes, chunk bytes]; no chunk
// bytes means the stream has ended. Only for the Next version the server
// detected (RT.next); any other version gets the CLI's warning only.
// RT.next "auto": the server knows it's Next but not which (fronting a bare
// URL, `retake http://localhost:3000`): Next's client says, `window.next.version`,
// set before it connects its HMR socket or sends a request.

const nextOn = () => RT.next === 16 || (RT.next === "auto" && /^16\./.test(String((W.next && W.next.version) || "")))
const nextLive = new Map() // request id -> the recorded fetch entry it's for (live requests)
let nextOwn = false // dispatching our own message (not the server's)
const nextQueue = [] // [id, chunk bytes | null] waiting for Next's HMR socket
const nextId = (headers) => (nextOn() && headers && headers.get("x-nextjs-request-id")) || null

// A live request Next will send debug data for: keep it with the recording.
function nextLiveRequest(entry, headers) {
  const id = nextId(headers)
  if (!id) return
  nextLive.set(id, entry)
  if (nextLive.size > 200) nextLive.delete(nextLive.keys().next().value)
}
// A message on Next's HMR socket (the server's): debug data for a live request.
function nextDevMessage(e) {
  if (nextOwn || !nextOn() || !(e.data instanceof ArrayBuffer) || e.data.byteLength < 2) return
  const bytes = new Uint8Array(e.data)
  if (bytes[0] !== 0) return
  const len = bytes[1]
  if (bytes.length <= 2 + len) return
  const id = new TextDecoder().decode(bytes.subarray(2, 2 + len))
  const chunk = toB64(bytes.subarray(2 + len))
  const entry = nextLive.get(id)
  if (entry) (entry.debug || (entry.debug = [])).push(chunk)
  else if (id === W.__next_r && RT.docId && !RT.docStored && rec) {
    // This page's own: kept with the segment this page is (rec itself for the first).
    const seg = rec.doc === RT.docId ? rec : (rec.segments || []).find((s) => s.doc === RT.docId)
    if (seg) (seg.docDebug || (seg.docDebug = [])).push(chunk)
  }
}

// Next's HMR socket names the page's request (`/_next/hmr?id=<__next_r>`), and
// the server keeps one socket per id: when one closes, the id is dropped, along
// with whichever socket last registered it. A page served as it was recorded
// (F56) carries the recorded page's id, shared with the frame it was recorded
// in and every other build of it, so swapping one in for another left the new
// frame's socket without hot updates. Such a page's socket gets an id of its own
// (its debug data comes from the recording, below, not from the server).
//
// The server also sends a live request's debug data to the socket registered
// under the request's `x-nextjs-html-request-id` (= `__next_r`): with no socket
// under that id any more, a soft navigation or server action made live from
// such a frame waited for ever. So its live requests carry the socket's id
// (`nextLiveInit`).
let nextSocketId = null
function nextSocketUrl(url) {
  if (!RT.docStored || !W.__next_r) return url
  try {
    const u = new URL(String(url), location.href)
    if (!/^\/_next\/(webpack-)?hmr\b/.test(u.pathname) || u.searchParams.get("id") !== W.__next_r) return url
    nextSocketId = nextSocketId || `${W.__next_r}-retake-${Math.round(performance.timeOrigin + real.perfNow()).toString(36)}${real.random().toString(36).slice(2, 6)}`
    u.searchParams.set("id", nextSocketId)
    return u.href
  } catch {
    return url
  }
}
// A server component edit makes Next's router refetch the page's RSC payload,
// marked `next-hmr-refresh: 1`. It's the dev server's doing, not the app's:
// recorded, a later edit's refetch in a frame with a future (after a rewind)
// was answered with the payload of the edit before, and the page kept showing
// old code (F77). It goes to the network, unrecorded, like the HMR socket.
const nextHmrRefresh = (headers) => !!headers && headers.get("next-hmr-refresh") === "1"

// A live request from such a page: [input, init] naming its socket, not the page.
const HTML_ID = "x-nextjs-html-request-id"
function nextLiveInit(input, init) {
  if (!nextSocketId) return [input, init]
  try {
    if (init && init.headers) {
      const h = new Headers(init.headers)
      if (h.get(HTML_ID) !== W.__next_r) return [input, init]
      h.set(HTML_ID, nextSocketId)
      return [input, { ...init, headers: h }]
    }
    if (typeof Request !== "undefined" && input instanceof Request && input.headers.get(HTML_ID) === W.__next_r) {
      const r = new Request(input, init)
      r.headers.set(HTML_ID, nextSocketId)
      return [r, undefined]
    }
  } catch {}
  return [input, init]
}

// A page served as it was recorded: its debug data comes from the recording.
let nextDocSent = false
function nextDocReplay() {
  if (nextDocSent || !nextOn() || !RT.docStored || !W.__next_r || !rec) return
  nextDocSent = true
  const seg = segmentsOf().find((s) => s.doc === RT.docId)
  for (const b64 of (seg && seg.docDebug) || []) nextQueue.push([W.__next_r, fromB64(b64)])
  nextQueue.push([W.__next_r, null])
}

// A replayed request's answer starts: its debug data goes to Next.
function nextReplayStart(entry, headers) {
  const id = nextId(headers)
  if (!id) return
  for (const b64 of entry.debug || []) nextQueue.push([id, fromB64(b64)])
  flushNext()
}
// ...and ends: so does its debug stream.
function nextReplayEnd(headers) {
  const id = nextId(headers)
  if (!id) return
  nextQueue.push([id, null])
  flushNext()
}
function flushNext() {
  if (!nextQueue.length) return
  let ws = null
  for (const w of devSockets) if (/\/_next\/hmr\b/.test(w.url) && w.readyState === 1) ws = w
  if (!ws) return // sent once the socket opens (see 35-network.js)
  for (const [id, chunk] of nextQueue.splice(0)) {
    const idBytes = new TextEncoder().encode(id)
    if (idBytes.length > 255) continue
    const data = new Uint8Array(2 + idBytes.length + (chunk ? chunk.length : 0))
    data[1] = idBytes.length
    data.set(idBytes, 2)
    if (chunk) data.set(chunk, 2 + idBytes.length)
    nextOwn = true
    try {
      ws.dispatchEvent(new MessageEvent("message", { data: data.buffer, origin: new URL(ws.url).origin }))
    } catch {} finally {
      nextOwn = false
    }
  }
}
