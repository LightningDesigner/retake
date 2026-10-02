// The front server (src/server/front.js) in front of a tiny node:http "dev
// server" started here: routing by Sec-Fetch-* headers, injection into the
// dock's frame (streamed, compressed, CSP), redirects, sockets, health, and
// the header marker in a browser (no `__wb` anywhere, isAppFrame, an app's own
// iframe stays inert). Ports 3330-3334, 3338.
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import zlib from "node:zlib"
import { test, expect } from "@playwright/test"
import { startFront, adaptCsp } from "../../src/server/front.js"
import { openDock } from "./helpers.js"

const UP_PORT = 3330
const FRONT_PORT = 3331
const seen = [] // every request the upstream got: { method, url, headers }

const PAGE = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`
const HOME = PAGE(
  "Home",
  `<button id="b">0</button> <a id="about" href="/about">about</a> <span id="t"></span>
<iframe id="emb" src="/embed" style="width:200px;height:80px"></iframe>
<script>
  let n = 0
  b.onclick = () => { b.textContent = String(++n) }
  setInterval(() => { t.textContent = String(Date.now() % 1000) }, 100)
</script>`,
)

function upstreamHandler(req, res) {
  seen.push({ method: req.method, url: req.url, headers: req.headers })
  const u = new URL(req.url, "http://x")
  const html = (body, headers = {}, status = 200) => {
    res.writeHead(status, { "content-type": "text/html", ...headers })
    res.end(body)
  }
  switch (u.pathname) {
    case "/":
      // Streamed, with the <head> tag split across two writes.
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
      res.write(HOME.slice(0, HOME.indexOf("<head>") + 3))
      return setTimeout(() => res.end(HOME.slice(HOME.indexOf("<head>") + 3)), 30)
    case "/about":
      return html(PAGE("About", `<p id="about-p">about</p><a id="home" href="/">home</a>`))
    case "/embed":
      return html(PAGE("Embed", `<p id="emb-body">embedded</p>`))
    case "/gzip":
      res.writeHead(200, { "content-type": "text/html", "content-encoding": "gzip" })
      return res.end(zlib.gzipSync(PAGE("gz", "gzipped")))
    case "/br":
      res.writeHead(200, { "content-type": "text/html", "content-encoding": "br" })
      return res.end(zlib.brotliCompressSync(PAGE("br", "brotli")))
    case "/csp-nonce":
      return html(PAGE("n", "x"), { "content-security-policy": "script-src 'nonce-abc123' 'strict-dynamic'" })
    case "/csp-hash":
      return html(PAGE("h", "x"), { "content-security-policy": "default-src 'self'; frame-ancestors 'none'" })
    case "/csp-inline":
      return html(PAGE("i", "x"), { "content-security-policy": "script-src 'self' 'unsafe-inline'; frame-ancestors 'self'" })
    case "/xfo-same":
      return html(PAGE("s", "x"), { "x-frame-options": "SAMEORIGIN" })
    case "/xfo-deny":
      return html(PAGE("d", "x"), { "x-frame-options": "DENY" })
    case "/redirect":
      res.writeHead(302, { location: `http://localhost:${UP_PORT}/about?redirected=1` })
      return res.end()
    case "/redirect-rel":
      res.writeHead(302, { location: "/about" })
      return res.end()
    case "/missing":
      return html(PAGE("404", "not here"), {}, 404)
    case "/data.json":
      res.writeHead(200, { "content-type": "application/json", etag: '"v1"' })
      return res.end('{"ok":true}')
    case "/form":
      return html(PAGE("posted", `method ${req.method}`))
    case "/next-ish":
      return html(PAGE("next", `served ${Date.now()}`), { "x-powered-by": "Next.js", "set-cookie": "s=1; Path=/" })
    case "/late-app":
      // An app that imports itself once the page has loaded (Nuxt's entry, Astro's islands).
      return html(PAGE("late", `<p id="late">not yet</p><script>addEventListener("load", () => import("/late-mod.js"))</script>`))
    case "/late-mod.js":
      res.writeHead(200, { "content-type": "text/javascript", "cache-control": "no-store" })
      return setTimeout(
        () => res.end(`window.__mount = performance.now(); let n = 0; late.textContent = "mounted"; setInterval(() => (late.dataset.n = String(++n)), 250)`),
        120,
      )
    case "/cut-sse":
    case "/cut-page":
      // The dev server going away mid-answer (a restart, a crash).
      res.writeHead(200, { "content-type": u.pathname === "/cut-sse" ? "text/event-stream" : "text/html" })
      res.write(u.pathname === "/cut-sse" ? "data: 1\n\n" : "<!doctype html><html><head><title>cut</title></head><body>" + "x".repeat(4096))
      return setTimeout(() => res.socket.destroy(), 150)
    case "/sw.js":
      res.writeHead(200, { "content-type": "text/javascript" })
      return res.end("self.oninstall = () => {}")
    default:
      return html(PAGE("?", u.pathname), {}, 404)
  }
}

let up
let front
let root
test.beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "retake-front-"))
  up = http.createServer(upstreamHandler)
  // Raw socket echo behind an upgrade, enough to show the pipe works.
  up.on("upgrade", (req, sock) => {
    seen.push({ method: "UPGRADE", url: req.url, headers: req.headers })
    sock.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: echo\r\nConnection: Upgrade\r\n\r\n")
    sock.on("data", (d) => sock.write(d))
    sock.on("end", () => sock.end())
  })
  await new Promise((r) => up.listen(UP_PORT, "127.0.0.1", r))
  front = await startFront({ upstream: `http://localhost:${UP_PORT}`, port: FRONT_PORT, root, quiet: true, verbose: true })
})
test.afterAll(async () => {
  await front?.close()
  if (up) {
    const closed = new Promise((r) => up.close(r))
    up.closeAllConnections()
    await closed
  }
})

// A request with browser-like headers (Node's fetch overwrites Sec-Fetch-*).
function get(p, headers = {}, { method = "GET", body = null, port = FRONT_PORT } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: "127.0.0.1", port, path: p, method, headers: { host: `localhost:${port}`, ...headers } }, (res) => {
      const chunks = []
      res.on("data", (c) => chunks.push(c))
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString("utf8") }))
    })
    r.on("error", reject)
    r.end(body)
  })
}
const TOP = { "sec-fetch-mode": "navigate", "sec-fetch-dest": "document", "sec-fetch-site": "none", accept: "text/html" }
const FRAME = { "sec-fetch-mode": "navigate", "sec-fetch-dest": "iframe", "sec-fetch-site": "same-origin", accept: "text/html" }
const FETCH = { "sec-fetch-mode": "cors", "sec-fetch-dest": "empty", "sec-fetch-site": "same-origin", accept: "*/*" }
const isDock = (r) => r.text.includes('id="wb-dock"')
const injected = (r) => r.text.includes("<script data-retake")

test("routing: dock, frame, plain page, passthrough", async () => {
  // A top-level page load gets the dock, with the header marker.
  const dock = await get("/about", TOP)
  expect(isDock(dock)).toBe(true)
  expect(dock.text).toContain('"marker":"header"')
  expect(dock.text).toMatch(/__RETAKE_TOKEN = "[0-9a-f]{32}"/)
  expect(isDock(await get("/", { ...TOP, "sec-fetch-site": "same-origin" }))).toBe(true)
  // A cross-site top-level navigation (an OAuth callback) gets the plain page.
  const cross = await get("/about", { ...TOP, "sec-fetch-site": "cross-site" })
  expect(isDock(cross) || injected(cross)).toBe(false)
  expect(cross.text).toContain("about-p")
  // ?retake=0 opts out.
  const out = await get("/about?retake=0", TOP)
  expect(isDock(out) || injected(out)).toBe(false)
  // The dock's frame: the page with the runtime, first in <head>, header marker.
  const frame = await get("/about", FRAME)
  expect(frame.text).toMatch(/^<!doctype html><html lang="en"><head><meta charset="utf-8"><script data-retake>/)
  expect(frame.text).toContain('"marker":"header"')
  expect(frame.headers["cache-control"]).toBe("no-store")
  expect(frame.headers["content-type"]).toBe("text/html; charset=utf-8")
  expect(frame.headers["content-length"]).toBeUndefined()
  // A form POST navigation in the frame is a frame document too.
  const post = await get("/form", { ...FRAME, "content-type": "application/x-www-form-urlencoded" }, { method: "POST", body: "a=1" })
  expect(injected(post)).toBe(true)
  expect(post.text).toContain("method POST")
  // Error pages too, so the recording carries on.
  const missing = await get("/missing", FRAME)
  expect(missing.status).toBe(404)
  expect(injected(missing)).toBe(true)
  // Everything else passes through untouched (headers included).
  const data = await get("/data.json", FETCH)
  expect(data.text).toBe('{"ok":true}')
  expect(data.headers.etag).toBe('"v1"')
  const html = await get("/about", FETCH) // an Astro-style page fetch
  expect(injected(html) || isDock(html)).toBe(false)
  // HEAD gets no body to inject into.
  expect((await get("/about", FRAME, { method: "HEAD" })).text).toBe("")
})

test("no Sec-Fetch-* headers (older Safari): the URL marker, stripped before the app sees it", async () => {
  const dock = await get("/about", { accept: "text/html" })
  expect(isDock(dock)).toBe(true)
  expect(dock.text).not.toContain('"marker":"header"')
  seen.length = 0
  const frame = await get("/about?x=1&__wb=app", { accept: "text/html" })
  expect(injected(frame)).toBe(true)
  expect(frame.text).toContain('"marker":"url"')
  expect(seen.map((s) => s.url).filter((u) => u !== "/")).toEqual(["/about?x=1"]) // ("/": the health probe)
})

test("the app gets the browser's Host and X-Forwarded-*; conditional headers dropped on frames", async () => {
  seen.length = 0
  await get("/about", { ...FRAME, "if-none-match": '"x"', "accept-encoding": "gzip, br" })
  const h = seen.find((r) => r.url === "/about").headers
  expect(h.host).toBe(`localhost:${FRONT_PORT}`)
  expect(h["x-forwarded-host"]).toBe(`localhost:${FRONT_PORT}`)
  expect(h["x-forwarded-proto"]).toBe("http")
  expect(h["x-forwarded-port"]).toBe(String(FRONT_PORT))
  expect(h["if-none-match"]).toBeUndefined()
  expect(h["accept-encoding"]).toBe("identity")
})

test("compressed frame documents are decoded and injected", async () => {
  for (const p of ["/gzip", "/br"]) {
    const r = await get(p, FRAME)
    expect(r.headers["content-encoding"], p).toBeUndefined()
    expect(r.text, p).toMatch(/<head><meta charset="utf-8"><script data-retake>/)
    expect(r.text, p).toContain(p === "/gzip" ? "gzipped" : "brotli")
  }
  // Not a frame: passed through still compressed.
  const raw = await get("/gzip", FETCH)
  expect(raw.headers["content-encoding"]).toBe("gzip")
})

test("CSP: the page's nonce, else a hash; framing only loosened when it would block the dock", async () => {
  const n = await get("/csp-nonce", FRAME)
  expect(n.text).toContain('<script data-retake nonce="abc123">')
  expect(n.headers["content-security-policy"]).toBe("script-src 'nonce-abc123' 'strict-dynamic'")

  const h = await get("/csp-hash", FRAME)
  const csp = h.headers["content-security-policy"]
  expect(csp).toMatch(/^default-src 'self' 'sha256-[A-Za-z0-9+/=]+'; frame-ancestors 'self'$/)
  const script = h.text.match(/<script data-retake>([\s\S]*?)<\/script>/)[1]
  const crypto = await import("node:crypto")
  expect(csp).toContain(`'sha256-${crypto.createHash("sha256").update(script).digest("base64")}'`)

  const i = await get("/csp-inline", FRAME)
  expect(i.headers["content-security-policy"]).toBe("script-src 'self' 'unsafe-inline'; frame-ancestors 'self'")

  expect((await get("/xfo-same", FRAME)).headers["x-frame-options"]).toBe("SAMEORIGIN")
  expect((await get("/xfo-deny", FRAME)).headers["x-frame-options"]).toBeUndefined()

  // Several policies in one header: dropped.
  expect(adaptCsp("script-src 'self', frame-ancestors 'none'", "x").csp).toBe(null)
  expect(adaptCsp("script-src 'none'", "x").csp).toMatch(/^script-src\s+'sha256-/)
  expect(adaptCsp("frame-ancestors https://a.test", "x").csp).toBe("frame-ancestors https://a.test 'self'")
})

test("redirects to the app's origin come back to Retake's", async () => {
  const r = await get("/redirect", FRAME)
  expect(r.status).toBe(302)
  expect(r.headers.location).toBe(`http://localhost:${FRONT_PORT}/about?redirected=1`)
  expect((await get("/redirect-rel", FRAME)).headers.location).toBe("/about")
})

test("a redirect in a URL-marked frame keeps the marker; a page the frame navigates to without it is the frame's, not a dock (F66)", async () => {
  // Older Safari (no Sec-Fetch-*): the marker is the frame's only sign.
  const SAFARI = { accept: "text/html" }
  expect((await get("/redirect-rel?__wb=app", SAFARI)).headers.location).toBe("/about?__wb=app")
  expect((await get("/redirect?__wb=app", SAFARI)).headers.location).toBe(`http://localhost:${FRONT_PORT}/about?redirected=1&__wb=app`)
  // Followed, that's the frame's page again (it was the dock, inside the dock).
  const next = await get("/about?__wb=app", SAFARI)
  expect([isDock(next), injected(next)]).toEqual([false, true])
  // A link the frame follows without the marker (no Navigation API to add it).
  const linked = await get("/about", { ...SAFARI, referer: `http://localhost:${FRONT_PORT}/?__wb=app` })
  expect([isDock(linked), injected(linked)]).toEqual([false, true])
  expect(isDock(await get("/about", { ...SAFARI, referer: `http://localhost:${FRONT_PORT}/` }))).toBe(true)
  // The header marker's redirects are left as they were.
  expect((await get("/redirect-rel", FRAME)).headers.location).toBe("/about")
})

test("only localhost names are served: another Host gets neither the dock's token nor the session API (DNS rebinding, F64)", async () => {
  const evil = { host: "attacker.example" }
  const page = await get("/", { ...TOP, ...evil })
  expect(page.status).toBe(403)
  expect(page.text).not.toContain("__RETAKE_TOKEN")
  expect((await get("/__retake/session", evil)).status).toBe(403)
  expect((await get("/about", { ...FRAME, ...evil })).status).toBe(403)
  expect((await get("/data.json", { ...FETCH, host: `attacker.example:${FRONT_PORT}` })).status).toBe(403)
  const ws = await new Promise((resolve) => {
    const r = http.request({ host: "127.0.0.1", port: FRONT_PORT, path: "/hmr", headers: { host: "attacker.example", connection: "Upgrade", upgrade: "echo" } })
    r.on("upgrade", (res, sock) => (sock.destroy(), resolve(101)))
    r.on("response", (res) => (res.resume(), resolve(res.statusCode)))
    r.on("error", () => resolve(0))
    r.end()
  })
  expect(ws).toBe(403)
  for (const host of [`127.0.0.1:${FRONT_PORT}`, `[::1]:${FRONT_PORT}`, `app.localhost:${FRONT_PORT}`, `LOCALHOST:${FRONT_PORT}`]) {
    expect((await get("/__retake/session", { host })).status, host).toBe(200)
  }
})

test("the dev server dropping an answer mid-body drops the browser's too: streams and frame pages don't hang (F65)", async () => {
  // How the browser's side ends: "aborted" (what a dropped connection looks like), "ended", or "open" after 4 s.
  const outcome = (p, headers) =>
    new Promise((resolve) => {
      const r = http.request({ host: "127.0.0.1", port: FRONT_PORT, path: p, headers: { host: `localhost:${FRONT_PORT}`, ...headers } }, (res) => {
        res.resume()
        res.on("end", () => resolve(res.complete ? "ended" : "aborted"))
        res.on("aborted", () => resolve("aborted"))
        res.on("error", () => resolve("aborted"))
        res.on("close", () => resolve(res.complete ? "ended" : "aborted"))
      })
      r.on("error", () => resolve("aborted"))
      const timer = setTimeout(() => (resolve("open"), r.destroy()), 4000)
      r.on("close", () => clearTimeout(timer))
      r.end()
    })
  expect(await outcome("/cut-sse", { ...FETCH, accept: "text/event-stream" })).toBe("aborted")
  expect(await outcome("/cut-page", FRAME)).toBe("aborted")
  // A page cut off isn't kept to build from.
  const docs = path.join(root, ".retake", "docs")
  await new Promise((r) => setTimeout(r, 100))
  const cut = fs.readdirSync(docs).filter((f) => f.endsWith(".json")).filter((f) => JSON.parse(fs.readFileSync(path.join(docs, f), "utf8")).path === "/cut-page")
  expect(cut).toEqual([])
})

test("WebSocket upgrades are piped both ways; service workers are refused", async () => {
  const echoed = await new Promise((resolve, reject) => {
    const r = http.request({ host: "127.0.0.1", port: FRONT_PORT, path: "/hmr?__wb=app&id=1", headers: { host: `localhost:${FRONT_PORT}`, connection: "Upgrade", upgrade: "echo" } })
    r.on("upgrade", (res, sock) => {
      sock.once("data", (d) => {
        resolve(d.toString())
        sock.destroy()
      })
      sock.write("ping")
    })
    r.on("error", reject)
    r.end()
  })
  expect(echoed).toBe("ping")
  expect(seen.filter((s) => s.method === "UPGRADE").map((s) => s.url)).toContain("/hmr?id=1")

  const sw = await get("/sw.js", { "service-worker": "script", "sec-fetch-dest": "serviceworker" })
  expect(sw.status).toBe(404)
})

test("health waits for the dev server; page loads wait for it to come up", async () => {
  const UP2 = 3332
  const f = await startFront({ upstream: `http://localhost:${UP2}`, port: 3333, root: fs.mkdtempSync(path.join(os.tmpdir(), "retake-front2-")), quiet: true })
  let late
  try {
    expect((await get("/__retake/health", {}, { port: 3333 })).status).toBe(503)
    // A frame load while it's down waits, and gets the page once it's up.
    const pending = get("/about", FRAME, { port: 3333 })
    await new Promise((r) => setTimeout(r, 600))
    late = http.createServer(upstreamHandler)
    await new Promise((r) => late.listen(UP2, "127.0.0.1", r))
    const page = await pending
    expect(page.status).toBe(200)
    expect(injected(page)).toBe(true)
    expect((await get("/__retake/health", {}, { port: 3333 })).status).toBe(200)
  } finally {
    await f.close()
    if (late) {
      const closed = new Promise((r) => late.close(r))
      late.closeAllConnections()
      await closed
    }
  }
})

test("the session API and server.json are served by the front server", async () => {
  const info = JSON.parse(fs.readFileSync(path.join(root, ".retake", "server.json"), "utf8"))
  expect(info.url).toBe(`http://localhost:${FRONT_PORT}`)
  expect(info.token).toBe(front.token)
  expect((await get("/__retake/session")).status).toBe(200)
  expect((await get("/__retake/session", { "content-type": "application/json" }, { method: "PUT", body: "{}" })).status).toBe(403)
  expect((await get("/__retake/version")).status).toBe(404) // no code versions in front mode
  // --verbose: JSON lines
  const lines = fs.readFileSync(path.join(root, ".retake", "front.log"), "utf8").trim().split("\n").map((l) => JSON.parse(l))
  expect(lines.some((l) => l.kind === "http" && l.inject)).toBe(true)
})

test("header marker in a browser: no __wb anywhere, the app's own iframe is inert, rewinds work", async ({ page }) => {
  seen.length = 0
  const h = await openDock(page, `http://localhost:${FRONT_PORT}/`, { fresh: false })
  expect(h.errors).toEqual([])
  const app = await h.liveFrame()
  expect(await app.evaluate(() => location.pathname + location.search)).toBe("/")
  expect(await app.evaluate(() => document.querySelectorAll("script[data-retake]").length)).toBe(0) // took itself out
  expect(await page.evaluate(() => window.__retakeShell.isAppFrame(document.querySelector("#wb-stage iframe.live")))).toBe(true)

  // The app's own <iframe src="/embed"> got the script too (the server can't
  // tell), but it stays inert and gets no dock.
  const emb = app.childFrames()[0]
  await expect.poll(() => emb.evaluate(() => !!document.getElementById("emb-body")).catch(() => false)).toBe(true)
  expect(await emb.evaluate(() => window.__retake && window.__retake.inert)).toBe(true)
  expect(await emb.evaluate(() => !!document.getElementById("wb-dock"))).toBe(false)

  // The frame navigating itself keeps the runtime (Sec-Fetch-Dest: iframe),
  // and rebuilds on either side of the navigation land on the right page.
  await page.waitForTimeout(300)
  await h.click("#b")
  await page.waitForTimeout(500)
  await h.click("#about")
  await expect.poll(() => h.rt(() => location.pathname).catch(() => null)).toBe("/about")
  expect((await h.settle()).recording).toBe(true)
  await expect.poll(() => page.evaluate(() => location.pathname)).toBe("/about") // the address bar follows
  await page.waitForTimeout(300)
  await h.pause()
  const hist = await h.rt(() => __retake.history())
  expect(hist.segments).toHaveLength(1)
  expect(new URL(hist.segments[0].url).pathname + new URL(hist.segments[0].url).search).toBe("/about")
  const end = (await h.state()).now
  await h.seek(hist.segments[0].t - 100)
  expect(await h.rt(() => location.pathname + location.search)).toBe("/")
  expect(await h.rt(() => document.getElementById("b").textContent)).toBe("1")
  await h.seek(end - 1)
  expect(await h.rt(() => location.pathname + location.search)).toBe("/about")

  const leaks = seen.filter((r) => r.url.includes("__wb"))
  expect(leaks).toEqual([])
  expect(seen.filter((r) => r.headers["sec-fetch-dest"] === "iframe").map((r) => r.url)).toEqual(expect.arrayContaining(["/", "/embed", "/about"]))
})

test("an app imported after load has mounted before the clock starts, live and rebuilt (F61)", async ({ page }) => {
  const h = await openDock(page, `http://localhost:${FRONT_PORT}/late-app`)
  await expect.poll(() => h.rt(() => document.getElementById("late").textContent)).toBe("mounted")
  // Its virtual moment: before the clock started (it waited for loading to go quiet).
  const mountAt = () => h.rt(() => window.__mount - (performance.now() - __retake.state().now))
  expect(await mountAt()).toBeLessThan(1)
  await page.waitForTimeout(1300)
  await h.pause()
  const live = await h.rt(() => [__retake.state().now, document.getElementById("late").dataset.n])
  await h.seek(1100)
  expect(await mountAt()).toBeLessThan(1)
  expect(await h.rt(() => document.getElementById("late").dataset.n)).toBe("4")
  expect(Number(live[1])).toBe(Math.floor(live[0] / 250))
})

// The RT config the runtime got, out of an injected page.
const rtOf = (text) => JSON.parse(/const RT = Object\.freeze\((\{.*?\})\);/.exec(text)[1])

test("the runtime's setup: clock at load, scripts held, dev URLs exempt; Next sniffed by X-Powered-By (F47, F48, F54)", async () => {
  const plain = rtOf((await get("/about", FRAME)).text)
  expect(plain).toMatchObject({ marker: "header", bootAt: "load", holdScripts: true, next: null })
  expect(plain.exemptUrls).toContain("^/@vite/client")
  const next = rtOf((await get("/next-ish", FRAME)).text)
  expect(next.exemptUrls).toContain("^/_next/hmr\\b")
  // No project folder to read Next's version from: the runtime asks Next's client (F59).
  expect(next.next).toBe("auto")
  // From then on every page is set up for Next.
  expect(rtOf((await get("/about", FRAME)).text).exemptUrls).toContain("^/__nextjs_")
})

test("kept pages: a frame document is stored, and a build asking with the one-shot cookie gets that copy (F56)", async () => {
  const first = await get("/next-ish", FRAME)
  const { docId } = rtOf(first.text)
  expect(docId).toMatch(/^[0-9a-f]{16}$/)
  await new Promise((r) => setTimeout(r, 100)) // written as it streamed
  expect(fs.existsSync(path.join(root, ".retake", "docs", `${docId}.body`))).toBe(true)
  const n = seen.length
  const again = await get("/next-ish", { ...FRAME, cookie: `a=1; __retake_doc=${docId}; b=2` })
  expect(again.headers["x-retake-doc"]).toBe("stored")
  expect(again.text.replace(/<script data-retake[\s\S]*?<\/script>/, "")).toBe(first.text.replace(/<script data-retake[\s\S]*?<\/script>/, ""))
  expect(rtOf(again.text)).toMatchObject({ docId, docStored: true })
  expect(seen.length).toBe(n) // the dev server wasn't asked
  expect(String(again.headers["set-cookie"])).toMatch(/__retake_doc=; Path=\/next-ish; Max-Age=0/)
  expect(String(again.headers["set-cookie"])).not.toContain("s=1") // the page's own cookies aren't set again
  // Another page with that cookie (not the one kept) goes to the dev server; the cookie never does.
  const other = await get("/about", { ...FRAME, cookie: `a=1; __retake_doc=${docId}; b=2` })
  expect(other.headers["x-retake-doc"]).toBeUndefined()
  expect(seen[seen.length - 1].headers.cookie).toBe("a=1; b=2")
  await get("/data.json", { ...FETCH, cookie: `__retake_doc=${docId}` })
  expect(seen[seen.length - 1].headers.cookie).toBeUndefined()
})

test("a kept page rendered before a source edit isn't served: the build gets the page rendered with the new code (F67)", async () => {
  // Old server HTML with new client code always failed to hydrate.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "retake-front-watch-"))
  fs.mkdirSync(path.join(dir, "app"))
  fs.mkdirSync(path.join(dir, "node_modules"))
  fs.writeFileSync(path.join(dir, "app", "page.jsx"), "v1")
  const f = await startFront({ upstream: `http://localhost:${UP_PORT}`, port: 3338, root: dir, dir, quiet: true })
  try {
    const ask = async (docId) => get("/next-ish", { ...FRAME, cookie: `__retake_doc=${docId}` }, { port: 3338 })
    const before = rtOf((await get("/next-ish", FRAME, { port: 3338 })).text).docId
    await new Promise((r) => setTimeout(r, 300))
    // Not source: dependencies, Retake's own files.
    fs.writeFileSync(path.join(dir, "node_modules", "x.js"), "1")
    await new Promise((r) => setTimeout(r, 300))
    expect((await ask(before)).headers["x-retake-doc"]).toBe("stored")
    fs.writeFileSync(path.join(dir, "app", "page.jsx"), "v2")
    await new Promise((r) => setTimeout(r, 500))
    const n = seen.length
    const again = await ask(before)
    expect(again.headers["x-retake-doc"]).toBeUndefined()
    expect(injected(again)).toBe(true)
    expect(seen.length).toBe(n + 1) // rendered again by the dev server
    expect(String(again.headers["set-cookie"])).toMatch(/__retake_doc=; Path=\/next-ish; Max-Age=0/) // the cookie still goes
    // A page kept after the edit is served as kept.
    const after = rtOf(again.text).docId
    await new Promise((r) => setTimeout(r, 300))
    expect((await ask(after)).headers["x-retake-doc"]).toBe("stored")
  } finally {
    await f.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
