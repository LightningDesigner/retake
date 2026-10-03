// The front server: Retake in front of any dev server (Next, Nuxt, React
// Router, Astro, SvelteKit, a Vite SPA...). It listens on Retake's port and
// proxies to the app's dev server ("upstream"):
//
//   /__retake/health          200 once the upstream has answered, 503 before
//   /__retake/*               the session API (no code-version routes here)
//   Service-Worker: script    404 (a worker would take the dock's origin over)
//   a top-level page load     the dock (no app code on it)
//   the dock's frame          the app's page, with the runtime injected
//   anything else             streamed through untouched (assets, data
//                             fetches, server actions, API routes, SSE)
//   WebSocket upgrades        a raw socket pipe (HMR)
//
// Every frame document is also kept as it came (.retake/docs/<id>), and the
// runtime told its id (RT.docId). A rebuild asks for the copy its recording
// was made on with a one-shot `__retake_doc=<id>` cookie (the dock sets it
// before it loads the frame), so it isn't rendered again by a server whose
// data or clock has moved on (F56). The cookie never reaches the dev server.
//
// A kept copy is only served while the project's code is the one it was
// rendered with: once a source file changes after it was kept, a build gets
// the page rendered again (old HTML with new client code never hydrates).
//
// The dock's frame is known by its request headers (Sec-Fetch-Dest: iframe),
// not by its URL, so the app never sees a `__wb` marker (CONTRACT.md "Front
// server"). Browsers without Sec-Fetch-* headers get the URL marker instead,
// stripped before the upstream sees it.
//
// Only requests for localhost, *.localhost, an IP address or the --host given
// are served (like Vite's allowedHosts): through DNS rebinding a web page
// could otherwise read the dock's token and the recordings.
import crypto from "node:crypto"
import fs from "node:fs"
import http from "node:http"
import https from "node:https"
import net from "node:net"
import path from "node:path"
import tls from "node:tls"
import { injectHtml, runtimeScript, runtimeTag, scriptHash, shellHtml } from "../core.js"
import { createBus, createSessionHandler, writeServerInfo } from "./api.js"
import { frontRuntime } from "./detect.js"

const HOP = new Set(["connection", "keep-alive", "proxy-connection", "transfer-encoding", "upgrade", "te", "trailer", "proxy-authenticate", "proxy-authorization"])
const WAIT_MS = 60_000 // how long a frame request waits for a dev server that isn't up yet

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const DOC_ID = /^[0-9a-f]{16}$/
const DOCS_KEPT = 200 // stored frame documents (oldest go first)

// The `__retake_doc` cookie out of a Cookie header: [id, the header without it].
function docCookie(header) {
  if (!header) return [null, header]
  /** @type {string | null} */
  let id = null
  const rest = String(header)
    .split(";")
    .filter((part) => {
      const m = /^\s*__retake_doc=([^;]*)$/.exec(part)
      if (m) id = m[1].trim()
      return !m
    })
    .join(";")
    .trim()
  return [id && DOC_ID.test(id) ? id : null, rest]
}
const isHtml = (type) => /^\s*text\/html\b/i.test(type || "")

// Is a Host header one Retake answers to? `extra`: more names (Set), or true for any.
export function hostAllowed(header, extra) {
  if (header == null || extra === true) return true // (no Host: not a browser)
  const name = String(header).trim().toLowerCase().replace(/:\d+$/, "").replace(/^\[(.*)\]$/, "$1").replace(/\.$/, "")
  if (name === "localhost" || name.endsWith(".localhost") || net.isIP(name)) return true
  return !!(extra && extra.has(name))
}

// Folders a project's source changes aren't in: dependencies, build output,
// the frameworks' generated files, and Retake's own.
const NOT_SOURCE = /(^|[\\/])(node_modules|\.git|\.retake|\.next|\.nuxt|\.output|\.svelte-kit|\.astro|\.react-router|\.vercel|\.netlify|\.turbo|\.cache|\.vite|dist|build|coverage)([\\/]|$)|\.(log|tmp|swp)$|~$/

// Does a CSP source list let an inline <script> run as it is?
function inlineAllowed(list) {
  const l = ` ${list} `
  if (/'nonce-|'sha(256|384|512)-|'strict-dynamic'/i.test(l)) return false // 'unsafe-inline' is ignored then
  return /'unsafe-inline'/i.test(l)
}

/**
 * The CSP of a frame document, made to let the injected runtime run and the
 * dock frame the page. Returns { csp, nonce } (csp null: drop the header).
 * Framing that already allows the dock (same origin) is left alone.
 */
export function adaptCsp(csp, script) {
  if (!csp) return { csp, nonce: null }
  // Several policies in one header: too many to reason about; dev only, drop it.
  if (/,/.test(csp.replace(/'[^']*'/g, ""))) return { csp: null, nonce: null }
  const dirs = csp.split(";").map((d) => d.trim()).filter(Boolean)
  const find = (name) => dirs.findIndex((d) => d.toLowerCase().split(/\s+/)[0] === name)
  /** @type {string | null} */
  let nonce = null
  // The directive that rules an inline <script>: script-src-elem, script-src, then default-src.
  const at = [find("script-src-elem"), find("script-src"), find("default-src")].find((i) => i >= 0)
  if (at != null) {
    const list = dirs[at].replace(/^\S+/, "")
    const m = /'nonce-([^']+)'/.exec(list)
    if (m) nonce = m[1]
    else if (!inlineAllowed(list)) {
      if (/'none'/i.test(list)) dirs[at] = dirs[at].replace(/'none'/i, "")
      dirs[at] += ` ${scriptHash(script)}`
    }
  }
  const fa = find("frame-ancestors")
  if (fa >= 0) {
    const list = dirs[fa].replace(/^\S+/, "")
    if (/'none'/i.test(list)) dirs[fa] = "frame-ancestors 'self'"
    else if (!/'self'|\*/.test(list)) dirs[fa] += " 'self'"
  }
  return { csp: dirs.join("; "), nonce }
}

/**
 * @param {{ upstream: string | Promise<string>, port?: number, host?: string,
 *   root: string, token?: string, rt?: object, verbose?: boolean, label?: string,
 *   quiet?: boolean, framework?: string, dir?: string, watch?: string | null,
 *   allowedHosts?: string[] | true }} options
 *   `upstream`: the dev server's URL, or a promise of it (a dev command that
 *   hasn't said where it listens yet). `label`: what to call it on the waiting
 *   page ("next dev on :3015"). `framework` (detect.js), and the project `dir`
 *   it's in, pick the runtime's setup (frontRuntime); unknown, a Next dev
 *   server is recognised by its first page. `rt` overrides any of it.
 *   `watch`: the project folder whose source changes retire kept pages (default
 *   `dir`). `allowedHosts`: more Host names to answer to (true: any).
 * @returns {Promise<{ url: string, port: number, token: string, readonly upstream: string | null, readonly healthy: boolean, close(): Promise<void> }>}
 */
export async function startFront(options) {
  const { root, verbose = false, quiet = false } = options
  const token = options.token || crypto.randomBytes(16).toString("hex")
  // The runtime's setup for this framework. Fronting a bare URL or a dev
  // command, Next is recognised by its first page's X-Powered-By.
  let framework = options.framework || null
  let rtBase = { ...frontRuntime(framework, options.dir), ...options.rt }
  const sniff = (h) => {
    if (framework || !/next\.js/i.test(String(h["x-powered-by"] || ""))) return
    framework = "next"
    rtBase = { ...frontRuntime(framework, options.dir), ...options.rt }
  }
  const bus = createBus()
  const api = createSessionHandler({ root, token, bus })
  const hosts = options.allowedHosts === true ? true : new Set([options.host, ...(options.allowedHosts || [])].filter(Boolean).map((h) => String(h).toLowerCase()))
  /** @type {URL | null} */
  let UP = null // URL of the upstream, once known
  const upstreamKnown = Promise.resolve(options.upstream).then((u) => (UP = new URL(u)))
  upstreamKnown.catch(() => {})
  const agents = {
    "http:": new http.Agent({ keepAlive: true }),
    "https:": new https.Agent({ keepAlive: true, rejectUnauthorized: false }),
  }

  // --verbose: JSON lines in <root>/.retake/front.log.
  const T0 = Date.now()
  /** @type {import("node:fs").WriteStream | null} */
  let logStream = null
  if (verbose) {
    fs.mkdirSync(path.join(root, ".retake"), { recursive: true })
    logStream = fs.createWriteStream(path.join(root, ".retake", "front.log"), { flags: "a" })
  }
  const log = (o) => logStream && logStream.write(JSON.stringify({ t: Date.now() - T0, ...o }) + "\n")
  const warned = new Set()
  const warnOnce = (key, msg) => {
    if (warned.has(key) || quiet) return
    warned.add(key)
    console.warn(`retake: ${msg}`)
  }

  // ---- health: has the upstream answered anything yet? ---------------------
  let healthy = false
  /** @type {Promise<unknown> | null} */
  let probing = null
  const probe = () => {
    if (healthy || probing || !UP) return
    probing = new Promise((resolve) => {
      const r = request({ method: "GET", path: "/", headers: { accept: "text/html", "user-agent": "retake-health" } }, (res) => {
        healthy = true
        res.resume()
        resolve(undefined)
      })
      r.setTimeout(WAIT_MS, () => r.destroy())
      r.on("error", resolve)
      r.end()
    }).then(() => (probing = null))
  }
  // Only once the upstream is known (UP).
  const request = (opts, cb) => {
    const up = /** @type {URL} */ (UP)
    const lib = up.protocol === "https:" ? https : http
    return lib.request({ host: up.hostname, port: up.port || (up.protocol === "https:" ? 443 : 80), agent: agents[up.protocol], autoSelectFamily: true, ...opts }, cb)
  }

  // ---- proxying ------------------------------------------------------------
  const ourOrigin = (req) => `${req.socket.encrypted ? "https" : "http"}://${req.headers.host}`
  // A redirect in a URL-marked frame keeps the marker (`wb`), or the page it
  // goes to would be the dock again, inside the dock.
  const rewriteLocation = (loc, req, wb) => {
    try {
      const absolute = /^[a-z][a-z0-9+.-]*:/i.test(loc) || loc.startsWith("//")
      const up = /** @type {URL} */ (UP)
      const u = new URL(loc, absolute ? up : ourOrigin(req) + req.url)
      const ours = u.host === up.host || u.host === req.headers.host
      if (!ours || !/^https?:/.test(u.protocol)) return loc
      if (wb) u.searchParams.set("__wb", "app")
      if (absolute) return ourOrigin(req) + u.pathname + u.search + u.hash
      if (wb) return u.pathname + u.search + u.hash
    } catch {}
    return loc
  }
  const upstreamPath = (req, url) => {
    if (!url.searchParams.has("__wb")) return req.url
    url.searchParams.delete("__wb")
    return url.pathname + url.search
  }

  let seq = 0
  /**
   * @param {any} req
   * @param {any} res
   * @param {{ frame: boolean, marker?: "url" | "header", why?: string }} how
   */
  async function forward(req, res, { frame, marker, why }) {
    const id = ++seq
    const t0 = performance.now()
    const url = new URL(req.url, "http://x")
    const headers = {}
    let docId = null
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const k = req.rawHeaders[i]
      let v = req.rawHeaders[i + 1]
      // Our one-shot cookie is ours: the dev server never sees it.
      if (k.toLowerCase() === "cookie") {
        ;[docId, v] = docCookie(v)
        if (!v) continue
      }
      if (!HOP.has(k.toLowerCase())) headers[k] = headers[k] != null ? `${headers[k]}${k.toLowerCase() === "cookie" ? "; " : ", "}${v}` : v
    }
    // Keep the browser's Host: Next builds redirects and checks a Server
    // Action's Origin and its dev origins against it; Vite checks allowedHosts.
    headers["X-Forwarded-Host"] = req.headers.host || ""
    headers["X-Forwarded-Proto"] = req.socket.encrypted ? "https" : "http"
    headers["X-Forwarded-Port"] = String(req.socket.localPort)
    if (frame) {
      for (const k of Object.keys(headers)) if (/^(accept-encoding|if-none-match|if-modified-since)$/i.test(k)) delete headers[k]
      headers["Accept-Encoding"] = "identity"
    }
    const pathq = upstreamPath(req, url)
    // A rebuild asking for the page as it was recorded.
    if (frame && docId && req.method === "GET" && serveStored(req, res, { docId, pathq, marker, id, t0 })) return
    // (Not served from a copy: the one-shot cookie still goes.)
    const clearDoc = frame && docId ? `__retake_doc=; Path=${url.pathname}; Max-Age=0; SameSite=Strict` : null
    const replayable = req.method === "GET" || req.method === "HEAD"
    const deadline = Date.now() + WAIT_MS
    // A dev server that isn't up yet (or not known yet): page loads wait for it.
    if (!UP) {
      await Promise.race([upstreamKnown, sleep(WAIT_MS)]).catch(() => {})
      if (!UP) return waiting(res)
    }
    /** @type {import("node:http").ClientRequest | null} */
    let current = null
    res.on("close", () => {
      if (!res.writableFinished && current) current.destroy()
    })
    const attempt = () => {
      const up = (current = request({ method: req.method, path: pathq, headers }, (r) => onResponse(r)))
      up.on("error", async (/** @type {NodeJS.ErrnoException} */ e) => {
        if (replayable && !res.headersSent && (e.code === "ECONNREFUSED" || e.code === "ECONNRESET") && Date.now() < deadline && !req.destroyed) {
          await sleep(250)
          return attempt()
        }
        log({ kind: "http", id, method: req.method, url: req.url, err: e.code || e.message })
        if (replayable && !res.headersSent && e.code === "ECONNREFUSED") return waiting(res)
        if (!res.headersSent) {
          res.writeHead(502, { "content-type": "text/plain; charset=utf-8" })
          res.end(`retake: the dev server at ${UP?.href} didn't answer (${e.code || e.message})`)
        } else res.destroy()
      })
      if (replayable) up.end()
      else req.pipe(up)
    }
    const onResponse = (r) => {
      healthy = true
      const h = { ...r.headers }
      for (const k of Object.keys(h)) if (HOP.has(k)) delete h[k]
      if (h.location) h.location = rewriteLocation(h.location, req, frame && marker === "url")
      if (clearDoc) h["set-cookie"] = [...[].concat(h["set-cookie"] || []), clearDoc]
      const bodyless = req.method === "HEAD" || r.statusCode === 204 || r.statusCode === 304 || r.statusCode < 200
      const inject = frame && isHtml(h["content-type"]) && !bodyless
      if (inject) sniff(h)
      const done = (extra) =>
        log({ kind: "http", id, method: req.method, url: req.url, up: pathq !== req.url ? pathq : undefined, dest: req.headers["sec-fetch-dest"], status: r.statusCode, inject: inject || undefined, why, ms: Math.round(performance.now() - t0), loc: h.location, ...extra })
      // The dev server dropping the answer mid-body (a restart, a crash) drops
      // the browser's too: an EventSource then reconnects, and a cut-off page
      // doesn't load for ever.
      r.on("close", () => {
        if (r.complete || res.writableFinished) return
        log({ kind: "http", id, method: req.method, url: req.url, err: "upstream closed mid-body" })
        res.destroy()
      })
      if (!inject) {
        res.writeHead(r.statusCode, r.statusMessage, h)
        r.pipe(res)
        r.on("end", () => done())
        return
      }
      const stored = keepDoc(r, pathq)
      const rt = { ...rtBase, marker, ...(stored ? { docId: stored } : {}) }
      const script = runtimeScript(rt)
      /** @type {string | null} */
      let nonce = null
      if (h["content-security-policy"]) {
        const a = adaptCsp(h["content-security-policy"], script)
        nonce = a.nonce
        if (a.csp) h["content-security-policy"] = a.csp
        else delete h["content-security-policy"]
      }
      // Framing: SAMEORIGIN already lets the dock (same origin through us) frame it.
      const xfo = String(h["x-frame-options"] || "").toLowerCase()
      if (xfo && xfo !== "sameorigin") delete h["x-frame-options"]
      const encoding = h["content-encoding"]
      delete h["content-encoding"]
      delete h["content-length"]
      delete h.etag
      h["cache-control"] = "no-store"
      if (!/charset=/i.test(h["content-type"])) h["content-type"] = `${h["content-type"].trim()}; charset=utf-8`
      let t
      try {
        t = injectHtml(runtimeTag({ script, nonce }), { encoding })
      } catch (err) {
        warnOnce("enc", err.message)
        res.writeHead(502, { "content-type": "text/plain; charset=utf-8" })
        r.resume()
        return res.end(`retake: ${err.message}`)
      }
      res.writeHead(r.statusCode, r.statusMessage, h)
      t.on("error", () => res.destroy())
      r.pipe(t).pipe(res)
      t.on("end", () => done())
    }
    attempt()
  }

  // ---- frame documents, kept for rebuilds (F56) -------------------------------
  const docsDir = path.join(root, ".retake", "docs")
  let docsWritten = 0
  // When the project's source last changed (kept pages from before it are stale).
  let codeChangedAt = 0
  const watchers = []
  const watchDir = options.watch !== undefined ? options.watch : options.dir
  if (watchDir) {
    // The folder's own files, and each source folder in it recursively
    // (never node_modules: on Linux a recursive watch walks every folder).
    const watch = (p, recursive) => {
      try {
        const w = fs.watch(p, { recursive }, (_, file) => {
          if (file && NOT_SOURCE.test(String(file))) return
          codeChangedAt = Date.now()
        })
        w.on("error", () => {})
        watchers.push(w)
      } catch {} // can't watch it: its edits don't retire kept pages
    }
    watch(watchDir, false)
    try {
      for (const e of fs.readdirSync(watchDir, { withFileTypes: true })) if (e.isDirectory() && !NOT_SOURCE.test(e.name)) watch(path.join(watchDir, e.name), true)
    } catch {}
  }
  // Keep this response's body (as it comes, still encoded) and what it was;
  // returns its id, or null if it can't be kept.
  function keepDoc(r, pathq) {
    try {
      fs.mkdirSync(docsDir, { recursive: true })
      const docId = crypto.randomBytes(8).toString("hex")
      const headers = { ...r.headers }
      for (const k of Object.keys(headers)) if (HOP.has(k) || k === "set-cookie") delete headers[k]
      fs.writeFileSync(path.join(docsDir, `${docId}.json`), JSON.stringify({ path: pathq, status: r.statusCode, headers, kept: Date.now() }))
      const out = fs.createWriteStream(path.join(docsDir, `${docId}.body`))
      out.on("error", () => {})
      r.on("data", (c) => out.write(c))
      r.on("end", () => out.end())
      // Cut off: not a page to build from.
      r.on("close", () => {
        if (r.complete) return
        out.destroy()
        for (const ext of ["json", "body"]) fs.rmSync(path.join(docsDir, `${docId}.${ext}`), { force: true })
      })
      if (++docsWritten % 20 === 0) pruneDocs()
      return docId
    } catch {
      return null
    }
  }
  function pruneDocs() {
    try {
      const metas = fs
        .readdirSync(docsDir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => ({ f, t: fs.statSync(path.join(docsDir, f)).mtimeMs }))
        .sort((a, b) => b.t - a.t)
      for (const { f } of metas.slice(DOCS_KEPT)) {
        fs.rmSync(path.join(docsDir, f), { force: true })
        fs.rmSync(path.join(docsDir, f.replace(/\.json$/, ".body")), { force: true })
      }
    } catch {}
  }
  // Serve a kept copy (true), or nothing if there isn't one for this page.
  function serveStored(req, res, { docId, pathq, marker, id, t0 }) {
    let meta
    try {
      meta = JSON.parse(fs.readFileSync(path.join(docsDir, `${docId}.json`), "utf8"))
      if (meta.path !== pathq || !fs.existsSync(path.join(docsDir, `${docId}.body`))) return false
    } catch {
      return false
    }
    // Rendered with code that has changed since: rendered again instead.
    if (!(meta.kept > codeChangedAt)) {
      log({ kind: "doc-stale", id, docId, url: req.url })
      return false
    }
    const h = { ...meta.headers }
    const script = runtimeScript({ ...rtBase, marker, docId, docStored: true })
    /** @type {string | null} */
    let nonce = null
    if (h["content-security-policy"]) {
      const a = adaptCsp(h["content-security-policy"], script)
      nonce = a.nonce
      if (a.csp) h["content-security-policy"] = a.csp
      else delete h["content-security-policy"]
    }
    const xfo = String(h["x-frame-options"] || "").toLowerCase()
    if (xfo && xfo !== "sameorigin") delete h["x-frame-options"]
    const encoding = h["content-encoding"]
    for (const k of ["content-encoding", "content-length", "etag"]) delete h[k]
    h["cache-control"] = "no-store"
    h["x-retake-doc"] = "stored"
    // One shot: the cookie goes as it's used.
    h["set-cookie"] = `__retake_doc=; Path=${new URL(pathq, "http://x").pathname}; Max-Age=0; SameSite=Strict`
    let t
    try {
      t = injectHtml(runtimeTag({ script, nonce }), { encoding })
    } catch {
      return false
    }
    res.writeHead(meta.status, h)
    const body = fs.createReadStream(path.join(docsDir, `${docId}.body`))
    body.on("error", () => res.destroy())
    t.on("error", () => res.destroy())
    body.pipe(t).pipe(res)
    t.on("end", () => log({ kind: "http", id, method: req.method, url: req.url, dest: req.headers["sec-fetch-dest"], status: meta.status, inject: true, stored: docId, ms: Math.round(performance.now() - t0) }))
    return true
  }

  // A page that says what it's waiting for and tries again every 2 s.
  function waiting(res) {
    if (res.headersSent) return res.destroy()
    const what = options.label || (UP ? `the dev server at ${UP.href}` : "the dev server")
    res.writeHead(503, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "retry-after": "2" })
    res.end(
      `<!doctype html><meta charset="utf-8"><title>Waiting for the dev server</title>` +
        `<body style="font:14px system-ui;color:#555;display:grid;place-items:center;height:90vh;margin:0">` +
        `<p>Waiting for ${what.replace(/[<&]/g, (c) => (c === "<" ? "&lt;" : "&amp;"))}…</p>` +
        `<script>setTimeout(function(){location.reload()},2000)</script>`,
    )
  }

  const NESTED = new Set(["iframe", "frame"])
  function refuse(req, res) {
    warnOnce("host", `refused a request for host "${req.headers.host}" (only localhost is served)`)
    res.writeHead(403, { "content-type": "text/plain; charset=utf-8" })
    res.end(`Blocked request. This host (${JSON.stringify(String(req.headers.host))}) is not allowed.`)
  }
  async function onRequest(req, res) {
    req.socket.setNoDelay(true)
    if (!hostAllowed(req.headers.host, hosts)) return refuse(req, res)
    let url
    try {
      url = new URL(req.url, "http://x")
    } catch {
      res.writeHead(400)
      return res.end()
    }
    const p = url.pathname
    if (p === "/__retake/health") {
      probe()
      if (probing && !healthy) await Promise.race([probing, sleep(1500)])
      res.writeHead(healthy ? 200 : 503, { "content-type": "application/json", "cache-control": "no-store" })
      return res.end(JSON.stringify({ ok: healthy, upstream: UP ? UP.href : null }))
    }
    if (p.startsWith("/__retake/")) return api(req, res)
    if (req.headers["service-worker"] === "script") {
      warnOnce("sw", `blocked a service worker (${p}): it would take over the dock's pages. Service workers are off while Retake is in front.`)
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" })
      return res.end("retake: service workers are off while Retake is in front")
    }
    const mode = req.headers["sec-fetch-mode"]
    const dest = req.headers["sec-fetch-dest"]
    const site = req.headers["sec-fetch-site"]
    const wb = url.searchParams.get("__wb")
    const optOut = url.searchParams.get("retake") === "0"
    const get = req.method === "GET"
    // The dock: a top-level page load. A cross-site one (an OAuth callback)
    // gets the plain page, so sign-in completes; a reload brings the dock back.
    if (get && !wb && !optOut && mode === "navigate" && dest === "document" && site !== "cross-site") {
      log({ kind: "dock", url: req.url })
      return dock(res, "header")
    }
    // No Sec-Fetch-* at all (an older Safari): the dock with the URL marker,
    // unless the dock's frame is what navigated (its URL has the marker; a
    // browser without the Navigation API doesn't put it on every link).
    if (get && !wb && !optOut && !dest && !mode && /text\/html/.test(req.headers.accept || "")) {
      if (fromFrame(req)) return forward(req, res, { frame: true, marker: "url", why: "url-marker-referer" })
      log({ kind: "dock", url: req.url, marker: "url" })
      return dock(res, "url")
    }
    if (wb === "app") return forward(req, res, { frame: true, marker: "url", why: "url-marker" })
    if (mode === "navigate" && NESTED.has(dest) && !optOut) return forward(req, res, { frame: true, marker: "header", why: dest })
    return forward(req, res, { frame: false })
  }

  function fromFrame(req) {
    try {
      const ref = new URL(req.headers.referer)
      return ref.host === req.headers.host && ref.searchParams.get("__wb") === "app"
    } catch {
      return false
    }
  }

  function dock(res, marker) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" })
    res.end(shellHtml({ token, marker, docs: true }))
  }

  // ---- WebSockets (HMR): a raw pipe -----------------------------------------
  async function onUpgrade(req, sock, head) {
    sock.on("error", () => {})
    if (!hostAllowed(req.headers.host, hosts)) {
      warnOnce("host", `refused a request for host "${req.headers.host}" (only localhost is served)`)
      return sock.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n")
    }
    if (!UP) await Promise.race([upstreamKnown, sleep(WAIT_MS)]).catch(() => {})
    if (!UP) return sock.destroy()
    const url = new URL(req.url, "http://x")
    const pathq = upstreamPath(req, url)
    const port = Number(UP.port || (UP.protocol === "https:" ? 443 : 80))
    const opts = { host: UP.hostname, port, autoSelectFamily: true }
    const up = UP.protocol === "https:" ? tls.connect({ ...opts, servername: UP.hostname, rejectUnauthorized: false }) : net.connect(opts)
    up.once(UP.protocol === "https:" ? "secureConnect" : "connect", () => {
      up.setNoDelay(true)
      sock.setNoDelay(true)
      const lines = [`${req.method} ${pathq} HTTP/1.1`]
      for (let i = 0; i < req.rawHeaders.length; i += 2) lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`)
      up.write(lines.join("\r\n") + "\r\n\r\n")
      if (head && head.length) up.write(head)
      sock.pipe(up).pipe(sock)
      log({ kind: "ws-open", url: req.url })
    })
    // Either side closing (or half-closing: HTTP server sockets allow half-open) ends both.
    const both = () => {
      sock.destroy()
      up.destroy()
    }
    for (const s of [sock, up]) for (const e of ["end", "close", "error"]) s.on(e, both)
    sockets.add(sock)
    sock.on("close", () => sockets.delete(sock))
  }
  const sockets = new Set()

  // ---- listening -----------------------------------------------------------
  // On localhost only (both families, so http://localhost works however it
  // resolves), like Vite: the session API serves recordings without a token.
  const servers = []
  const make = () => {
    const s = http.createServer(onRequest)
    s.on("upgrade", onUpgrade)
    s.requestTimeout = 0 // long uploads and streams are fine
    s.keepAliveTimeout = 30_000
    return s
  }
  const listen = (s, port, host) =>
    new Promise((resolve, reject) => {
      s.once("error", reject)
      s.listen(port, host, () => {
        s.off("error", reject)
        resolve(s.address().port)
      })
    })
  const host = options.host || "127.0.0.1"
  const first = make()
  const port = await listen(first, options.port ?? 0, host)
  servers.push(first)
  if (!options.host) {
    const v6 = make()
    try {
      await listen(v6, port, "::1")
      servers.push(v6)
    } catch (err) {
      if (err.code === "EADDRINUSE") {
        await new Promise((r) => first.close(r))
        throw err
      } // no IPv6 loopback: fine
    }
  }
  const url = `http://localhost:${port}`
  writeServerInfo({ root, url, token })
  upstreamKnown.then(() => {
    log({ kind: "start", upstream: UP?.href, port })
    probe()
  }, () => {})

  return {
    url,
    port,
    token,
    get upstream() {
      return UP ? UP.href : null
    },
    get healthy() {
      return healthy
    },
    async close() {
      api.close()
      for (const w of watchers) w.close()
      for (const s of sockets) s.destroy()
      for (const a of Object.values(agents)) a.destroy()
      await Promise.all(
        servers.map(
          (s) =>
            new Promise((r) => {
              s.close(() => r(undefined))
              s.closeAllConnections && s.closeAllConnections()
            }),
        ),
      )
      if (logStream) logStream.end()
      try {
        const f = path.join(root, ".retake", "server.json")
        if (JSON.parse(fs.readFileSync(f, "utf8")).url === url) fs.rmSync(f, { force: true })
      } catch {}
    },
  }
}
