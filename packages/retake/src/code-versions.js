// Code timelines: each timeline keeps its own code. Every time the project's
// source changes it's snapshotted as a version, and the edit belongs to the
// timeline that is checked out (the one the dock is in). With code timelines
// on, stepping into another timeline puts that timeline's code on disk, so an
// agent's edit for a note on Timeline 2 lands in Timeline 2 while Timeline 1
// still rebuilds on the code it was recorded with.
//
// The server owns this state (.retake/code-timelines.json, kept out of
// session.json so the dock's session saves can't overwrite it); the dock only
// shows it. One host (createCodeHost) serves every mode: the Vite plugin, the
// front server and Next's proxy.ts each give it a watcher, a way to hold the
// dev server's push updates while files change, and a way to wait until the
// dev server has caught up (CONTRACT.md "Code timelines").
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
//   interrupted is rolled back on the next start. Checkouts run one at a time.
// - Git's HEAD, index and refs are never touched; a checkout is refused while
//   git is busy, and a branch switch pauses swapping.
// - When Retake stops, the newest version is put back on disk.
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { execFileSync } from "node:child_process"

// Folders and files that are never part of a version: dependencies, build
// output, and what frameworks generate (they would fight a checkout).
export const SKIP = new Set(["node_modules", ".git", ".retake", "dist", "build", ".cache", ".vite", ".next", "coverage", ".svelte-kit", ".nuxt", ".output", ".astro", ".react-router", ".turbo", ".vercel", ".netlify"])
const SKIP_FILES = /(^|\/)next-env\.d\.ts$|\.gen\.[cm]?[jt]sx?$/
const MAX_FILES = 5000
const MAX_BYTES = 5 * 1024 * 1024
const LEASE_MS = 20 * 60 * 1000
const PRUNE_MS = 14 * 24 * 60 * 60 * 1000
const DEPS = /(^|\/)(package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?)$/

const sha1 = (buf) => crypto.createHash("sha1").update(buf).digest("hex")
const posix = (rel) => rel.split(path.sep).join("/")
const readJson = (file, /** @type {any} */ fallback = null) => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"))
  } catch {
    return fallback
  }
}
function atomicWrite(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.retake-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.tmp`
  fs.writeFileSync(tmp, data)
  fs.renameSync(tmp, file)
}

// .retake/ignore: more paths to leave out, in .gitignore syntax (globs, a
// trailing / for folders, a leading / to anchor, ! to take one back).
export function ignoreRules(text) {
  const rules = []
  for (let line of String(text || "").split(/\r?\n/)) {
    line = line.trim()
    if (!line || line.startsWith("#")) continue
    const neg = line.startsWith("!")
    if (neg) line = line.slice(1)
    const dir = line.endsWith("/")
    line = line.replace(/\/+$/, "")
    const anchored = line.startsWith("/") || line.includes("/")
    line = line.replace(/^\//, "")
    const body = line
      .split(/(\*\*\/?|\*|\?)/)
      .map((part) => (part === "**/" ? "(?:.*/)?" : part === "**" ? ".*" : part === "*" ? "[^/]*" : part === "?" ? "[^/]" : part.replace(/[.+^${}()|[\]\\]/g, "\\$&")))
      .join("")
    const re = new RegExp(`${anchored ? "^" : "(^|/)"}${body}${dir ? "/" : "(/|$)"}`)
    rules.push({ re, neg })
  }
  return (rel) => {
    let out = false
    for (const r of rules) if (r.re.test(rel) || (!r.neg && r.re.test(rel + "/"))) out = !r.neg
    return out
  }
}

// Where git keeps its state for `root` (null outside a repo).
function gitDirOf(root) {
  try {
    return execFileSync("git", ["-C", root, "rev-parse", "--absolute-git-dir"], { stdio: ["ignore", "pipe", "ignore"] }).toString().trim() || null
  } catch {
    return null
  }
}

export function createStore(root) {
  const dir = path.join(root, ".retake")
  const blobs = path.join(dir, "blobs")
  const versionsDir = path.join(dir, "versions")
  const journalFile = path.join(dir, "journal.json")
  const stateFile = path.join(dir, "code-state.json")
  const lockFile = path.join(dir, "code.lock")
  fs.mkdirSync(blobs, { recursive: true })
  fs.mkdirSync(versionsDir, { recursive: true })
  const ignore = path.join(dir, ".gitignore")
  if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, "*\n")

  const gitDir = gitDirOf(root)
  const git = !!gitDir
  // git names paths from its real top folder (/private/var/… for /var/… on macOS).
  const realRoot = (() => {
    try {
      return fs.realpathSync(root)
    } catch {
      return root
    }
  })()
  let ignored = ignoreRules("")
  let ignoreStamp = ""
  function readIgnore() {
    const f = path.join(dir, "ignore")
    let stamp = ""
    try {
      const st = fs.statSync(f)
      stamp = `${st.mtimeMs}:${st.size}`
    } catch {}
    if (stamp === ignoreStamp) return
    ignoreStamp = stamp
    ignored = ignoreRules(stamp ? fs.readFileSync(f, "utf8") : "")
  }
  // Is this path (relative to root) never part of a version?
  const skips = (rel) => {
    const p = posix(rel)
    return p.startsWith("..") || p.split("/").some((s) => SKIP.has(s)) || SKIP_FILES.test(p) || ignored(p)
  }

  // The files a snapshot owns: in a git repo, tracked + untracked-not-ignored;
  // otherwise a walk that skips dot entries and build/dependency folders.
  function candidates() {
    readIgnore()
    if (git) {
      const out = execFileSync("git", ["-C", root, "ls-files", "-z", "--cached", "--others", "--exclude-standard", "--full-name", "."], { maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] })
      const top = execFileSync("git", ["-C", root, "rev-parse", "--show-toplevel"], { stdio: ["ignore", "pipe", "ignore"] }).toString().trim()
      const rels = new Set()
      for (const name of out.toString().split("\0")) {
        if (!name) continue
        const rel = path.relative(realRoot, path.join(top, name))
        if (skips(rel)) continue
        rels.add(rel)
      }
      return [...rels].sort()
    }
    const rels = []
    const walk = (d) => {
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        if (SKIP.has(entry.name) || entry.name.startsWith(".")) continue
        const full = path.join(d, entry.name)
        const rel = path.relative(root, full)
        if (skips(rel)) continue
        if (entry.isDirectory()) walk(full)
        else if (entry.isFile()) rels.push(rel)
        if (rels.length > MAX_FILES) return
      }
    }
    walk(root)
    return rels.sort()
  }

  // Unchanged files (same size, mtime and inode) aren't read again.
  const seen = new Map()
  // Snapshot what's on disk now. Returns the version id. Throws if it can't
  // capture the tree completely (too many files, unreadable file): callers
  // must not change anything then.
  function snapshot() {
    const rels = candidates()
    if (rels.length > MAX_FILES) throw Object.assign(new Error(`more than ${MAX_FILES} files; code timelines are for prototypes`), { code: "too-many-files" })
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
      const key = `${st.size}:${st.mtimeMs}:${st.ino}`
      const known = seen.get(rel)
      if (known && known.key === key && fs.existsSync(path.join(blobs, known.h))) {
        files[rel] = known.h
        continue
      }
      const buf = fs.readFileSync(full)
      const h = sha1(buf)
      const blob = path.join(blobs, h)
      if (!fs.existsSync(blob)) atomicWrite(blob, buf)
      files[rel] = h
      seen.set(rel, { key, h })
    }
    const manifest = { files, skipped: skipped.sort() }
    const id = sha1(JSON.stringify(manifest)).slice(0, 10)
    const file = path.join(versionsDir, `${id}.json`)
    if (!fs.existsSync(file)) atomicWrite(file, JSON.stringify({ id, at: Date.now(), ...manifest }))
    else fs.utimesSync(file, new Date(), new Date()) // used again: not old
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

  // The files two versions differ in: [{ path, status: "added"|"modified"|"deleted" }].
  function diff(fromId, toId) {
    const a = load(fromId)
    const b = load(toId)
    if (!a || !b || fromId === toId) return []
    const out = []
    for (const [rel, h] of Object.entries(b.files)) if (a.files[rel] !== h) out.push({ path: posix(rel), status: rel in a.files ? "modified" : "added" })
    for (const rel of Object.keys(a.files)) if (!(rel in b.files)) out.push({ path: posix(rel), status: "deleted" })
    return out.sort((x, y) => x.path.localeCompare(y.path))
  }

  // A unified diff of two versions (git diff --no-index over the changed
  // files, written out to a temp folder), or null if git can't make one.
  function patch(fromId, toId, max = 64 * 1024) {
    const a = load(fromId)
    const b = load(toId)
    const files = diff(fromId, toId)
    if (!a || !b || !files.length) return null
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "retake-diff-"))
    try {
      for (const [side, v] of [["a", a], ["b", b]]) {
        fs.mkdirSync(path.join(tmp, side), { recursive: true })
        for (const f of files) {
          const h = v.files[f.path.split("/").join(path.sep)]
          if (!h) continue
          const to = path.join(tmp, side, f.path)
          fs.mkdirSync(path.dirname(to), { recursive: true })
          fs.copyFileSync(path.join(blobs, h), to)
        }
      }
      let out = ""
      try {
        out = execFileSync("git", ["diff", "--no-index", "--no-color", "a", "b"], { cwd: tmp, maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] }).toString()
      } catch (err) {
        if (err.status !== 1 || !err.stdout) return null // 1 = there were differences
        out = err.stdout.toString()
      }
      return out.length > max ? null : out
    } catch {
      return null
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
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

  // One checkout at a time across processes (a dev server and `retake code`).
  function withLock(fn) {
    let fd
    try {
      fd = fs.openSync(lockFile, "wx")
    } catch (err) {
      if (err.code !== "EEXIST") throw err
      const pid = Number(fs.readFileSync(lockFile, "utf8")) || 0
      let alive = false
      try {
        alive = pid > 0 && pid !== process.pid && (process.kill(pid, 0), true)
      } catch {}
      if (alive) return { ok: false, error: `another Retake process (pid ${pid}) is switching code right now` }
      fs.rmSync(lockFile, { force: true }) // left by a process that's gone
      fd = fs.openSync(lockFile, "wx")
    }
    try {
      fs.writeSync(fd, String(process.pid))
      fs.closeSync(fd)
      return fn()
    } finally {
      fs.rmSync(lockFile, { force: true })
    }
  }

  // Put version `id` on disk. Snapshots first; returns { ok, from, files, error }.
  function checkout(id, onFile) {
    const to = load(id)
    if (!to) return { ok: false, error: `unknown version ${id}` }
    return withLock(() => {
      let fromId
      try {
        fromId = snapshot()
      } catch (err) {
        return { ok: false, error: `refusing to switch code: couldn't snapshot the current files first (${err.message})` }
      }
      if (fromId === id) return { ok: true, from: fromId, files: [] }
      const from = load(fromId)
      const p = plan(from, to)
      atomicWrite(journalFile, JSON.stringify({ from: fromId, to: id, at: Date.now() }))
      apply(p, onFile)
      fs.rmSync(journalFile, { force: true })
      const files = [...p.writes.map(([rel]) => ({ path: posix(rel), change: "write" })), ...p.deletes.map((rel) => ({ path: posix(rel), change: "delete" }))]
      return { ok: true, from: fromId, files }
    })
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

  // Versions nothing points at, older than `age`, go (with blobs no version uses).
  function prune(keep, age = PRUNE_MS) {
    const now = Date.now()
    let removed = 0
    const names = fs.readdirSync(versionsDir).filter((f) => f.endsWith(".json"))
    for (const f of names) {
      const id = f.slice(0, -5)
      if (keep.has(id)) continue
      try {
        if (now - fs.statSync(path.join(versionsDir, f)).mtimeMs < age) continue
      } catch {
        continue
      }
      fs.rmSync(path.join(versionsDir, f), { force: true })
      removed++
    }
    if (!removed) return 0
    const used = new Set()
    for (const f of fs.readdirSync(versionsDir)) {
      const v = readJson(path.join(versionsDir, f))
      if (v && v.files) for (const h of Object.values(v.files)) used.add(h)
    }
    for (const h of fs.readdirSync(blobs)) if (!used.has(h) && /^[0-9a-f]{40}$/.test(h)) fs.rmSync(path.join(blobs, h), { force: true })
    return removed
  }

  const list = () =>
    fs
      .readdirSync(versionsDir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => readJson(path.join(versionsDir, f)))
      .filter(Boolean)
      .map((v) => ({ id: v.id, at: v.at, files: Object.keys(v.files).length }))
      .sort((a, b) => a.at - b.at)

  const state = () => readJson(stateFile, {})
  const saveState = (s) => atomicWrite(stateFile, JSON.stringify(s))
  const blob = (h) => fs.readFileSync(path.join(blobs, h))

  return { dir, root, realRoot, git, gitDir, skips, snapshot, load, checkout, recover, state, saveState, plan, diff, patch, prune, list, blob, withLock }
}

// ---- git: is it busy, has HEAD moved ------------------------------------------------

function gitBusy(gitDir) {
  if (!gitDir) return null
  for (const [f, what] of [["index.lock", "an index.lock is held"], ["rebase-merge", "a rebase is in progress"], ["rebase-apply", "a rebase is in progress"], ["MERGE_HEAD", "a merge is in progress"], ["CHERRY_PICK_HEAD", "a cherry-pick is in progress"], ["REVERT_HEAD", "a revert is in progress"]]) {
    if (fs.existsSync(path.join(gitDir, f))) return what
  }
  return null
}
// "refs/heads/main@<sha>" (or a detached sha): what HEAD is now.
function gitHead(root, gitDir) {
  if (!gitDir) return null
  try {
    const head = fs.readFileSync(path.join(gitDir, "HEAD"), "utf8").trim()
    const sha = execFileSync("git", ["-C", root, "rev-parse", "-q", "--verify", "HEAD"], { stdio: ["ignore", "pipe", "ignore"] }).toString().trim()
    return `${head}@${sha}`
  } catch {
    try {
      return fs.readFileSync(path.join(gitDir, "HEAD"), "utf8").trim() // a repo with no commits yet
    } catch {
      return null
    }
  }
}

// ---- a timeline's code as a git branch (plumbing only) --------------------------------

/**
 * Commit a version on top of HEAD as `refs/heads/<branch>`, through a temporary
 * index: the working tree, the real index and HEAD are never touched.
 * @returns {{ branch: string, commit: string }}
 */
export function exportVersion(store, id, { branch, message }) {
  const v = store.load(id)
  if (!v) throw new Error(`unknown version ${id}`)
  if (!store.git) throw new Error("not a git repository")
  const root = store.root
  const run = (args, opts = {}) => execFileSync("git", ["-C", root, ...args], { stdio: ["pipe", "pipe", "pipe"], maxBuffer: 256 * 1024 * 1024, ...opts }).toString().trim()
  if (!/^[\w./-]+$/.test(branch) || branch.includes("..")) throw new Error(`bad branch name ${branch}`)
  const top = run(["rev-parse", "--show-toplevel"])
  const prefix = posix(path.relative(top, store.realRoot))
  const tmpIndex = path.join(os.tmpdir(), `retake-index-${process.pid}-${Date.now()}`)
  const env = { ...process.env, GIT_INDEX_FILE: tmpIndex }
  try {
    /** @type {string | null} */
    let parent = null
    try {
      parent = run(["rev-parse", "-q", "--verify", "HEAD"])
    } catch {}
    if (parent) run(["read-tree", parent], { env })
    // HEAD's entries under the project that the version owns but doesn't have.
    const modes = new Map()
    if (parent) {
      const listed = run(["ls-tree", "-r", "-z", "--full-tree", parent], {}).split("\0").filter(Boolean)
      for (const line of listed) {
        const tab = line.indexOf("\t")
        const [mode] = line.slice(0, tab).split(" ")
        const name = line.slice(tab + 1)
        modes.set(name, mode)
      }
    }
    const lines = []
    const files = new Map(Object.entries(v.files).map(([rel, h]) => [(prefix ? prefix + "/" : "") + posix(rel), h]))
    const skipped = new Set(v.skipped.map((rel) => (prefix ? prefix + "/" : "") + posix(rel)))
    for (const [name] of modes) {
      if (prefix && !name.startsWith(prefix + "/")) continue
      const rel = prefix ? name.slice(prefix.length + 1) : name
      if (files.has(name) || skipped.has(name) || store.skips(rel)) continue
      lines.push(`0 ${"0".repeat(40)}\t${name}`)
    }
    for (const [name, h] of files) {
      const sha = run(["hash-object", "-w", "--stdin"], { input: store.blob(h) })
      lines.push(`${modes.get(name) === "100755" ? "100755" : "100644"} ${sha}\t${name}`)
    }
    if (lines.length) run(["update-index", "--index-info"], { env, input: lines.join("\n") + "\n" })
    const tree = run(["write-tree"], { env })
    const commit = run(["commit-tree", tree, ...(parent ? ["-p", parent] : []), "-m", message], {})
    run(["update-ref", `refs/heads/${branch}`, commit])
    return { branch, commit }
  } finally {
    fs.rmSync(tmpIndex, { force: true })
  }
}

// ---- the host -------------------------------------------------------------------------

/**
 * The code timelines' state and routes for one project. Each mode supplies:
 *   `invalidate(file)`: forget a file a checkout rewrote (Vite's module graphs)
 *   `hold()`: stop the dev server's push updates reaching the page while files
 *     change; returns { resume(), done() } (resume: the checkout failed)
 *   `settle({ url })`: wait until the dev server has caught up with the new files
 *   `signals`: put the newest code back on SIGINT/SIGTERM/SIGHUP and exit (Vite)
 *   `restoreOnExit: false`, `recoverCrash: false`: leave the code as it is when the
 *     process exits, and don't put the newest back after a crash (`retake code`,
 *     where what's on disk is the user's call)
 * Its watcher calls `onWatch(fullPath)` for every change it sees.
 * @param {{ root: string, token?: string, bus?: { emit(event: string, data: any): void } | null,
 *   sessions?: { getSession(): any, putSession(s: any): void } | null, enabled?: boolean | "ask" | null,
 *   invalidate?: ((file: string) => void) | null, hold?: (() => { resume(): void, done(): void } | null) | null,
 *   settle?: ((o: { url?: string }) => Promise<void>) | null, signals?: boolean, quiet?: boolean, restoreOnExit?: boolean, recoverCrash?: boolean, leaseMs?: number,
 *   log?: (msg: string) => void, warn?: (msg: string) => void }} options
 */
export function createCodeHost(options) {
  const { root, token, bus = null, sessions = null, invalidate = null, hold = null, settle = null, quiet = false } = options
  const log = options.log || ((msg) => !quiet && console.log(`  retake: ${msg}`))
  const warn = options.warn || ((msg) => !quiet && console.warn(`  retake: ${msg}`))
  const store = createStore(root)
  const file = path.join(store.dir, "code-timelines.json")
  const settingsFile = path.join(store.dir, "settings.json")

  /** @type {{ timelines: Record<string, { fork: string, head: string, at?: number }>, deleted: Record<string, { fork: string, head: string, name?: string, at?: number }>,
   *   checkedOut: any, newest: any, disk: any, lease: any, leaseLost: any, suspended: string | null, gitHead: string | null, offEdits?: any, running?: number | null }}
   *   (checkedOut: a timeline id as a string; lease: { note, branchId, at } while an agent edits a note's timeline) */
  const st = { timelines: {}, deleted: {}, checkedOut: null, newest: null, disk: null, lease: null, leaseLost: null, suspended: null, gitHead: null, ...readJson(file, {}) }
  let signalsReady = false // (needRestore's state is declared further down)
  const persist = () => {
    try {
      atomicWrite(file, JSON.stringify(st, null, 1))
    } catch (err) {
      warn(`couldn't save the code timelines (${err.message})`)
    }
    // Timelines whose code differs: stopping has something to say (or put back).
    if (signalsReady && enabled === true && Object.values(st.timelines).some((t) => t.head !== st.newest)) needRestore()
  }

  // On, off, or "ask" (not chosen yet: snapshots run, nothing is swapped).
  // A flag or plugin option wins for this run; otherwise the project's answer.
  const forced = options.enabled === true || options.enabled === false ? options.enabled : null
  const saved = readJson(settingsFile, {}).codeTimelines
  /** @type {boolean | "ask"} */
  let enabled = forced != null ? forced : saved === true || saved === false ? saved : "ask"

  const emit = (event, data) => bus && bus.emit(event, data)
  const sessionNow = () => (sessions ? sessions.getSession() : { branches: [], activeId: null, notes: [] })
  const nameOf = (id, session = sessionNow()) => {
    const b = (session.branches || []).find((x) => String(x.id) === String(id))
    return (b && b.name) || (st.deleted[id] && st.deleted[id].name) || `Timeline ${id}`
  }

  // Files this process wrote or deleted during a checkout, so the watcher can
  // tell our own writes from the user's edits.
  const selfWrites = new Map() // full path -> hash (null for a delete)
  const onFile = (full, h) => {
    selfWrites.set(full, h)
    if (invalidate) {
      try {
        invalidate(full)
      } catch {}
    }
  }

  // One thing at a time: a checkout, a watcher snapshot, a resolve's snapshot.
  /** @type {Promise<any>} */
  let chain = Promise.resolve()
  const exclusive = (fn) => {
    const p = chain.then(fn, fn)
    chain = p.catch(() => {})
    return p
  }

  // ---- start: roll back a half-done switch, put the newest code back after a crash
  /** True while what's on disk is what this server put back at startup, until the next edit or checkout. */
  let restoredAtStart = false
  const rec = store.recover(onFile)
  if (rec && rec.restored) {
    warn(`an interrupted code checkout was rolled back to version ${rec.restored}`)
    restoredAtStart = true
  }
  if (rec && rec.error) warn(rec.error)
  // Did the last dev server stop without putting the newest code back (a
  // crash, a SIGKILL)? It says it's running while it is. (`retake code
  // checkout` leaves older code on disk on purpose: that's not a crash.)
  const alive = (pid) => {
    try {
      return process.kill(pid, 0), true
    } catch (err) {
      return err.code === "EPERM"
    }
  }
  /** Edits made while Retake was off went to this timeline (the dock says so, for a while). */
  /** @type {{ id: string, until: number } | null} */
  let offEdits = null
  delete st.offEdits
  let crashed = !!st.running && st.running !== process.pid && !alive(st.running) && options.recoverCrash !== false
  // The code-branches file of older versions.
  const legacy = store.state()
  if (!st.newest && legacy.newest) {
    st.newest = legacy.newest
    st.disk = legacy.current || null
    crashed = true
  }

  let ready = true
  try {
    const now = store.snapshot()
    // Stopped on an older timeline's code without getting to put the newest
    // back (a crash, a SIGKILL)? If nothing changed since, put it back now.
    if (crashed && st.newest && st.disk && st.disk !== st.newest && now === st.disk && store.load(st.newest)) {
      const r = store.checkout(st.newest, onFile)
      if (r.ok) {
        log(`restored the newest code (version ${st.newest}) left behind by the last run`)
        restoredAtStart = true
        st.disk = st.newest
        const owner = Object.keys(st.timelines).find((id) => st.timelines[id].head === st.newest)
        if (owner) st.checkedOut = owner
      }
    } else {
      const was = st.disk
      st.disk = now
      if (now !== was) {
        // Edited while Retake was off: the edits go to the timeline whose code was left on disk.
        const owner = was ? Object.keys(st.timelines).find((id) => st.timelines[id].head === was) : null
        if (owner) {
          st.timelines[owner].head = now
          st.checkedOut = owner
          offEdits = { id: owner, until: Date.now() + 120_000 }
        }
        st.newest = now
      } else if (!st.newest) st.newest = now
    }
    if (st.suspended === "too-many-files" || st.suspended === "snapshot-failed") st.suspended = null
  } catch (err) {
    st.suspended = err.code === "too-many-files" ? "too-many-files" : "snapshot-failed"
    warn(`code timelines are off: ${err.message}`)
    ready = false
  }
  if (!st.gitHead) st.gitHead = gitHead(root, store.gitDir)
  if (options.restoreOnExit !== false) st.running = process.pid
  // Old versions nothing points at.
  try {
    const keep = new Set([st.newest, st.disk].filter(Boolean))
    for (const t of [...Object.values(st.timelines), ...Object.values(st.deleted)]) keep.add(t.fork), keep.add(t.head)
    for (const n of sessionNow().notes || []) for (const v of [n.codeVersion, n.resolvedVersion]) v && keep.add(v)
    store.prune(keep)
  } catch {}
  persist()

  // ---- the timelines ------------------------------------------------------------
  /** @returns {any} a timeline id as the state keys it (a string), or null */
  const key = (id) => (id == null ? null : String(id))
  // A timeline seen for the first time starts on its parent's code (or what's on disk).
  function ensure(id, parentId) {
    id = key(id)
    if (!id) return null
    if (st.timelines[id]) return st.timelines[id]
    const parent = parentId != null && st.timelines[key(parentId)]
    const v = (parent && parent.head) || (st.checkedOut && st.timelines[st.checkedOut] && st.timelines[st.checkedOut].head) || st.disk
    if (!v) return null
    delete st.deleted[id]
    return (st.timelines[id] = { fork: v, head: v, at: Date.now() })
  }

  // How a timeline's code differs from its fork (cached per pair).
  const diffCache = new Map()
  const changedFiles = (a, b) => {
    if (!a || !b || a === b) return []
    const k = `${a}:${b}`
    if (!diffCache.has(k)) {
      if (diffCache.size > 200) diffCache.clear()
      diffCache.set(k, store.diff(a, b))
    }
    return diffCache.get(k)
  }

  const leaseMs = options.leaseMs || LEASE_MS
  const leaseActive = () => !!st.lease && Date.now() - st.lease.at < leaseMs
  function publicState() {
    const session = sessionNow()
    const timelines = {}
    for (const [id, t] of Object.entries(st.timelines)) {
      const files = changedFiles(t.fork, t.head)
      timelines[id] = { fork: t.fork, head: t.head, changed: files.length, files: files.slice(0, 20).map((f) => f.path) }
    }
    const deleted = {}
    for (const [id, t] of Object.entries(st.deleted)) deleted[id] = { fork: t.fork, head: t.head, name: t.name || null }
    return {
      enabled,
      checkedOut: st.checkedOut != null ? Number(st.checkedOut) || st.checkedOut : null,
      checkedOutName: st.checkedOut != null ? nameOf(st.checkedOut, session) : null,
      disk: st.disk,
      version: st.disk, // what older docks read
      newest: st.newest,
      suspended: st.suspended,
      lease: leaseActive() ? { ...st.lease, branchId: Number(st.lease.branchId) || st.lease.branchId, name: nameOf(st.lease.branchId, session) } : null,
      leaseLost: st.leaseLost,
      offEdits: offEdits && Date.now() < offEdits.until ? Number(offEdits.id) || offEdits.id : null,
      restored: restoredAtStart,
      timelines,
      deleted,
    }
  }
  const announce = (reason, extra = {}) => emit("code-version", { reason, ...extra, ...publicState() })

  // ---- the watcher's side: an edit belongs to the checked-out timeline -----------
  /** @type {NodeJS.Timeout | undefined} */
  let pending
  function onWatch(full) {
    if (!full) return
    const rel = path.relative(root, full)
    if (!rel || store.skips(rel) || /\.(tmp|swp)$|~$/.test(rel)) return
    if (selfWrites.has(full)) {
      const expected = selfWrites.get(full)
      /** @type {string | null} */
      let actual = null
      try {
        actual = sha1(fs.readFileSync(full))
      } catch {}
      if (actual === expected) return // our own checkout write
      selfWrites.delete(full)
    }
    schedule()
  }
  function schedule() {
    clearTimeout(pending)
    pending = setTimeout(() => {
      pending = undefined
      exclusive(() => observe())
    }, 120)
  }
  // Snapshot now and give a change to the timeline that's checked out.
  function observe() {
    let id
    try {
      id = store.snapshot()
    } catch (err) {
      const why = err.code === "too-many-files" ? "too-many-files" : "snapshot-failed"
      if (st.suspended !== why) {
        st.suspended = why
        warn(`code timelines paused: ${err.message}`)
        persist()
        announce("suspended")
      }
      return null
    }
    if (st.suspended === "too-many-files" || st.suspended === "snapshot-failed") st.suspended = null
    const head = gitHead(root, store.gitDir)
    const moved = head !== st.gitHead
    if (id === st.disk) {
      if (moved) {
        st.gitHead = head // a commit: same files, nothing to do
        persist()
      }
      return id
    }
    st.disk = id
    restoredAtStart = false
    if (moved && head && st.gitHead) {
      // A branch switch, pull or stash changed the files: not an edit to any timeline.
      st.gitHead = head
      if (!st.suspended) {
        st.suspended = "git-branch-changed"
        warn("git branch changed: code swapping is paused until you resume it in the dock")
      }
      persist()
      announce("suspended")
      return id
    }
    st.gitHead = head
    if (st.suspended) {
      persist()
      announce("edit")
      return id
    }
    const t = st.checkedOut && st.timelines[st.checkedOut]
    if (t) t.head = id
    st.newest = id
    persist()
    announce("edit", { branchId: st.checkedOut != null ? Number(st.checkedOut) || st.checkedOut : null })
    return id
  }

  // ---- checkout -------------------------------------------------------------------
  let signalsSet = false
  signalsReady = true
  if (enabled === true && Object.values(st.timelines).some((t) => t.head !== st.newest)) needRestore()
  const refuse = (status, error, extra = {}) => ({ ok: false, status, error, ...extra })
  function setActive(id, by, note) {
    if (!sessions) return
    const s = sessions.getSession()
    if (!(s.branches || []).some((b) => String(b.id) === String(id)) || String(s.activeId) === String(id)) return
    serverActive = { id: s.branches.find((b) => String(b.id) === String(id)).id, prev: s.activeId, at: Date.now() }
    s.activeId = serverActive.id
    sessions.putSession(s)
    emit("active-changed", { activeId: s.activeId, by, note: note ?? null })
  }
  /** @type {{ id: any, prev: any, at: number } | null} */
  let serverActive = null

  /**
   * Put a timeline's code on disk (with code timelines on), or just make it the
   * one edits land on (off or "ask": every timeline shares the files).
   * @param {any} branchId
   * @param {{ reason?: string, force?: boolean, note?: any, url?: string, parentId?: any, follow?: boolean }} [o]
   */
  function checkout(branchId, o = {}) {
    return exclusive(async () => {
      const id = key(branchId)
      const reason = o.reason || "dock"
      clearTimeout(pending)
      pending = undefined
      const session = sessionNow()
      const known = (session.branches || []).some((b) => String(b.id) === id)
      if (!st.timelines[id] && !(known || o.parentId != null || reason === "fork")) return refuse(404, `no timeline ${branchId}`)
      if (!ensure(id, o.parentId ?? ((session.branches || []).find((b) => String(b.id) === id) || {}).parentId)) return refuse(409, "no code snapshot yet")
      if (leaseActive() && st.lease.branchId !== id && enabled === true) {
        if (!o.force) return refuse(409, `${nameOf(st.lease.branchId, session)} is checked out for note ${st.lease.note} (an agent is editing it)`, { lease: publicState().lease })
        st.leaseLost = { ...st.lease, at: Date.now(), to: id }
        st.lease = null
      }
      const finish = (extra) => {
        if (reason === "note" && o.note != null && enabled === true) st.lease = { note: o.note, branchId: id, at: Date.now() }
        persist()
        if (o.follow !== false && reason !== "dock" && reason !== "fork") setActive(id, reason === "note" || reason === "mcp" ? "agent" : reason, o.note)
        return { ok: true, branchId: Number(id) || id, name: nameOf(id), version: st.timelines[id].head, enabled, ...extra }
      }
      if (enabled !== true || reason === "fork") {
        // Shared code (or a new timeline, which starts on the code on disk): no files move.
        const was = st.checkedOut
        st.checkedOut = id
        if (was !== id) announce("follow", { branchId: Number(id) || id })
        return finish({ files: [], swapped: false })
      }
      // Edits the watcher hasn't snapshotted yet belong to the timeline checked out now.
      observe()
      if (st.suspended) return refuse(409, st.suspended === "git-branch-changed" ? "git branch changed: code swapping is paused (resume it in the dock)" : `code timelines are paused (${st.suspended})`, { suspended: st.suspended })
      const busy = gitBusy(store.gitDir)
      if (busy) return refuse(409, `git is busy (${busy}); try again when it's done`, { gitBusy: busy })
      const target = st.timelines[id].head
      const leaving = st.checkedOut
      const t0 = Date.now()
      const held = target !== st.disk && hold ? hold() : null
      const r = store.checkout(target, onFile)
      if (!r.ok) {
        held && held.resume()
        warn(r.error)
        return refuse(409, r.error)
      }
      held && held.done()
      // What was on disk just before belongs to the timeline we left (edits the
      // watcher hadn't seen yet included).
      if (r.from !== st.disk || (leaving && st.timelines[leaving] && st.timelines[leaving].head !== r.from)) {
        if (leaving && st.timelines[leaving] && leaving !== id) st.timelines[leaving].head = r.from
        if (r.from !== target) st.newest = r.from
      }
      st.disk = target
      st.checkedOut = id
      restoredAtStart = false
      if (r.files.length) needRestore()
      // `retake code checkout` after a crash: what's on disk is now the user's call.
      if (options.restoreOnExit === false && st.running && !alive(st.running)) st.running = null
      persist()
      if (r.files.length && settle) {
        try {
          await settle({ url: o.url })
        } catch {}
      }
      announce("checkout", { branchId: Number(id) || id, files: r.files })
      return finish({ files: r.files, swapped: r.files.length > 0, left: r.from, settledMs: Date.now() - t0, deps: r.files.some((f) => DEPS.test(f.path)) })
    })
  }

  // A version straight onto disk (`retake code restore`, the old ?v= route).
  // It becomes the code of the timeline whose head it is, else of the one
  // checked out.
  function checkoutVersion(v) {
    return exclusive(async () => {
      clearTimeout(pending)
      pending = undefined
      if (enabled !== true) return refuse(409, "code timelines are off: the files aren't swapped")
      if (!store.load(v)) return refuse(409, `unknown version ${v}`)
      observe()
      const busy = gitBusy(store.gitDir)
      if (busy) return refuse(409, `git is busy (${busy}); try again when it's done`)
      const held = v !== st.disk && hold ? hold() : null
      const r = store.checkout(v, onFile)
      if (!r.ok) {
        held && held.resume()
        return refuse(409, r.error)
      }
      held && held.done()
      if (r.from !== st.disk && r.from !== v) st.newest = r.from
      const owner = Object.keys(st.timelines).find((id) => st.timelines[id].head === v)
      if (owner) st.checkedOut = owner
      else if (st.checkedOut && st.timelines[st.checkedOut] && st.timelines[st.checkedOut].head !== r.from) {
        // keep the checked-out timeline's head: the version is only on disk
      }
      st.disk = v
      restoredAtStart = false
      if (r.files.length) needRestore()
      if (options.restoreOnExit === false && st.running && !alive(st.running)) st.running = null
      persist()
      if (r.files.length && settle) await settle({}).catch(() => {})
      announce("checkout", { files: r.files })
      return { ok: true, version: v, left: r.from, files: r.files }
    })
  }

  function setEnabled(on) {
    return exclusive(async () => {
      enabled = !!on
      const s = readJson(settingsFile, {})
      atomicWrite(settingsFile, JSON.stringify({ ...s, codeTimelines: enabled }, null, 1))
      announce("enabled")
      return { ok: true, enabled }
    }).then(async (r) => {
      // Turned on while the files aren't the checked-out timeline's code
      // (edits made with shared code on another timeline): put its code back.
      const t = st.checkedOut && st.timelines[st.checkedOut]
      if (enabled === true && t && st.disk && t.head !== st.disk && !st.suspended) {
        const c = await checkout(st.checkedOut, { reason: "enable", follow: false })
        return { ...r, files: c.files || [] }
      }
      return r
    })
  }

  function resume() {
    return exclusive(async () => {
      const id = observe()
      st.suspended = null
      st.gitHead = gitHead(root, store.gitDir)
      const t = st.checkedOut && st.timelines[st.checkedOut]
      if (t && id) t.head = id
      if (id) st.newest = id
      persist()
      announce("resumed")
      return { ok: true }
    })
  }

  // ---- the session's side ------------------------------------------------------------
  // Called with a session the dock is about to save (and what was saved before).
  function onSession(next, before) {
    if (!next || !Array.isArray(next.branches)) return
    // The server just moved the dock (an agent took a timeline): a save from
    // before the dock heard about it doesn't move it back.
    const moved = serverActive
    if (moved && Date.now() - moved.at < 5000 && String(next.activeId) === String(moved.prev) && next.branches.some((b) => String(b.id) === String(moved.id))) next.activeId = moved.id
    let changed = false
    const ids = new Set(next.branches.map((b) => key(b.id)))
    // Parents first, so a child forks from its parent's code.
    const order = [...next.branches].sort((a, b) => Number(a.id) - Number(b.id))
    for (const b of order) {
      if (!st.timelines[key(b.id)]) {
        ensure(b.id, b.parentId)
        changed = true
      }
    }
    const names = new Map(((before && before.branches) || []).map((b) => [key(b.id), b.name]))
    for (const id of Object.keys(st.timelines)) {
      if (ids.has(id)) continue
      st.deleted[id] = { ...st.timelines[id], name: names.get(id) || `Timeline ${id}`, at: Date.now() }
      delete st.timelines[id]
      changed = true
    }
    if (st.checkedOut && !st.timelines[st.checkedOut]) {
      // The checked-out timeline went (Start fresh): what's on disk is now the active one's code.
      st.checkedOut = key(next.activeId)
      if (st.checkedOut && st.timelines[st.checkedOut] && st.disk) st.timelines[st.checkedOut].head = st.disk
      changed = true
    }
    if (!st.checkedOut && next.activeId != null && st.timelines[key(next.activeId)]) {
      st.checkedOut = key(next.activeId)
      changed = true
    }
    // Shared code: edits land on whichever timeline the dock is in.
    if (enabled !== true && next.activeId != null && key(next.activeId) !== st.checkedOut && st.timelines[key(next.activeId)]) {
      st.checkedOut = key(next.activeId)
      changed = true
    }
    // The server's word on each timeline's code (what the dock sent is ignored).
    for (const b of next.branches) {
      const t = st.timelines[key(b.id)]
      if (t) b.codeVersion = t.head
    }
    // Notes: the code they were made on, kept across saves (the dock doesn't keep these fields).
    const old = new Map(((before && before.notes) || []).map((n) => [String(n.id), n]))
    for (const n of next.notes || []) {
      const prev = old.get(String(n.id))
      if (prev && prev.codeVersion && !n.codeVersion) n.codeVersion = prev.codeVersion
      if (prev && prev.resolvedVersion && !n.resolvedVersion) n.resolvedVersion = prev.resolvedVersion
      if (!n.codeVersion) {
        const t = st.timelines[key(n.branchId)]
        if (t) n.codeVersion = t.head
      }
    }
    if (changed) {
      persist()
      announce("session")
    }
  }
  // A session read: each timeline's code from here.
  function decorate(s) {
    for (const b of (s && s.branches) || []) {
      const t = st.timelines[key(b.id)]
      if (t) b.codeVersion = t.head
    }
    return s
  }
  // A note changed through PATCH (an agent resolving it, say).
  // Returns fields to add to the note.
  async function onNotePatch(note, body) {
    /** @type {Record<string, any> | null} */
    let extra = null
    if (body && body.status === "resolved") {
      await exclusive(() => observe()) // the agent's last edit, if the watcher hasn't seen it yet
      const t = st.timelines[key(note.branchId)]
      if (t) extra = { resolvedVersion: t.head }
    }
    const ends = body && (body.status === "resolved" || body.status === "dismissed" || (body.reply && /\?\s*$/.test(typeof body.reply === "string" ? body.reply : body.reply.text || "")))
    if (ends && st.lease && String(st.lease.note) === String(note.id)) {
      st.lease = null
      persist()
      announce("lease")
    }
    if (body && body.status === "resolved" && st.leaseLost && String(st.leaseLost.note) === String(note.id)) {
      st.leaseLost = null
      persist()
    }
    return extra
  }

  // ---- exit: the newest code goes back on disk ----------------------------------------
  let restored = false
  function restoreNewest() {
    if (restored) return
    restored = true
    clearTimeout(pending)
    if (st.running === process.pid) {
      st.running = null
      persist()
    }
    if (!st.newest) return
    // The newest is already on disk: nothing to put back, but with code
    // timelines on the other timelines' code (an agent's edit, say) is only in
    // .retake/, so say so.
    const swap = st.disk !== st.newest
    if (!swap && enabled !== true) return
    if (swap && !store.load(st.newest)) return
    if (swap) {
      const r = store.checkout(st.newest, onFile)
      if (!r.ok) return warn(`couldn't put the newest code back (${r.error}); run "retake code restore"`)
    }
    const session = sessionNow()
    const owner = Object.keys(st.timelines).find((id) => st.timelines[id].head === st.newest)
    st.disk = st.newest
    if (owner) st.checkedOut = owner
    persist()
    const others = Object.keys(st.timelines).filter((id) => id !== owner && st.timelines[id].head !== st.newest)
    if (!swap && !(owner && others.length)) return
    const msg = owner
      ? `left ${nameOf(owner, session)}'s code on disk (newest).${others.length ? ` ${others.map((id) => nameOf(id, session)).join(", ")} ${others.length > 1 ? "are" : "is"} kept in .retake/. Run "retake code checkout ${others[0]}" to see it.` : ""}`
      : `restored the newest code (version ${st.newest}) on exit`
    // (Written at once: the process may be exiting, and a piped stdout is asynchronous.)
    if (!quiet) {
      try {
        fs.writeSync(1, `\n  retake: ${msg}\n`)
      } catch {}
    }
  }
  // Vite's process: a plain SIGINT/SIGHUP kills it without an "exit" event, so
  // catch them (only once there's something to put back), restore, then leave
  // the way the signal would have.
  function needRestore() {
    if (signalsSet || !options.signals) return
    signalsSet = true
    for (const [sig, code] of /** @type {[NodeJS.Signals, number][]} */ ([["SIGINT", 130], ["SIGHUP", 129], ["SIGTERM", 143]])) {
      process.once(sig, () => {
        restoreNewest()
        process.exit(code)
      })
    }
  }
  const onExit = () => restoreNewest()
  if (options.restoreOnExit !== false) process.once("exit", onExit)

  // ---- HTTP ------------------------------------------------------------------------------
  const send = (res, code, body) => {
    res.statusCode = code
    res.setHeader("Content-Type", "application/json")
    res.setHeader("Cache-Control", "no-store")
    res.end(JSON.stringify(body))
  }
  const readBody = (req) =>
    new Promise((resolve) => {
      let s = ""
      req.on("data", (c) => (s += c))
      req.on("end", () => {
        try {
          resolve(s ? JSON.parse(s) : {})
        } catch {
          resolve({})
        }
      })
      req.on("error", () => resolve({}))
    })
  const reply = (res, r) => send(res, r.ok === false ? r.status || 409 : 200, r)

  //   GET  /__retake/code                 the state (enabled, checkedOut, each timeline's fork/head/changed)
  //   POST /__retake/code/checkout        { branchId, reason?, force?, note?, url?, parentId? }
  //   GET  /__retake/code/diff?branch=2&against=fork|<branchId>
  //   POST /__retake/code/enabled         { on }
  //   POST /__retake/code/resume          after a git branch switch
  //   POST /__retake/code/restore         { version? } (default: the newest)
  //   GET  /__retake/version, POST /__retake/checkout?v=   (older docks; one more release)
  async function handler(req, res, next) {
    const url = new URL(req.url || "/", "http://x")
    const p = url.pathname
    if (!p.startsWith("/__retake/")) return next()
    // Any call from an agent's MCP server keeps its lease alive.
    if (st.lease && req.headers["x-retake-client"] === "mcp") st.lease.at = Date.now()
    const isCode = p === "/__retake/code" || p.startsWith("/__retake/code/")
    const legacy = p === "/__retake/version" || p === "/__retake/checkout"
    if (!isCode && !legacy) return next()
    const tokenOk = !!token && req.headers["x-retake-token"] === token
    if (p === "/__retake/version") return send(res, 200, { version: st.disk, newest: st.newest, restored: restoredAtStart })
    if (p === "/__retake/checkout") {
      // POST + token. A GET is accepted only from the dock's own origin
      // (Sec-Fetch-Site can't be forged by other sites).
      const sameOrigin = req.headers["sec-fetch-site"] === "same-origin"
      if (!(req.method === "POST" && tokenOk) && !(req.method === "GET" && sameOrigin)) return send(res, 403, { ok: false, error: "checkout needs POST with x-retake-token" })
      if (enabled !== true) return send(res, 409, { ok: false, error: "code timelines are off" })
      const v = url.searchParams.get("v")
      const owner = Object.keys(st.timelines).find((id) => st.timelines[id].head === v)
      const r = owner ? await checkout(owner, { reason: "dock" }) : await checkoutVersion(v)
      return send(res, r.ok ? 200 : 409, { ok: r.ok, version: st.disk, left: r.left || null, error: r.error })
    }
    if (p === "/__retake/code" && req.method === "GET") return send(res, 200, publicState())
    if (p === "/__retake/code/diff" && req.method === "GET") {
      const b = key(url.searchParams.get("branch") || st.checkedOut)
      const t = st.timelines[b] || st.deleted[b]
      if (!t) return send(res, 404, { error: `no timeline ${b}` })
      const against = url.searchParams.get("against") || "fork"
      const other = against === "fork" ? t.fork : (st.timelines[key(against)] || st.deleted[key(against)] || {}).head
      if (!other) return send(res, 404, { error: `no timeline ${against}` })
      const files = store.diff(other, t.head)
      return send(res, 200, { branch: Number(b) || b, against, from: other, to: t.head, files, patch: files.length ? store.patch(other, t.head) : "" })
    }
    if (req.method !== "POST") return send(res, 405, { error: `${req.method} not supported on ${p}` })
    if (!tokenOk) return send(res, 403, { error: "missing or wrong x-retake-token" })
    const body = await readBody(req)
    if (p === "/__retake/code/checkout") {
      if (body.branchId == null) return send(res, 400, { error: "checkout needs a branchId" })
      return reply(res, await checkout(body.branchId, { reason: body.reason, force: !!body.force, note: body.note, url: typeof body.url === "string" ? body.url : undefined, parentId: body.parentId }))
    }
    if (p === "/__retake/code/enabled") return reply(res, await setEnabled(!!body.on))
    if (p === "/__retake/code/resume") return reply(res, await resume())
    if (p === "/__retake/code/restore") return reply(res, await checkoutVersion(body.version || st.newest))
    return send(res, 404, { error: "not found" })
  }

  return {
    store,
    handler,
    onWatch,
    observe: () => exclusive(() => observe()),
    checkout,
    checkoutVersion,
    setEnabled,
    state: publicState,
    hooks: { onSession, decorate, onNotePatch },
    restoreNewest,
    // Kept pages are tagged with the code they were rendered on (what's on
    // disk now, snapshotted at once if an edit hasn't been yet).
    tag: () => {
      if (!pending) return st.disk
      try {
        return store.snapshot()
      } catch {
        return null
      }
    },
    get enabled() {
      return enabled
    },
    get ready() {
      return ready
    },
    get current() {
      return st.disk
    },
    get newest() {
      return st.newest
    },
    close() {
      clearTimeout(pending)
      if (options.restoreOnExit !== false) restoreNewest()
      process.off("exit", onExit)
    },
  }
}

// Watch a project folder for source changes: its own files, and each source
// folder in it recursively (never node_modules: on Linux a recursive watch
// walks every folder). Returns a function that stops watching.
export function watchTree(dir, onFile) {
  const watchers = []
  const watch = (p, recursive) => {
    try {
      const w = fs.watch(p, { recursive }, (_, f) => f && onFile(path.join(p, String(f))))
      w.on("error", () => {})
      watchers.push(w)
    } catch {}
  }
  watch(dir, false)
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) if (e.isDirectory() && !SKIP.has(e.name) && !e.name.startsWith(".")) watch(path.join(dir, e.name), true)
  } catch {}
  return () => watchers.forEach((w) => w.close())
}

/**
 * The Vite plugin's host: Vite's watcher, its module graphs invalidated after a
 * checkout. Vite stands its HMR down while code timelines are on (plugin.js),
 * so nothing needs holding: the dock rebuilds the moment on the new code.
 * @param {import("vite").ViteDevServer} server
 * @param {{ token?: string, bus?: any, sessions?: any, enabled?: boolean | "ask" | null }} [options]
 */
export function viteCodeHost(server, { token, bus, sessions, enabled } = {}) {
  /** @param {string} full */
  const invalidate = (full) => {
    /** @type {any[]} Vite's module graph and each environment's (Vite 6+) */
    const graphs = [server.moduleGraph, ...Object.values(server.environments || {}).map((e) => e.moduleGraph)]
    for (const graph of graphs) {
      for (const mod of (graph && graph.getModulesByFile && graph.getModulesByFile(full)) || []) graph.invalidateModule(mod)
    }
  }
  const host = createCodeHost({
    root: server.config.root,
    token,
    bus,
    sessions,
    enabled,
    invalidate,
    signals: true,
    log: (msg) => server.config.logger.info(`  retake: ${msg}`, { timestamp: true }),
    warn: (msg) => server.config.logger.warn(`  retake: ${msg}`, { timestamp: true }),
  })
  server.watcher.on("all", (_event, file) => host.onWatch(file))
  server.httpServer && server.httpServer.once("close", () => host.restoreNewest())
  return host
}
