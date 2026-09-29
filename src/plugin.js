// Vite plugin. A page request gets the dock: a small shell page with the
// timeline docked at the bottom (like DevTools) and the prototype in a frame
// above it. The frame's own request (`?__wb=app`) gets the real page with the
// time runtime injected as its first script, before any app code. Dev only.
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const SRC = path.dirname(fileURLToPath(import.meta.url))
const read = (...p) => fs.readFileSync(path.join(SRC, ...p), "utf8")

// Read on every page load, so edits to the tool apply on refresh.
export function runtimeSource(markers = []) {
  const dir = path.join(SRC, "runtime")
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".js")).sort()
  const body = files.map((f) => `// ---- ${f}\n${read("runtime", f)}`).join("\n")
  const rules = `window.__waybackMarkers = ${JSON.stringify(markers).replace(/</g, "\\u003c")};\n`
  return `;(function () {\n"use strict";\nif (window.__wayback) return;\n${rules}${body}\n})();`
}

export function shellHtml() {
  return read("shell", "shell.html")
    .replace("/*CSS*/", () => read("shell", "shell.css"))
    .replace("/*JS*/", () => read("shell", "shell.js"))
}

function loadMarkers(markers) {
  if (!markers) return []
  if (Array.isArray(markers)) return markers
  try {
    return JSON.parse(fs.readFileSync(markers, "utf8"))
  } catch (err) {
    console.warn(`[wayback] couldn't read markers from ${markers}: ${err.message}`)
    return []
  }
}

/**
 * @param {{ enabled?: boolean, markers?: string | Array<{ name: string, text?: string, selector?: string, count?: number }> }} [options]
 *   `markers`: rules (or a path to a JSON file of them) that drop a marker when
 *   text appears on the page or enough elements match a selector.
 * @returns {import("vite").Plugin}
 */
export function wayback(options = {}) {
  return {
    name: "wayback",
    apply: "serve",
    transformIndexHtml: {
      order: "pre",
      handler(html, ctx) {
        if (options.enabled === false) return
        const params = new URL(ctx.originalUrl || ctx.path, "http://x").searchParams
        // `?wayback=0` opts a page load out entirely.
        if (params.get("wayback") === "0") return
        if (params.get("__wb") !== "app") return shellHtml()
        return [{ tag: "script", attrs: { "data-wayback": "" }, children: runtimeSource(loadMarkers(options.markers)), injectTo: "head-prepend" }]
      },
    },
  }
}

export default wayback
