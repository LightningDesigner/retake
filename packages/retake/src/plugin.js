// Vite plugin. A page request gets the dock: a small shell page with the
// timeline docked at the bottom (like DevTools) and the prototype in a frame
// above it. The frame's own request (`?__wb=app`) gets the real page with the
// time runtime injected as its first script, before any app code. Dev only.
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { codeVersions } from "./code-versions.js"
import { createBus, sessionApi } from "./server/api.js"

const SRC = path.dirname(fileURLToPath(import.meta.url))
const read = (...p) => fs.readFileSync(path.join(SRC, ...p), "utf8")

// Read on every page load, so edits to the tool apply on refresh.
export function runtimeSource() {
  const dir = path.join(SRC, "runtime")
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".js")).sort()
  const body = files.map((f) => `// ---- ${f}\n${read("runtime", f)}`).join("\n")
  return `;(function () {\n"use strict";\nif (window.__wayback) return;\n${body}\n})();`
}

export function shellHtml(options = {}) {
  return read("shell", "shell.html")
    .replace(
      "/*CONFIG*/",
      () =>
        `window.__waybackConfig = ${JSON.stringify({ codeBranches: !!options.codeBranches })};` +
        (options.token ? `window.__WAYBACK_TOKEN = ${JSON.stringify(options.token)};` : ""),
    )
    .replace("/*CSS*/", () => read("shell", "shell.css"))
    .replace("/*JS*/", () => {
      const files = fs.readdirSync(path.join(SRC, "shell")).filter((f) => f.endsWith(".js")).sort()
      return `;(function () {\n"use strict";\n${files.map((f) => read("shell", f)).join("\n")}\n})();`
    })
}

const NESTED_DEST = new Set(["iframe", "frame", "embed", "object"])

/**
 * @param {{ enabled?: boolean, codeBranches?: boolean, token?: string }} [options]
 *   `codeBranches`: each timeline keeps its own version of the code; stepping
 *   into a timeline checks its code out on disk (see code-versions.js).
 * @returns {import("vite").Plugin[]}
 */
export function retake(options = {}) {
  // Mutating /__wayback/ requests must carry this (see CONTRACT.md).
  options = { ...options, token: options.token || crypto.randomBytes(16).toString("hex") }
  const bus = createBus()
  const main = {
    name: "retake",
    apply: "serve",
    configureServer(server) {
      if (options.enabled === false) return
      // Only a top-level page load gets the dock. An iframe the app itself
      // embeds (or a frame navigating to another page of a multi-page app)
      // gets its plain page. The dock's own frame asks for `?__wb=app`.
      server.middlewares.use((req, res, next) => {
        const dest = req.headers["sec-fetch-dest"]
        if (dest && NESTED_DEST.has(dest) && req.url && !/[?&]__wb=/.test(req.url)) {
          const add = (u) => u + (u.includes("?") ? "&" : "?") + "__wb=plain"
          req.url = add(req.url)
          if (req.originalUrl) req.originalUrl = add(req.originalUrl)
        }
        next()
      })
      sessionApi(server, { token: options.token, bus })
      if (options.codeBranches) codeVersions(server, { token: options.token, bus })
      if (server.httpServer) {
        server.httpServer.once("listening", () => {
          const a = server.httpServer.address()
          const port = a && typeof a === "object" ? a.port : server.config.server.port
          const proto = server.config.server.https ? "https" : "http"
          const base = server.config.base || "/"
          if (options.banner) console.log(`\n  \x1b[1mRetake\x1b[0m  timeline docked at ${proto}://localhost:${port}${base}${options.codeBranches ? "  (code branches on)" : ""}\n`)
          if (!fs.existsSync(path.join(server.config.root, "index.html"))) {
            server.config.logger.warn(
              `  retake: no index.html in ${server.config.root}. Retake docks into pages Vite serves from index.html (single-page apps). ` +
                `SSR and framework setups (React Router framework mode, Remix, Astro, SvelteKit, Nuxt) aren't supported yet, so the timeline won't appear.`,
            )
          }
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
        const params = new URL(ctx.originalUrl || ctx.path, "http://x").searchParams
        // `?retake=0` (or the old `?wayback=0`) opts a page load out entirely.
        if (params.get("retake") === "0" || params.get("wayback") === "0") return
        if (params.get("__wb") === "plain") return
        if (params.get("__wb") !== "app") return shellHtml(options)
        return [{ tag: "script", attrs: { "data-wayback": "" }, children: runtimeSource(), injectTo: "head-prepend" }]
      },
    },
  }
  // The dock page must not run Vite's client: a full reload (an edit HMR
  // can't apply) would reload the whole dock and drop the session. Only the
  // app frame keeps the client, so only the app reloads. Other plugins' module
  // scripts go too (plugin-react's refresh preamble imports the client); the
  // dock's own scripts are classic ones.
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

// `wayback` is the old name, kept as an alias.
export const wayback = retake
export default retake
