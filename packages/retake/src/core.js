// What every way of serving Retake shares: the runtime (as source, or as the
// script tag a server injects into a frame's page), the dock page, and an HTML
// stream transform that puts the runtime first in <head>. The Vite plugin, the
// front server (server/front.js) and the site's deployed build (apps/site) all use these.
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import zlib from "node:zlib"
import { Transform } from "node:stream"
import { fileURLToPath } from "node:url"

const SRC = path.dirname(fileURLToPath(import.meta.url))
const read = (...p) => fs.readFileSync(path.join(SRC, ...p), "utf8")

// How the runtime is set up for the server it runs behind (`RT` in the
// runtime). The defaults are the Vite plugin's: a frame marked by `?__wb=app`.
//   marker:      "url" (the frame's URL carries `__wb=app`) or "header" (the front
//                server knows the dock's frames by Sec-Fetch-Dest; no URL marker)
//   bootAt:      "dcl" (the clock starts at DOMContentLoaded) or "load" (F47)
//   exemptUrls:  the dev server's own traffic, as regular expressions (F54)
//   holdScripts: scripts added later are held to their recorded moment (F48)
//   next:        the Next.js major version, for its debug channel (F49)
//   docId, docStored: this page's kept copy on the front server, and whether
//                this is it (F56)
// The front server's setup is frontRuntime() in server/detect.js.
export const RT_DEFAULTS = Object.freeze({ marker: "url", bootAt: "dcl", exemptUrls: [], holdScripts: false, next: null, docId: null, docStored: false })

// Read on every page load, so edits to the tool apply on refresh.
export function runtimeSource(rt = {}) {
  const dir = path.join(SRC, "runtime")
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".js")).sort()
  const body = files.map((f) => `// ---- ${f}\n${read("runtime", f)}`).join("\n")
  const config = JSON.stringify({ ...RT_DEFAULTS, ...rt })
  return `;(function () {\n"use strict";\nif (window.__retake) return;\nconst RT = Object.freeze(${config});\n${body}\n})();`
}

export function shellHtml(options = {}) {
  const config = {
    codeBranches: !!options.codeBranches,
    features: ["continue", "segments", "serialize"],
    ...(options.appPage ? { appPage: options.appPage } : {}),
    ...(options.marker && options.marker !== "url" ? { marker: options.marker } : {}),
    // Behind the front server: rebuilds ask for the page as it was recorded (F56).
    ...(options.docs ? { docs: true } : {}),
  }
  return read("shell", "shell.html")
    .replace(
      "/*CONFIG*/",
      () => `window.__retakeConfig = ${JSON.stringify(config)};` + (options.token ? `window.__RETAKE_TOKEN = ${JSON.stringify(options.token)};` : ""),
    )
    .replace("/*CSS*/", () => read("shell", "shell.css"))
    .replace("/*JS*/", () => {
      const files = fs.readdirSync(path.join(SRC, "shell")).filter((f) => f.endsWith(".js")).sort()
      return `;(function () {\n"use strict";\n${files.map((f) => read("shell", f)).join("\n")}\n})();`
    })
}

// The script a server injects into a page it can't tell apart from the app's
// own frames (any iframe document). It takes itself out of the DOM first (so an
// app hydrating the whole document never sees it), then runs the runtime only
// in a frame the dock made (`isAppFrame`, or, with the URL marker, a URL with
// `__wb=app`). Anywhere else `__retake` is `{ inert: true }` and the runtime
// returns at its first line.
export function runtimeScript(rt = {}) {
  const marker = rt.marker || RT_DEFAULTS.marker
  const guard =
    `;(function(){try{var d=document.currentScript;d&&d.remove()}catch(e){}` +
    `var ok=false;try{var s=window.parent!==window&&window.parent.__retakeShell;` +
    `ok=!!s&&((typeof s.isAppFrame==="function"&&s.isAppFrame(window.frameElement))` +
    (marker === "url" ? `||/[?&]__wb=app(&|$)/.test(location.search)` : "") +
    `)}catch(e){}if(!ok)window.__retake={inert:true}})();`
  return `${guard}\n${runtimeSource(rt)}`
}

export function runtimeTag({ rt = {}, nonce = null, script = runtimeScript(rt) } = {}) {
  return `<script data-retake${nonce ? ` nonce="${String(nonce).replace(/"/g, "&quot;")}"` : ""}>${script}</script>`
}

// For a CSP without 'unsafe-inline': the hash source that allows this script.
export const scriptHash = (script) => `'sha256-${crypto.createHash("sha256").update(script, "utf8").digest("base64")}'`

const HOLD_MAX = 64 * 1024

// Where the tag goes in the HTML seen so far, or -1 to wait for more. `s` is
// the bytes as latin1 (one char per byte), so indices are byte offsets and a
// multi-byte character is never split.
function insertAt(raw, final) {
  // Comments are blanked out (same length) first: a `<head>` written inside one
  // (before the real one) isn't the head. One still open at the end hides the rest.
  const s = raw.replace(/<!--[\s\S]*?(?:-->|$)/g, (c) => " ".repeat(c.length))
  const head = /<head(?=[\s>/])[^>]*>/i.exec(s)
  if (head) {
    let at = head.index + head[0].length
    // A <meta charset> right after it stays first (it must be in the first 1024 bytes).
    const rest = s.slice(at)
    const meta = /<meta\b[^>]*\bcharset\s*=[^>]*>/i.exec(rest)
    if (meta && !/<script\b/i.test(rest.slice(0, meta.index))) at += meta.index + meta[0].length
    return at
  }
  // An opening <head that hasn't closed yet: wait for it.
  if (!final && /<head(?:[\s/][^>]*)?$/i.test(s)) return -1
  const first = s.search(/<(body|script|link|meta|style|title)\b/i)
  if (first >= 0) return first
  if (!final && s.length < HOLD_MAX) return -1
  // Nothing to go by (the hold cap, or the page ended): after the doctype,
  // not before it (that would put the page in quirks mode).
  const doc = /^\s*(?:<!--[\s\S]*?-->\s*)*<!doctype[^>]*>/i.exec(raw)
  return doc ? doc[0].length : 0
}

const decompressor = (encoding) => {
  const e = String(encoding || "").trim().toLowerCase()
  if (!e || e === "identity") return null
  if (e === "gzip" || e === "x-gzip") return zlib.createGunzip()
  if (e === "br") return zlib.createBrotliDecompress()
  if (e === "deflate") return zlib.createInflate()
  if (e === "zstd" && zlib.createZstdDecompress) return zlib.createZstdDecompress()
  throw new Error(`can't decode content-encoding ${encoding}`)
}

/**
 * A byte stream transform that inserts `tag` into an HTML document as it
 * streams: after the `<head …>` opening tag (and a `<meta charset>` right
 * after it), else before the first <body>/<script>/<link>/<meta>. It holds at
 * most 64 KB back; past that, or if the page ends first, the tag goes after
 * the doctype. Everything after the insertion point passes straight through.
 * @param {string} tag
 * @param {{ encoding?: string }} [options] the body's content-encoding (gzip,
 *   br, deflate): it's decoded first, and the output is plain.
 */
export function injectHtml(tag, { encoding } = {}) {
  const tagBytes = Buffer.from(tag, "utf8")
  let held = []
  let heldLen = 0
  let done = false
  const feed = (chunk, final) => {
    if (done) return chunk
    if (chunk && chunk.length) {
      held.push(chunk)
      heldLen += chunk.length
    }
    const buf = Buffer.concat(held, heldLen)
    const at = insertAt(buf.toString("latin1"), final)
    if (at < 0) {
      held = [buf]
      return null
    }
    done = true
    held = []
    return Buffer.concat([buf.subarray(0, at), tagBytes, buf.subarray(at)])
  }
  const unzip = decompressor(encoding)
  if (!unzip) {
    return new Transform({
      transform(chunk, _, cb) {
        cb(null, feed(chunk, false) || undefined)
      },
      flush(cb) {
        cb(null, feed(null, true) || undefined)
      },
    })
  }
  let flushed = null
  const t = new Transform({
    transform(chunk, _, cb) {
      unzip.write(chunk) ? cb() : unzip.once("drain", cb)
    },
    flush(cb) {
      flushed = cb
      unzip.end()
    },
  })
  unzip.on("data", (d) => {
    const out = feed(d, false)
    if (out && out.length) t.push(out)
  })
  unzip.on("end", () => {
    const out = feed(null, true)
    if (out && out.length) t.push(out)
    if (flushed) flushed()
  })
  unzip.on("error", (err) => t.destroy(err))
  return t
}

/**
 * Runs an HTML response that a server writes in its own way (res.writeHead,
 * write, end, or a stream piped into res) through injectHtml. Whether it's
 * HTML is decided at the first write, from its Content-Type; anything else
 * passes through untouched.
 * @param {import("node:http").ServerResponse} res
 * @param {string} tag
 */
export function injectResponse(res, tag) {
  const write = res.write.bind(res)
  const end = res.end.bind(res)
  const writeHead = res.writeHead.bind(res)
  let t = null
  let decided = false
  const decide = () => {
    if (decided) return
    decided = true
    if (!/^\s*text\/html\b/i.test(String(res.getHeader("content-type") || "")) || res.statusCode === 204 || res.statusCode === 304 || res.req?.method === "HEAD") return
    const encoding = res.getHeader("content-encoding")
    for (const h of ["content-length", "content-encoding", "etag"]) res.removeHeader(h)
    res.setHeader("cache-control", "no-store")
    try {
      t = injectHtml(tag, { encoding })
    } catch {
      return
    }
    t.on("data", (c) => {
      if (!write(c)) {
        t.pause()
        res.once("drain", () => t.resume())
      }
    })
    t.on("end", () => end())
    t.on("error", () => res.destroy())
  }
  res.writeHead = function (status, message, headers) {
    if (typeof message !== "string") {
      headers = message
      message = undefined
    }
    // Headers given here are folded in first, so they can be changed.
    if (Array.isArray(headers)) for (let i = 0; i < headers.length; i += 2) res.setHeader(headers[i], headers[i + 1])
    else if (headers) for (const [k, v] of Object.entries(headers)) res.setHeader(k, v)
    res.statusCode = status
    if (message) res.statusMessage = message
    decide()
    return writeHead(res.statusCode)
  }
  const args = (chunk, encoding, cb) => {
    if (typeof chunk === "function") return [null, null, chunk]
    if (typeof encoding === "function") return [chunk, null, encoding]
    return [chunk, encoding, cb]
  }
  res.write = function (chunk, encoding, cb) {
    decide()
    if (!t) return write(chunk, encoding, cb)
    ;[chunk, encoding, cb] = args(chunk, encoding, cb)
    return t.write(typeof chunk === "string" ? Buffer.from(chunk, encoding || "utf8") : chunk, cb)
  }
  res.end = function (chunk, encoding, cb) {
    decide()
    if (!t) return end(chunk, encoding, cb)
    ;[chunk, encoding, cb] = args(chunk, encoding, cb)
    if (chunk != null && chunk.length) t.write(typeof chunk === "string" ? Buffer.from(chunk, encoding || "utf8") : chunk)
    if (cb) res.once("finish", cb)
    t.end()
    return res
  }
}
