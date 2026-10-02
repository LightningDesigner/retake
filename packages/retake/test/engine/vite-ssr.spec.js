// `plugins: [retake()]` inside a Vite-based server-rendering setup (no
// index.html; the framework writes each page itself, the way React Router,
// SvelteKit or Astro do): the dock for a top-level load, the runtime written
// into the dock's frame, no `__wb` in any URL. A ten-line "framework" plugin
// stands in for the real ones. Port 3337.
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { test, expect } from "@playwright/test"
import { createServer } from "vite"
import { retake } from "../../src/plugin.js"
import { openDock } from "./helpers.js"

const PORT = 3337
const urls = [] // what the framework was asked to render

// Renders every page itself, in two writes, through server.transformIndexHtml
// (some frameworks call it; it must not turn the frame's page into a dock).
const framework = () => ({
  name: "tiny-ssr",
  configureServer(server) {
    return () =>
      server.middlewares.use(async (req, res, next) => {
        const u = new URL(req.url, "http://x")
        if (!(req.headers.accept || "").includes("text/html") || path.extname(u.pathname)) return next()
        urls.push(req.url)
        const body =
          u.pathname === "/embed"
            ? `<p id="emb-body">embedded</p>`
            : `<button id="b">0</button><iframe src="/embed"></iframe><script type="module" src="/main.js"></script>`
        const html = await server.transformIndexHtml(req.url, `<!doctype html><html><head><title>ssr</title></head><body>${body}</body></html>`)
        res.statusCode = 200
        res.setHeader("content-type", "text/html")
        const cut = html.indexOf("<head>") + 3
        res.write(html.slice(0, cut))
        setTimeout(() => res.end(html.slice(cut)), 20)
      })
  },
})

let server
let root
test.beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "retake-vite-ssr-"))
  fs.writeFileSync(path.join(root, "main.js"), `let n = 0\nconst b = document.getElementById("b")\nb.onclick = () => { b.textContent = String(++n) }\n`)
  server = await createServer({
    root,
    configFile: false,
    appType: "custom", // what SSR frameworks set: no SPA fallback, no index.html
    logLevel: "silent",
    cacheDir: path.join(root, ".vite"),
    plugins: [retake({ banner: false }), framework()],
    server: { port: PORT, strictPort: true, host: "localhost" },
  })
  await server.listen()
})
test.afterAll(async () => {
  await server?.close()
})

const get = (p, headers) =>
  new Promise((resolve, reject) => {
    const r = http.get({ host: "localhost", port: PORT, path: p, headers }, (res) => {
      let text = ""
      res.on("data", (c) => (text += c))
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text }))
    })
    r.on("error", reject)
  })

test("a top-level load gets the dock; the frame's page gets the runtime; other pages are left alone", async () => {
  const dock = await get("/x", { "sec-fetch-mode": "navigate", "sec-fetch-dest": "document", "sec-fetch-site": "none", accept: "text/html" })
  expect(dock.text).toContain('id="wb-dock"')
  expect(dock.text).toContain('"marker":"header"')
  expect(dock.text).not.toContain("@vite/client")
  const frame = await get("/x", { "sec-fetch-mode": "navigate", "sec-fetch-dest": "iframe", accept: "text/html" })
  expect(frame.text).toMatch(/^<!doctype html><html><head><script data-retake>/)
  expect(frame.text).toContain("@vite/client") // transformIndexHtml ran, and left the page a page
  expect(frame.headers["cache-control"]).toBe("no-store")
  const plain = await get("/x", { "sec-fetch-mode": "navigate", "sec-fetch-dest": "document", "sec-fetch-site": "cross-site", accept: "text/html" })
  expect(plain.text).not.toContain("wb-dock")
  expect(plain.text).not.toContain("data-retake")
  expect((await get("/__retake/session", {})).status).toBe(200)
})

test("in a browser: the app runs in the frame with no __wb, its own iframe stays inert, rewinds work", async ({ page }) => {
  urls.length = 0
  const h = await openDock(page, `http://localhost:${PORT}/`, { fresh: false })
  expect(await h.rt(() => location.search)).toBe("")
  const emb = (await h.liveFrame()).childFrames()[0]
  await expect.poll(() => emb.evaluate(() => !!document.getElementById("emb-body")).catch(() => false)).toBe(true)
  expect(await emb.evaluate(() => window.__retake && window.__retake.inert)).toBe(true)
  await page.waitForTimeout(300)
  await h.click("#b")
  await page.waitForTimeout(500)
  const mid = (await h.state()).now
  await page.waitForTimeout(200)
  await h.click("#b")
  await page.waitForTimeout(300)
  await h.pause()
  expect(await h.rt(() => document.getElementById("b").textContent)).toBe("2")
  await h.seek(mid)
  expect(await h.rt(() => document.getElementById("b").textContent)).toBe("1")
  expect(urls.filter((u) => u.includes("__wb"))).toEqual([])
  expect(h.errors).toEqual([])
})
