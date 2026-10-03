// Vite plugin. A page request gets the dock: a small shell page with the
// timeline docked at the bottom (like DevTools) and the prototype in a frame
// above it. The frame's own request (`?__wb=app`) gets the real page with the
// time runtime injected as its first script, before any app code. Dev only.
import { AsyncLocalStorage } from "node:async_hooks"
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { codeVersions } from "./code-versions.js"
import { injectResponse, runtimeSource, runtimeTag, shellHtml } from "./core.js"
import { createBus, sessionApi } from "./server/api.js"
import { frontRuntime } from "./server/detect.js"

// The site's deployed build (apps/site/app/retake-dock, retake-runtime) and the tests import these from here.
export { runtimeSource, shellHtml, runtimeTag, injectHtml, markSvg } from "./core.js"

const NESTED_DEST = new Set(["iframe", "frame", "embed", "object"])
const pageKind = new AsyncLocalStorage()

/**
 * @param {import("../types/index.js").RetakeOptions} [options]
 *   `codeBranches`: each timeline keeps its own version of the code; stepping
 *   into a timeline checks its code out on disk (see code-versions.js).
 *   `root`: where .retake/ goes (default: Vite's root).
 *   Public types: types/index.d.ts (keep them in step).
 * @returns {import("vite").Plugin[]}
 */
export function retake(options = {}) {
  // Mutating /__retake/ requests must carry this (see CONTRACT.md).
  options = { ...options, token: options.token || crypto.randomBytes(16).toString("hex") }
  const bus = createBus()
  let ssr = false
  /** @type {string | undefined} */
  let viteRoot
  // The dock for a top-level page load, the runtime injected into the dock's
  // frame (Sec-Fetch-Dest: iframe; isAppFrame() tells it from an app's own
  // iframe), and anything else left alone. Which one a request is stays known
  // while the framework renders it (pageKind), for frameworks that call
  // server.transformIndexHtml themselves.
  const ssrPages = (req, res, next) => {
    const url = new URL(req.url || "/", "http://x")
    const mode = req.headers["sec-fetch-mode"]
    const dest = req.headers["sec-fetch-dest"]
    const optOut = url.searchParams.get("retake") === "0"
    if (url.pathname.startsWith("/__retake/") || mode !== "navigate" || optOut) return pageKind.run("plain", next)
    if (req.method === "GET" && dest === "document" && req.headers["sec-fetch-site"] !== "cross-site") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" })
      return res.end(shellHtml({ root: viteRoot, ...options, marker: "header" }))
    }
    if (dest !== "iframe" && dest !== "frame") return pageKind.run("plain", next)
    delete req.headers["accept-encoding"]
    // Set up like the front server's frames (clock at load, scripts held: see frontRuntime).
    injectResponse(res, runtimeTag({ rt: { ...frontRuntime("vite"), marker: "header" } }))
    pageKind.run("frame", next)
  }
  /** @type {import("vite").Plugin} */
  const main = {
    name: "retake",
    apply: "serve",
    // CSS source maps in dev, so cssSourceFor() can point at the original file.
    config(cfg) {
      if (options.enabled === false) return
      if (!cfg.css || cfg.css.devSourcemap === undefined) return { css: { devSourcemap: true } }
    },
    configureServer(server) {
      if (options.enabled === false) return
      // Source paths in notes are given relative to the project.
      viteRoot = options.root || server.config.root
      // No index.html: a framework renders the pages itself (React Router,
      // SvelteKit, Astro, TanStack Start...), and transformIndexHtml never sees
      // them. Then pages are told apart by their Sec-Fetch-* headers, like the
      // front server does (header marker), and the frame's HTML is injected as
      // it's written. The URL is never touched (a `__wb` would leak into the app).
      ssr = !fs.existsSync(path.join(server.config.root, "index.html"))
      if (ssr) server.middlewares.use(ssrPages)
      // Only a top-level page load gets the dock. An iframe the app itself
      // embeds (or a frame navigating to another page of a multi-page app)
      // gets its plain page. The dock's own frame asks for `?__wb=app`.
      else server.middlewares.use((req, res, next) => {
        const dest = req.headers["sec-fetch-dest"]
        if (dest && NESTED_DEST.has(dest) && req.url && !/[?&]__wb=/.test(req.url)) {
          const add = (u) => u + (u.includes("?") ? "&" : "?") + "__wb=plain"
          req.url = add(req.url)
          if (req.originalUrl) req.originalUrl = add(req.originalUrl)
        }
        next()
      })
      sessionApi(server, { token: options.token, bus, root: options.root })
      if (options.codeBranches) codeVersions(server, { token: options.token, bus })
      const httpServer = server.httpServer
      if (httpServer) {
        httpServer.once("listening", () => {
          const a = httpServer.address()
          const port = a && typeof a === "object" ? a.port : server.config.server.port
          const proto = server.config.server.https ? "https" : "http"
          const base = server.config.base || "/"
          if (options.banner !== false) console.log(`\n  \x1b[1mRetake\x1b[0m  timeline docked at ${proto}://localhost:${port}${base}${options.codeBranches ? "  (code branches on)" : ""}${ssr ? "  (server-rendered pages)" : ""}\n`)
        })
      }
    },
    // With code branches the dock decides when the frame reloads (it replays
    // up to the current moment on the new code), so Vite's HMR stands down.
    handleHotUpdate() {
      if (options.codeBranches) return []
    },
    transformIndexHtml: {
      order: "pre",
      handler(html, ctx) {
        if (options.enabled === false) return
        // A server-rendered page (see ssrPages): the response is injected, if at all.
        if (pageKind.getStore()) return
        const params = new URL(ctx.originalUrl || ctx.path, "http://x").searchParams
        // `?retake=0` opts a page load out entirely.
        if (params.get("retake") === "0") return
        if (params.get("__wb") === "plain") return
        if (params.get("__wb") !== "app") return shellHtml({ root: viteRoot, ...options })
        return [{ tag: "script", attrs: { "data-retake": "" }, children: runtimeSource(), injectTo: "head-prepend" }]
      },
    },
  }
  // The dock page must not run Vite's client: a full reload (an edit HMR
  // can't apply) would reload the whole dock and drop the session. Only the
  // app frame keeps the client, so only the app reloads. Other plugins' module
  // scripts go too (plugin-react's refresh preamble imports the client); the
  // dock's own scripts are classic ones.
  /** @type {import("vite").Plugin} */
  const stripClient = {
    name: "retake:shell-without-vite-client",
    apply: "serve",
    transformIndexHtml: {
      order: "post",
      handler(html) {
        if (options.enabled === false || !html.includes('id="wb-dock"')) return
        return html.replace(/<script\b[^>]*\btype=["']?module["']?[^>]*>[\s\S]*?<\/script>\s*/gi, "")
      },
    },
  }
  return [main, stripClient]
}

export default retake
