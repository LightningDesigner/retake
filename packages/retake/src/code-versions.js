// Code branches (opt-in): every time the project's source changes, snapshot it
// as a version. The dock gives each timeline a version and checks an older one
// back out when you step into its timeline.
//
// Nothing here may lose work:
// - Versions live on disk (<root>/.retake/versions + content-addressed blobs),
//   not in memory, so a crash or quit never takes a version with it.
// - Every checkout first snapshots what's on disk right now, synchronously, and
//   refuses to touch anything if that snapshot can't be made in full.
// - Only files a snapshot captured are ever written or deleted. A path the
//   target version didn't capture (skipped for size, ignored, never seen) is
//   left alone, never deleted.
// - Writes are atomic (temp file + rename) and journaled; a checkout that was
//   interrupted is rolled back on the next start.
// - When the dev server exits, the newest version is put back on disk.
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { execFileSync } from "node:child_process"

const SKIP = new Set(["node_modules", ".git", ".retake", "dist", "build", ".cache", ".vite", ".next", "coverage"])
const MAX_FILES = 5000
const MAX_BYTES = 5 * 1024 * 1024

const sha1 = (buf) => crypto.createHash("sha1").update(buf).digest("hex")

export function createStore(root) {
  const dir = path.join(root, ".retake")
  const blobs = path.join(dir, "blobs")
  const versionsDir = path.join(dir, "versions")
  const journalFile = path.join(dir, "journal.json")
  const stateFile = path.join(dir, "code-state.json")
  fs.mkdirSync(blobs, { recursive: true })
  fs.mkdirSync(versionsDir, { recursive: true })
  const ignore = path.join(dir, ".gitignore")
  if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, "*\n")

  function atomicWrite(file, data) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const tmp = `${file}.retake-${process.pid}-${Date.now()}.tmp`
    fs.writeFileSync(tmp, data)
    fs.renameSync(tmp, file)
  }

  const readJson = (file, /** @type {any} */ fallback = null) => {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8"))
    } catch {
      return fallback
    }
  }

  function isGit() {
    try {
      return execFileSync("git", ["-C", root, "rev-parse", "--show-toplevel"], { stdio: ["ignore", "pipe", "ignore"] }).toString().trim().length > 0
    } catch {
      return false
    }
  }
  const git = isGit()

  // The files a snapshot owns: in a git repo, tracked + untracked-not-ignored;
  // otherwise a walk that skips dot entries and build/dependency folders.
  function candidates() {
    if (git) {
      const out = execFileSync("git", ["-C", root, "ls-files", "-z", "--cached", "--others", "--exclude-standard", "--full-name", "."], { maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] })
      const top = execFileSync("git", ["-C", root, "rev-parse", "--show-toplevel"], { stdio: ["ignore", "pipe", "ignore"] }).toString().trim()
      const rels = new Set()
      for (const name of out.toString().split("\0")) {
        if (!name) continue
        const rel = path.relative(root, path.join(top, name))
        if (rel.startsWith("..") || rel.split(path.sep).some((p) => SKIP.has(p))) continue
        rels.add(rel)
      }
      return [...rels].sort()
    }
    const rels = []
    const walk = (d) => {
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        if (SKIP.has(entry.name) || entry.name.startsWith(".")) continue
        const full = path.join(d, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (entry.isFile()) rels.push(path.relative(root, full))
        if (rels.length > MAX_FILES) return
      }
    }
    walk(root)
    return rels.sort()
  }

  // Snapshot what's on disk now. Returns the version id. Throws if it can't
  // capture the tree completely (too many files, unreadable file): callers
  // must not change anything then.
  function snapshot() {
    const rels = candidates()
    if (rels.length > MAX_FILES) throw new Error(`more than ${MAX_FILES} files; code branches are for small prototypes`)
    const files = {}
    const skipped = []
    for (const rel of rels) {
      const full = path.join(root, rel)
      let st
      try {
        st = fs.lstatSync(full)
      } catch {
        continue // listed but gone (e.g. a tracked file deleted on disk): not part of this version
      }
      if (!st.isFile()) continue
      if (st.size > MAX_BYTES) {
        skipped.push(rel)
        continue
      }
      const buf = fs.readFileSync(full)
      const h = sha1(buf)
      const blob = path.join(blobs, h)
      if (!fs.existsSync(blob)) atomicWrite(blob, buf)
      files[rel] = h
    }
    const manifest = { files, skipped: skipped.sort() }
    const id = sha1(JSON.stringify(manifest)).slice(0, 10)
    const file = path.join(versionsDir, `${id}.json`)
    if (!fs.existsSync(file)) atomicWrite(file, JSON.stringify({ id, at: Date.now(), ...manifest }))
    return id
  }

  const load = (id) => (id && /^[0-9a-f]{10}$/.test(id) ? readJson(path.join(versionsDir, `${id}.json`)) : null)

  // What turning version `from` (what's on disk, just snapshotted) into `to`
  // means: writes for paths `to` captured that differ, deletes for paths `from`
  // captured that `to` positively didn't have. Nothing else is touched.
  function plan(from, to) {
    const writes = []
    const deletes = []
    for (const [rel, h] of Object.entries(to.files)) if (from.files[rel] !== h) writes.push([rel, h])
    const toSkipped = new Set(to.skipped)
    for (const rel of Object.keys(from.files)) {
      if (rel in to.files || toSkipped.has(rel)) continue
      deletes.push(rel)
    }
    return { writes, deletes }
  }

  function apply(p, onFile) {
    for (const [rel, h] of p.writes) {
      const full = path.join(root, rel)
      atomicWrite(full, fs.readFileSync(path.join(blobs, h)))
      onFile && onFile(full, h)
    }
    for (const rel of p.deletes) {
      const full = path.join(root, rel)
      try {
        fs.unlinkSync(full)
      } catch {}
      onFile && onFile(full, null)
    }
  }

  // Put version `id` on disk. Snapshots first; returns { ok, from, error }.
  function checkout(id, onFile) {
    const to = load(id)
    if (!to) return { ok: false, error: `unknown version ${id}` }
    let fromId
    try {
      fromId = snapshot()
    } catch (err) {
      return { ok: false, error: `refusing to switch code: couldn't snapshot the current files first (${err.message})` }
    }
    if (fromId === id) return { ok: true, from: fromId }
    const from = load(fromId)
    atomicWrite(journalFile, JSON.stringify({ from: fromId, to: id, at: Date.now() }))
    apply(plan(from, to), onFile)
    fs.rmSync(journalFile, { force: true })
    return { ok: true, from: fromId }
  }

  // An interrupted checkout leaves a journal: put the `from` version back.
  function recover(onFile) {
    const j = readJson(journalFile)
    if (!j) return null
    const from = load(j.from)
    if (!from) {
      fs.rmSync(journalFile, { force: true })
      return null
    }
    let nowId
    try {
      nowId = snapshot() // the half-switched state is kept as a version too
    } catch {
      return { error: "journal found but the tree can't be snapshotted; leaving files as they are" }
    }
    apply(plan(load(nowId), from), onFile)
    fs.rmSync(journalFile, { force: true })
    return { restored: j.from }
  }

  const state = () => readJson(stateFile, {})
  const saveState = (s) => atomicWrite(stateFile, JSON.stringify(s))

  return { dir, snapshot, load, checkout, recover, state, saveState, plan }
}

/**
 * @param {import("vite").ViteDevServer} server
 * @param {{ token?: string, bus?: ReturnType<typeof import("./server/api.js").createBus> }} [options]
 */
export function codeVersions(server, { token, bus } = {}) {
  const announce = () => bus && bus.emit("code-version", { version: current, newest })
  const root = server.config.root
  const store = createStore(root)
  const log = (msg) => server.config.logger.info(`  retake: ${msg}`, { timestamp: true })
  const warn = (msg) => server.config.logger.warn(`  retake: ${msg}`, { timestamp: true })

  // Files this process wrote or deleted during a checkout, so the watcher can
  // tell our own writes from the user's edits.
  const selfWrites = new Map() // full path -> hash (null for a delete)
  function invalidate(full) {
    /** @type {any[]} Vite's module graph and each environment's (Vite 6+) */
    const graphs = [server.moduleGraph, ...Object.values(server.environments || {}).map((e) => e.moduleGraph)]
    for (const graph of graphs) {
      for (const mod of (graph && graph.getModulesByFile && graph.getModulesByFile(full)) || []) graph.invalidateModule(mod)
    }
  }
  const onFile = (full, h) => {
    selfWrites.set(full, h)
    invalidate(full)
  }

  const rec = store.recover(onFile)
  // True while the files on disk are what this server put back at startup
  // (a rolled-back checkout, or the newest code after a crash), until the next
  // edit or checkout. The dock then checks out its active timeline's own code
  // instead of adopting what it finds on disk.
  let restoredAtStart = false
  if (rec && rec.restored) {
    warn(`an interrupted code checkout was rolled back to version ${rec.restored}`)
    restoredAtStart = true
  }
  if (rec && rec.error) warn(rec.error)

  let current
  let newest
  try {
    current = store.snapshot()
  } catch (err) {
    warn(`code branches are off: ${err.message}`)
    return
  }
  // Last run ended on an older timeline's code without getting to restore
  // (a crash)? If nothing changed since, put the newest version back.
  const prev = store.state()
  if (prev.newest && prev.current && prev.current !== prev.newest && prev.current === current && store.load(prev.newest)) {
    const r = store.checkout(prev.newest, onFile)
    if (r.ok) {
      log(`restored the newest code (version ${prev.newest}) left behind by the last run`)
      restoredAtStart = true
      current = prev.newest
    }
  }
  newest = current
  const persist = () => store.saveState({ current, newest })
  persist()

  /** @type {NodeJS.Timeout | undefined} */
  let pending
  server.watcher.on("all", (event, file) => {
    const rel = path.relative(root, file)
    if (rel.startsWith("..") || rel.split(path.sep).some((p) => SKIP.has(p))) return
    if (selfWrites.has(file)) {
      const expected = selfWrites.get(file)
      /** @type {string | null} */
      let actual = null
      try {
        actual = sha1(fs.readFileSync(file))
      } catch {}
      if (actual === expected) return // our own checkout write
      selfWrites.delete(file)
    }
    clearTimeout(pending)
    pending = setTimeout(() => {
      try {
        const id = store.snapshot()
        const changed = id !== current
        if (changed) restoredAtStart = false
        current = newest = id
        persist()
        if (changed) announce()
      } catch (err) {
        warn(`couldn't snapshot: ${err.message}`)
      }
    }, 120)
  })

  function checkout(id) {
    clearTimeout(pending)
    const r = store.checkout(id, onFile)
    if (r.ok) {
      restoredAtStart = false
      // Anything the snapshot-before-checkout captured that we hadn't seen yet
      // is the user's latest work.
      if (r.from !== current && r.from !== id) newest = r.from
      current = id
      persist()
      announce()
    } else warn(r.error)
    return r
  }

  // Leaving on an older timeline's code? Put the newest back first.
  let restored = false
  function restoreNewest() {
    if (restored) return
    restored = true
    if (current === newest) return
    const r = store.checkout(newest, onFile)
    if (r.ok) {
      current = newest
      persist()
      console.log(`\n  retake: restored the newest code (version ${newest}) on exit`)
    }
  }
  process.once("exit", restoreNewest)
  // A plain SIGINT/SIGHUP kills the process without an "exit" event, so catch
  // them, restore, then leave the way the signal would have.
  for (const [sig, code] of /** @type {[NodeJS.Signals, number][]} */ ([["SIGINT", 130], ["SIGHUP", 129], ["SIGTERM", 143]])) {
    process.once(sig, () => {
      restoreNewest()
      process.exit(code)
    })
  }
  server.httpServer && server.httpServer.once("close", restoreNewest)

  const json = (res, code, body) => {
    res.statusCode = code
    res.setHeader("Content-Type", "application/json")
    res.end(JSON.stringify(body))
  }

  server.middlewares.use((req, res, next) => {
    const url = new URL(req.url || "/", "http://x")
    if (url.pathname === "/__retake/version") return json(res, 200, { version: current, newest, restored: restoredAtStart })
    if (url.pathname === "/__retake/checkout") {
      // POST + token. A GET is accepted only from the dock's own origin
      // (Sec-Fetch-Site can't be forged by other sites) while the dock moves over.
      const tokenOk = token && req.headers["x-retake-token"] === token
      const sameOrigin = req.headers["sec-fetch-site"] === "same-origin"
      if (!(req.method === "POST" && tokenOk) && !(req.method === "GET" && sameOrigin)) {
        return json(res, 403, { ok: false, error: "checkout needs POST with x-retake-token" })
      }
      const r = checkout(url.searchParams.get("v"))
      // left: the snapshot taken just before switching, i.e. the real code of
      // the timeline being left (edits the version poll hadn't seen yet included).
      return json(res, r.ok ? 200 : 409, { ok: r.ok, version: current, left: r.from || null, error: r.error })
    }
    next()
  })

  return { store, checkout, get current() { return current }, get newest() { return newest } }
}
