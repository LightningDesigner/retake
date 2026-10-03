// The dev side of `retake-dev/next` (next.js): Retake from a Next.js app's
// own middleware (Next 16's proxy.ts, Next 15's middleware.ts with the
// Node.js runtime), on the app's own dev server. Loaded by next.js at run time
// in `next dev` only. Per request, like the front server (server/front.js):
//
//   x-retake-internal / x-retake-front   passed on (our own fetch below, or
//                                        Retake's front server in front)
//   /__retake/*                          the session API (api.js), in <cwd>/.retake
//   Service-Worker: script               404 (a worker would take the dock's origin over)
//   a top-level page load                the dock (header marker)
//   the dock's frame (Sec-Fetch-Dest: iframe)
//                                        the page, fetched from this server with
//                                        x-retake-internal, the runtime injected
//                                        as its first script
//   anything else                        passed on
//
// What a middleware module holds is lost when Next compiles it again, so the
// token and the session API live on globalThis for the life of the server.
import crypto from "node:crypto"
import { Readable } from "node:stream"
import { injectHtml, runtimeScript, runtimeTag, shellHtml } from "./core.js"
import { createBus, createSessionHandler, writeServerInfo } from "./server/api.js"
import { frontRuntime } from "./server/detect.js"
import { adaptCsp, hostAllowed } from "./server/front.js"

const INTERNAL = "x-retake-internal"
const FRONT = "x-retake-front"
const HOP = new Set(["connection", "keep-alive", "proxy-connection", "transfer-encoding", "upgrade", "te", "trailer", "proxy-authenticate", "proxy-authorization", "host", "content-length"])
const NESTED = new Set(["iframe", "frame"])
const VARY = "Sec-Fetch-Dest, Sec-Fetch-Mode"
const KEY = Symbol.for("retake-dev/next")

/**
 * @typedef {{ root: string, token: string, api: ReturnType<typeof createSessionHandler>, rt: import("../types/index.js").RuntimeConfig, url: string | null }} State
 */
/** @returns {State} */
function state() {
  const g = /** @type {any} */ (globalThis)
  if (g[KEY]) return g[KEY]
  const root = process.env.RETAKE_ROOT || process.cwd()
  const token = crypto.randomBytes(16).toString("hex")
  const bus = createBus()
  return (g[KEY] = { root, token, api: createSessionHandler({ root, token, bus }), rt: { ...frontRuntime("next", root), marker: /** @type {"header"} */ ("header") }, url: null })
}

// .retake/server.json, for `retake mcp`: the dev server's URL as the browser uses it.
function announce(s, req) {
  const url = new URL(req.url).origin
  if (s.url === url) return
  const first = !s.url
  s.url = url
  writeServerInfo({ root: s.root, url, token: s.token })
  if (first) console.log(`\n  \x1b[1mRetake\x1b[0m  timeline docked at ${url}\n`)
}

/**
 * Retake's answer to a request in `next dev`, or null to pass it on.
 * @param {Request} req
 * @returns {Promise<Response | null>}
 */
export async function handle(req) {
  const h = req.headers
  if (h.get(INTERNAL) === "1" || h.get(FRONT) === "1") return null
  const url = new URL(req.url)
  const p = url.pathname
  const allowed = hostAllowed(h.get("host") ?? url.host)
  if (p.startsWith("/__retake/")) {
    if (!allowed) return new Response("Blocked request: this host is not allowed.", { status: 403 })
    const s = state()
    announce(s, req)
    return api(s, req, url)
  }
  if (h.get("service-worker") === "script") return new Response("retake: service workers are off while Retake is docked", { status: 404 })
  const mode = h.get("sec-fetch-mode")
  const dest = h.get("sec-fetch-dest")
  if (mode !== "navigate" || !allowed || url.searchParams.get("retake") === "0") return null
  // The dock: a top-level page load. A cross-site one (an OAuth callback) gets the plain page.
  if (req.method === "GET" && dest === "document" && h.get("sec-fetch-site") !== "cross-site") {
    const s = state()
    announce(s, req)
    return new Response(shellHtml({ token: s.token, marker: "header", root: s.root }), {
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", vary: VARY },
    })
  }
  if (dest && NESTED.has(dest)) return frame(state(), req, url)
  return null
}

// The dock's frame: the page as this server renders it, with the runtime first in <head>.
async function frame(s, req, url) {
  const headers = new Headers()
  for (const [k, v] of req.headers) if (!HOP.has(k) && !/^(accept-encoding|if-none-match|if-modified-since)$/.test(k)) headers.set(k, v)
  headers.set(INTERNAL, "1")
  headers.set("accept-encoding", "identity")
  const body = req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer()
  const r = await fetch(url, { method: req.method, headers, body, redirect: "manual", cache: "no-store" })
  const out = new Headers(r.headers)
  const type = out.get("content-type") || ""
  const bodyless = req.method === "HEAD" || r.status === 204 || r.status === 304 || !r.body
  if (!/^\s*text\/html\b/i.test(type) || bodyless) return new Response(r.body, { status: r.status, statusText: r.statusText, headers: out })
  const script = runtimeScript(s.rt)
  /** @type {string | null} */
  let nonce = null
  const csp = out.get("content-security-policy")
  if (csp) {
    const a = adaptCsp(csp, script)
    nonce = a.nonce
    if (a.csp) out.set("content-security-policy", a.csp)
    else out.delete("content-security-policy")
  }
  // Framing: SAMEORIGIN already lets the dock (same origin) frame it.
  const xfo = (out.get("x-frame-options") || "").toLowerCase()
  if (xfo && xfo !== "sameorigin") out.delete("x-frame-options")
  // (fetch has decoded the body already.)
  for (const k of ["content-encoding", "content-length", "etag"]) out.delete(k)
  out.set("cache-control", "no-store")
  out.set("vary", VARY)
  if (!/charset=/i.test(type)) out.set("content-type", `${type.trim()}; charset=utf-8`)
  const t = injectHtml(runtimeTag({ script, nonce }))
  const src = Readable.fromWeb(/** @type {any} */ (r.body))
  src.on("error", (err) => t.destroy(err))
  src.pipe(t)
  return new Response(/** @type {any} */ (Readable.toWeb(t)), { status: r.status, statusText: r.statusText, headers: out })
}

// The session API (api.js's Node handler) for a web Request: a Node-shaped
// request and response around it. Event streams stay open until the browser
// goes (the response body is cancelled).
function api(s, req, url) {
  return new Promise((resolve) => {
    const nodeReq = /** @type {any} */ (req.body ? Readable.fromWeb(/** @type {any} */ (req.body)) : Readable.from([]))
    nodeReq.method = req.method
    nodeReq.url = url.pathname + url.search
    nodeReq.headers = Object.fromEntries(req.headers)
    /** @type {ReadableStreamDefaultController<Uint8Array> | null} */
    let ctl = null
    let closed = false
    const stream = new ReadableStream({
      start(c) {
        ctl = c
      },
      cancel() {
        closed = true
        nodeReq.emit("close")
      },
    })
    const head = new Headers()
    let sent = false
    const res = {
      statusCode: 200,
      setHeader: (k, v) => head.set(k, String(v)),
      getHeader: (k) => head.get(k),
      writeHead(code, h) {
        res.statusCode = code
        for (const [k, v] of Object.entries(h || {})) head.set(k, String(v))
        start()
        return res
      },
      write(chunk) {
        start()
        if (!closed && chunk != null) ctl?.enqueue(typeof chunk === "string" ? new TextEncoder().encode(chunk) : new Uint8Array(chunk))
        return true
      },
      end(chunk) {
        if (chunk != null) res.write(chunk)
        else start()
        if (!closed) {
          closed = true
          ctl?.close()
        }
        return res
      },
    }
    function start() {
      if (sent) return
      sent = true
      resolve(new Response(stream, { status: res.statusCode, headers: head }))
    }
    Promise.resolve(s.api(nodeReq, res)).catch((err) => {
      if (!sent) resolve(new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { "content-type": "application/json" } }))
    })
  })
}
