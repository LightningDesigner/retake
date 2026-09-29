// Code branches (opt-in): every time the project's source changes, snapshot it
// as a version. The dock branches the timeline on a new version and can check
// an older one back out when you step into its branch. Snapshots live in
// memory for the life of the dev server. Meant for small prototypes: it
// rewrites files on disk when switching.
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

const SKIP = new Set(["node_modules", ".git", "dist", "build", ".cache", ".vite", ".next", "coverage"])
const TEXT = /\.(jsx?|tsx?|mjs|cjs|css|scss|html|json|md|svg|vue|svelte)$/i
const MAX_FILES = 400
const MAX_BYTES = 256 * 1024

export function codeVersions(server) {
  const root = server.config.root
  const versions = new Map() // id -> Map(relative path -> content)
  let current = null
  let pending = null

  function listFiles(dir, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (out.length >= MAX_FILES || SKIP.has(entry.name) || entry.name.startsWith(".")) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) listFiles(full, out)
      else if (TEXT.test(entry.name) && fs.statSync(full).size <= MAX_BYTES) out.push(full)
    }
    return out
  }

  function snapshot() {
    const files = new Map()
    for (const f of listFiles(root).sort()) files.set(path.relative(root, f), fs.readFileSync(f, "utf8"))
    const hash = crypto.createHash("sha1")
    for (const [k, v] of files) hash.update(k + "\0" + v + "\0")
    const id = hash.digest("hex").slice(0, 10)
    if (!versions.has(id)) versions.set(id, files)
    return id
  }

  current = snapshot()
  server.watcher.on("all", (event, file) => {
    if (!file.startsWith(root) || file.split(path.sep).some((p) => SKIP.has(p))) return
    clearTimeout(pending)
    pending = setTimeout(() => (current = snapshot()), 120)
  })

  // The reload that follows can beat the file watcher, so drop Vite's cached
  // transforms for the touched files right away.
  function invalidate(full) {
    const graphs = [server.moduleGraph, ...Object.values(server.environments || {}).map((e) => e.moduleGraph)]
    for (const graph of graphs) {
      for (const mod of (graph && graph.getModulesByFile(full)) || []) graph.invalidateModule(mod)
    }
  }

  function checkout(id) {
    const target = versions.get(id)
    if (!target) return false
    const onDisk = new Set(listFiles(root).map((f) => path.relative(root, f)))
    for (const [rel, content] of target) {
      const full = path.join(root, rel)
      if (onDisk.has(rel) && fs.readFileSync(full, "utf8") === content) continue
      fs.mkdirSync(path.dirname(full), { recursive: true })
      fs.writeFileSync(full, content)
      invalidate(full)
    }
    for (const rel of onDisk) {
      if (target.has(rel)) continue
      fs.unlinkSync(path.join(root, rel))
      invalidate(path.join(root, rel))
    }
    current = id
    return true
  }

  server.middlewares.use((req, res, next) => {
    const url = new URL(req.url, "http://x")
    if (url.pathname === "/__wayback/version") {
      res.setHeader("Content-Type", "application/json")
      return res.end(JSON.stringify({ version: current }))
    }
    if (url.pathname === "/__wayback/checkout") {
      const ok = checkout(url.searchParams.get("v"))
      res.setHeader("Content-Type", "application/json")
      return res.end(JSON.stringify({ ok, version: current }))
    }
    next()
  })
}
