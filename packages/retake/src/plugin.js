// Vite plugin. A page request gets the dock: a small shell page with the
// timeline docked at the bottom (like DevTools) and the prototype in a frame
// above it. The frame's own request (`?__wb=app`) gets the real page with the
// time runtime injected as its first script, before any app code. Dev only.
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { codeVersions } from "./code-versions.js"

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
    .replace("/*CONFIG*/", () => `window.__waybackConfig = ${JSON.stringify({ codeBranches: !!options.codeBranches })};`)
    .replace("/*CSS*/", () => read("shell", "shell.css"))
    .replace("/*JS*/", () => {
      const files = fs.readdirSync(path.join(SRC, "shell")).filter((f) => f.endsWith(".js")).sort()
      return `;(function () {\n"use strict";\n${files.map((f) => read("shell", f)).join("\n")}\n})();`
    })
}

/**
 * @param {{ enabled?: boolean, codeBranches?: boolean }} [options]
 *   `codeBranches`: branch the timeline whenever the source changes, and check
 *   old code back out when stepping into an older branch. Rewrites files.
 * @returns {import("vite").Plugin}
 */
export function retake(options = {}) {
  return {
    name: "retake",
    apply: "serve",
    configureServer(server) {
      if (options.codeBranches) codeVersions(server)
      if (options.banner && server.httpServer) {
        server.httpServer.once("listening", () => {
          const a = server.httpServer.address()
          const port = a && typeof a === "object" ? a.port : server.config.server.port
          const proto = server.config.server.https ? "https" : "http"
          const base = server.config.base || "/"
          console.log(`\n  \x1b[1mRetake\x1b[0m  timeline docked at ${proto}://localhost:${port}${base}${options.codeBranches ? "  (code branches on)" : ""}\n`)
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
        if (params.get("__wb") !== "app") return shellHtml(options)
        return [{ tag: "script", attrs: { "data-wayback": "" }, children: runtimeSource(), injectTo: "head-prepend" }]
      },
    },
  }
}

// `wayback` is the old name, kept as an alias.
export const wayback = retake
export default retake
