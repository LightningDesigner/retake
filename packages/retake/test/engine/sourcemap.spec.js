// A note's source when the app is served as bundles (Next's Turbopack and
// webpack chunks, Vite's deps): the compiled line is mapped back to the app's
// own file:line through the chunk's source map (server/sourcemap.js), which
// `retake mcp` does lazily for notes that only have a chunk line. A plain
// node:http server here plays the dev server (port 3347): Retake's session API
// plus a chunk with an index map (sections, as Turbopack writes), one with a
// plain map, and one with none.
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { spawn } from "node:child_process"
import { test, expect } from "@playwright/test"
import { BIN } from "./servers.js"
import { createBus, createSessionHandler } from "../../src/server/api.js"
import { cleanSource, decodeMappings, isCompiled, originalPosition, resolveSource } from "../../src/server/sourcemap.js"

const PORT = 3347
const base = `http://localhost:${PORT}`
const TOKEN = "0123abcd"

// VLQ, to write the maps the tests read.
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
function vlq(n) {
  let v = n < 0 ? (-n << 1) | 1 : n << 1
  let out = ""
  do {
    let d = v & 31
    v >>>= 5
    if (v) d |= 32
    out += B64[d]
  } while (v)
  return out
}
// One segment per generated line: line i of the chunk → origLines[i] (1-based) of source 0.
function mappingsFor(origLines) {
  let prev = 0
  return origLines
    .map((l) => {
      const seg = vlq(0) + vlq(0) + vlq(l - 1 - prev) + vlq(0)
      prev = l - 1
      return seg
    })
    .join(";")
}

const ROOT = "/work/shop"
const chunk = Array.from({ length: 30 }, (_, i) => `var l${i + 1} = ${i};`).join("\n")
const INDEX_MAP = {
  version: 3,
  sections: [
    // lines 1-10: the JSX runtime, bundled into the same chunk
    { offset: { line: 0, column: 0 }, map: { version: 3, sources: [`file://${ROOT}/node_modules/next/dist/compiled/react/cjs/react-jsx-dev-runtime.development.js`], mappings: mappingsFor([...Array(10).keys()].map((i) => 100 + i)) } },
    // lines 11-30: app/page.tsx, whose JSX is on lines 40-59
    { offset: { line: 10, column: 0 }, map: { version: 3, sources: [`file://${ROOT}/app/page.tsx`], mappings: mappingsFor([...Array(20).keys()].map((i) => 40 + i)) } },
  ],
}
const PLAIN_MAP = { version: 3, sources: ["webpack://_N_E/./src/components/Hero.tsx?abc"], mappings: mappingsFor([...Array(30).keys()].map((i) => i + 3)) }

let server
let root
test.beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "retake-srcmap-"))
  const api = createSessionHandler({ root, token: TOKEN, bus: createBus() })
  server = http.createServer((req, res) => {
    const url = new URL(req.url, base)
    const send = (type, body, headers = {}) => res.writeHead(200, { "content-type": type, ...headers }).end(body)
    if (url.pathname === "/") return send("text/html", `<script>window.__RETAKE_TOKEN = "${TOKEN}"</script>`)
    if (url.pathname === "/_next/static/chunks/app_1r3jkso._.js") return send("text/javascript", chunk + "\n//# sourceMappingURL=app_1r3jkso._.js.map\n")
    if (url.pathname === "/_next/static/chunks/app_1r3jkso._.js.map") return send("application/json", JSON.stringify(INDEX_MAP))
    if (url.pathname === "/static/js/hero-4f3a2b1c.js") return send("text/javascript", chunk, { SourceMap: "/maps/hero.map" })
    if (url.pathname === "/maps/hero.map") return send("application/json", JSON.stringify(PLAIN_MAP))
    if (url.pathname === "/assets/index-9f8e7d6c.js") return send("text/javascript", chunk)
    return api(req, res)
  })
  await new Promise((r) => server.listen(PORT, r))
})
test.afterAll(async () => {
  await new Promise((r) => server.close(r))
  fs.rmSync(root, { recursive: true, force: true })
})

test("decodes VLQ and index maps; cleans webpack/Turbopack/file source names; tells bundles from source files", () => {
  expect(decodeMappings("AAAA;AACA,EAAE")).toEqual([[[0, 0, 0, 0]], [[0, 0, 1, 0], [2, 0, 1, 2]]])
  expect(originalPosition(INDEX_MAP, 12, 4)).toMatchObject({ source: `file://${ROOT}/app/page.tsx`, line: 41 })
  expect(originalPosition(INDEX_MAP, 3, null)).toMatchObject({ line: 102 })
  expect(originalPosition(INDEX_MAP, 99, 1)).toBeNull()

  expect(cleanSource("webpack://_N_E/./src/a.tsx?x=1")).toBe("src/a.tsx")
  expect(cleanSource("turbopack:///[project]/app/page.tsx")).toBe("app/page.tsx")
  expect(cleanSource(`file://${ROOT}/app/page.tsx`, { root: ROOT })).toBe("app/page.tsx")
  expect(cleanSource(`file://${ROOT}/app/page.tsx`, { sources: [`file://${ROOT}/node_modules/react/index.js`] })).toBe("app/page.tsx")
  expect(cleanSource("/elsewhere/x.tsx", { root: ROOT })).toBe("/elsewhere/x.tsx")

  for (const f of ["/_next/static/chunks/app_1r3jkso._.js", "/node_modules/.vite/deps/react-dom_client.js", "/assets/index-9f8e7d6c.js", "/static/js/main.4f3a2b1c.js"]) expect(isCompiled(f), f).toBe(true)
  for (const f of ["src/Go.tsx", "/src/main.jsx", "app/page.tsx", "/src/my-component.js", "/src/components/Card.js"]) expect(isCompiled(f), f).toBe(false)
})

test("resolveSource: a chunk line → the app's file:line; library code and missing maps say so", async () => {
  expect(await resolveSource({ file: "/_next/static/chunks/app_1r3jkso._.js", line: 12, col: 4 }, { base, root: ROOT })).toEqual({ file: "app/page.tsx", line: 41, from: "/_next/static/chunks/app_1r3jkso._.js:12" })
  // No column (older notes): the line alone picks the section.
  expect(await resolveSource({ file: "/_next/static/chunks/app_1r3jkso._.js", line: 30 }, { base })).toMatchObject({ file: "app/page.tsx", line: 59 })
  expect(await resolveSource({ file: "/_next/static/chunks/app_1r3jkso._.js", line: 4 }, { base })).toEqual({ library: "node_modules/next/dist/compiled/react/cjs/react-jsx-dev-runtime.development.js", line: 103 })
  // A SourceMap header, webpack:// names.
  expect(await resolveSource({ file: "/static/js/hero-4f3a2b1c.js", line: 5 }, { base })).toMatchObject({ file: "src/components/Hero.tsx", line: 7 })
  expect(await resolveSource({ file: "/assets/index-9f8e7d6c.js", line: 5 }, { base })).toBeNull()
  expect(await resolveSource({ file: "/gone._.js", line: 5 }, { base })).toBeNull()
})

test("get_note maps a note's chunk line through the dev server's source map; with no map it says it doesn't know", async ({ request }) => {
  const notes = [
    { id: "s1", branchId: 1, t: 1200, selector: "body > main > h1", component: "Home", source: { file: "/_next/static/chunks/app_1r3jkso._.js", line: 12, col: 4, mapped: false, compiled: true }, text: "Appear later", status: "pending", replies: [] },
    { id: "s2", branchId: 1, t: 1300, selector: "#cta", component: "Cta", source: { file: "/assets/index-9f8e7d6c.js", line: 5, mapped: false, compiled: true }, text: "Bigger", status: "pending", replies: [] },
    { id: "s3", branchId: 1, t: 1400, selector: "#old", source: { file: "/_next/static/chunks/app_1r3jkso._.js", line: 4, mapped: true }, text: "Older note", status: "pending", replies: [] },
  ]
  await request.put(base + "/__retake/session", { headers: { "x-retake-token": TOKEN }, data: { branches: [{ id: 1, parentId: null, forkAt: 0, name: "Timeline 1" }], activeId: 1, markers: [], notes } })
  const child = spawn(process.execPath, [BIN, "mcp", "--url", base], { cwd: root, stdio: ["pipe", "pipe", "pipe"] })
  const input = [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {} } },
    ...["s1", "s2", "s3"].map((id, i) => ({ jsonrpc: "2.0", id: i + 2, method: "tools/call", params: { name: "get_note", arguments: { id } } })),
  ]
  let out = ""
  child.stdout.setEncoding("utf8")
  child.stdout.on("data", (d) => (out += d))
  child.stdin.end(input.map((m) => JSON.stringify(m)).join("\n") + "\n")
  await new Promise((r) => child.on("exit", r))
  const texts = Object.fromEntries(out.trim().split("\n").map((l) => JSON.parse(l)).filter((m) => m.id > 1).map((m) => [m.id, m.result.content[0].text]))
  expect(texts[2]).toContain("Source: app/page.tsx:41 (through the source map of the bundle it was served in)")
  expect(texts[3]).toContain("Source: not known. The note only has a line of a compiled bundle, with no source map to read it by; find the element by its component (Cta) and selector instead.")
  expect(texts[3]).not.toContain("index-9f8e7d6c")
  expect(texts[4]).toContain("which maps into library code; find the element by #old instead.")
})

// F95: an element a server component wrote has only a server frame in its
// React stack (file:///…/.next/server/…chunk.js). The dock asks the dev server,
// which reads that chunk and its map from disk: the element's own source line.
// Only .js files inside the project are read.
test("GET /__retake/map: a server chunk's line → the server component's file:line; nothing outside the project", async ({ request }) => {
  const dir = path.join(root, ".next/server/chunks/ssr")
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, "app_page_1a2b3c._.js")
  const map = { ...INDEX_MAP, sections: INDEX_MAP.sections.map((s) => ({ ...s, map: { ...s.map, sources: s.map.sources.map((x) => x.replace(ROOT, root)) } })) }
  fs.writeFileSync(file, chunk + "\n//# sourceMappingURL=app_page_1a2b3c._.js.map\n")
  fs.writeFileSync(file + ".map", JSON.stringify(map))
  const ask = async (url, line) => (await request.get(`${base}/__retake/map?${new URLSearchParams({ url, line: String(line), col: "1" })}`)).json()
  expect(await ask(`about://React/Server/file://${file}`, 15)).toEqual({ file: "app/page.tsx", line: 44 })
  expect(await ask(`file://${file}`, 3)).toEqual({ file: null, line: null }) // the JSX runtime's lines
  // Outside the project, or not a script: never read.
  const outside = path.join(os.tmpdir(), `retake-outside-${process.pid}.js`)
  fs.writeFileSync(outside, chunk + "\n//# sourceMappingURL=data:application/json;base64," + Buffer.from(JSON.stringify(PLAIN_MAP)).toString("base64"))
  expect(await ask(`file://${outside}`, 5)).toEqual({ file: null, line: null })
  expect(await ask(`file://${root}/../../etc/passwd`, 1)).toEqual({ file: null, line: null })
  fs.rmSync(outside, { force: true })
})
