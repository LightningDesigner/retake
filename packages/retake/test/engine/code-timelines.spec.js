// Code timelines: each timeline keeps its own code (code-versions.js), against
// throwaway projects in the OS temp dir (never this repo: a checkout rewrites
// files). The host is driven in-process (its hooks and routes over a bare
// http.Server), through the front server, and through the CLI. Ports 3121-3127.
import { spawn, execFileSync, execSync } from "node:child_process"
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { test, expect } from "@playwright/test"
import { BIN } from "./servers.js"
import { createCodeHost, createStore } from "../../src/code-versions.js"
import { createBus, createSessionHandler } from "../../src/server/api.js"
import { startFront } from "../../src/server/front.js"

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const read = (dir, f) => fs.readFileSync(path.join(dir, f), "utf8")
const write = (dir, f, text) => {
  fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true })
  fs.writeFileSync(path.join(dir, f), text)
}

function makeApp({ git = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "retake-ct-"))
  write(dir, "package.json", '{"name":"ct","private":true,"type":"module"}')
  write(dir, "index.html", '<!doctype html><html><body><div class="bars"></div><script type="module" src="/main.js"></script></body></html>')
  write(dir, "bars.css", ".bar { animation: grow 600ms ease-out both; }\n")
  write(dir, "main.js", 'import "./bars.css"\n')
  if (git) {
    const g = (...a) => execFileSync("git", a, { cwd: dir, stdio: "ignore" })
    g("init", "-q")
    g("config", "user.email", "t@example.com")
    g("config", "user.name", "t")
    write(dir, ".gitignore", ".retake/\n")
    g("add", "-A")
    g("commit", "-q", "-m", "init")
  }
  return dir
}

// The session API + code host on one bare server, like a dev server has them.
async function host(dir, { port = 3121, enabled = true, leaseMs } = {}) {
  const token = "t0ken"
  const bus = createBus()
  const events = []
  const emit = bus.emit
  bus.emit = (e, d) => (events.push({ e, d }), emit(e, d))
  const hooks = {}
  const api = createSessionHandler({ root: dir, token, bus, hooks })
  const code = createCodeHost({ root: dir, token, bus, sessions: api.store, enabled, quiet: true, restoreOnExit: false, leaseMs })
  Object.assign(hooks, code.hooks)
  const server = http.createServer((req, res) => code.handler(req, res, () => api(req, res)))
  await new Promise((r) => server.listen(port, "127.0.0.1", r))
  const base = `http://127.0.0.1:${port}/__retake/`
  const call = async (method, p, body) => {
    const r = await fetch(base + p, { method, headers: { "content-type": "application/json", "x-retake-token": token }, body: body === undefined ? undefined : JSON.stringify(body) })
    const text = await r.text()
    return { status: r.status, body: text ? JSON.parse(text) : null }
  }
  const session = (branches, activeId, notes = []) => call("PUT", "session", { branches, activeId, markers: [], notes })
  return {
    code,
    api,
    call,
    session,
    events,
    state: () => code.state(),
    close: async () => {
      code.close()
      api.close()
      await new Promise((r) => server.close(r))
    },
  }
}
const T1 = { id: 1, parentId: null, forkAt: 0, name: "Timeline 1" }
const T2 = { id: 2, parentId: 1, forkAt: 500, name: "Timeline 2" }

test("a fork starts on its parent's code; an edit moves only the checked-out timeline's head", async () => {
  const dir = makeApp()
  const h = await host(dir)
  try {
    await h.session([T1], 1)
    const A = h.state().disk
    expect(h.state().timelines[1]).toMatchObject({ fork: A, head: A })
    // The dock forks Timeline 2 (Control-click): it starts on Timeline 1's code and is checked out.
    expect((await h.call("POST", "code/checkout", { branchId: 2, parentId: 1, reason: "fork" })).body.ok).toBe(true)
    await h.session([T1, T2], 2)
    expect(h.state().checkedOut).toBe(2)
    write(dir, "bars.css", ".bar { animation: grow 1200ms ease-out both; }\n")
    await h.code.observe()
    const s = h.state()
    expect(s.timelines[2].head).not.toBe(A)
    expect(s.timelines[2]).toMatchObject({ fork: A, changed: 1, files: ["bars.css"] })
    expect(s.timelines[1]).toMatchObject({ fork: A, head: A, changed: 0 })
    expect(s.newest).toBe(s.timelines[2].head)
    expect(h.events.some((x) => x.e === "code-version" && x.d.reason === "edit" && x.d.branchId === 2 && x.d.timelines)).toBe(true)
  } finally {
    await h.close()
  }
})

test("a session save's codeVersion is ignored; reads get each timeline's head", async () => {
  const dir = makeApp()
  const h = await host(dir)
  try {
    await h.session([T1], 1)
    const before = JSON.stringify(h.state().timelines)
    await h.session([{ ...T1, codeVersion: "deadbeef00" }], 1)
    expect(JSON.stringify(h.state().timelines)).toBe(before)
    const got = (await h.call("GET", "session")).body
    expect(got.branches[0].codeVersion).toBe(h.state().timelines[1].head)
  } finally {
    await h.close()
  }
})

test("stepping into a timeline swaps the files; what was on disk goes to the timeline left, unseen edits included", async () => {
  const dir = makeApp()
  const h = await host(dir)
  try {
    await h.session([T1], 1)
    const A = h.state().disk
    await h.call("POST", "code/checkout", { branchId: 2, parentId: 1, reason: "fork" })
    await h.session([T1, T2], 2)
    write(dir, "bars.css", "/* B */\n")
    await h.code.observe()
    // Another edit, switched away from before the watcher saw it.
    write(dir, "bars.css", "/* C */\n")
    write(dir, "extra.js", "// new on Timeline 2\n")
    const r = (await h.call("POST", "code/checkout", { branchId: 1 })).body
    expect(r).toMatchObject({ ok: true, version: A, swapped: true })
    expect(r.files).toEqual(expect.arrayContaining([{ path: "bars.css", change: "write" }, { path: "extra.js", change: "delete" }]))
    expect(read(dir, "bars.css")).toContain("600ms")
    expect(fs.existsSync(path.join(dir, "extra.js"))).toBe(false)
    expect(h.state().checkedOut).toBe(1)
    // Back: Timeline 2's newest edit (C) is there.
    expect((await h.call("POST", "code/checkout", { branchId: 2 })).body.ok).toBe(true)
    expect(read(dir, "bars.css")).toBe("/* C */\n")
    expect(read(dir, "extra.js")).toContain("new on Timeline 2")
  } finally {
    await h.close()
  }
})

test("checkouts run one at a time, and a snapshot between them lands on the right timeline", async () => {
  const dir = makeApp()
  const h = await host(dir)
  try {
    await h.session([T1], 1)
    await h.call("POST", "code/checkout", { branchId: 2, parentId: 1, reason: "fork" })
    await h.session([T1, T2], 2)
    write(dir, "bars.css", "/* B */\n")
    await h.code.observe()
    const B = h.state().timelines[2].head
    const A = h.state().timelines[1].head
    // Three at once: they queue.
    const [a, b, c] = await Promise.all([h.code.checkout(1), h.code.observe(), h.code.checkout(2)])
    expect(a.ok && c.ok).toBe(true)
    expect(b).toBe(A) // the snapshot ran between them, on Timeline 1's code
    expect(h.state().timelines[1].head).toBe(A)
    expect(h.state().timelines[2].head).toBe(B)
    expect(read(dir, "bars.css")).toBe("/* B */\n")
  } finally {
    await h.close()
  }
})

test("shared code (off, or not chosen yet): no files move; edits land on the timeline the dock is in; turning it on later keeps them apart", async () => {
  const dir = makeApp()
  const h = await host(dir, { enabled: null })
  try {
    expect(h.state().enabled).toBe("ask")
    await h.session([T1], 1)
    const A = h.state().disk
    await h.call("POST", "code/checkout", { branchId: 2, parentId: 1, reason: "fork" })
    await h.session([T1, T2], 2)
    write(dir, "bars.css", "/* B */\n")
    await h.code.observe()
    const B = h.state().timelines[2].head
    const r = (await h.call("POST", "code/checkout", { branchId: 1 })).body
    expect(r).toMatchObject({ ok: true, swapped: false, files: [] })
    expect(read(dir, "bars.css")).toBe("/* B */\n") // nothing swapped
    expect(h.state().checkedOut).toBe(1)
    // The old routes refuse to swap while it's off.
    expect((await h.call("POST", "code/restore", { version: A })).status).toBe(409)
    // Back on Timeline 2, then the answer "Separate code": stored for the project.
    await h.session([T1, T2], 2)
    expect(h.state().checkedOut).toBe(2)
    expect((await h.call("POST", "code/enabled", { on: true })).body).toMatchObject({ ok: true, enabled: true })
    expect(JSON.parse(read(dir, ".retake/settings.json"))).toMatchObject({ codeTimelines: true })
    expect((await h.call("POST", "code/checkout", { branchId: 1 })).body.ok).toBe(true)
    expect(read(dir, "bars.css")).toContain("600ms")
    expect(h.state().timelines[2].head).toBe(B)
  } finally {
    await h.close()
  }
})

test("turning code timelines on while the files aren't the checked-out timeline's code puts its code back", async () => {
  const dir = makeApp()
  const h = await host(dir, { enabled: false })
  try {
    await h.session([T1], 1)
    await h.call("POST", "code/checkout", { branchId: 2, parentId: 1, reason: "fork" })
    await h.session([T1, T2], 2)
    write(dir, "bars.css", "/* B */\n")
    await h.code.observe()
    await h.session([T1, T2], 1) // the dock went back to Timeline 1 with shared code
    const r = (await h.call("POST", "code/enabled", { on: true })).body
    expect(r.files).toEqual([{ path: "bars.css", change: "write" }])
    expect(read(dir, "bars.css")).toContain("600ms")
  } finally {
    await h.close()
  }
})

test("notes carry the code they were made on (kept across the dock's saves) and the code a resolve landed on", async () => {
  const dir = makeApp()
  const h = await host(dir)
  try {
    await h.session([T1], 1)
    await h.call("POST", "code/checkout", { branchId: 2, parentId: 1, reason: "fork" })
    const note = { id: 7, branchId: 2, t: 900, selector: ".bar:nth-child(3)", text: "slower, 1200ms", status: "pending", replies: [] }
    await h.session([T1, T2], 2, [note])
    const A = h.state().timelines[2].head
    let saved = (await h.call("GET", "notes/7")).body
    expect(saved.codeVersion).toBe(A)
    // The dock saves again without the field: it stays.
    await h.session([T1, T2], 2, [note])
    expect((await h.call("GET", "notes/7")).body.codeVersion).toBe(A)
    // The agent edits and resolves before the watcher has looked.
    write(dir, "bars.css", ".bar { animation: grow 1200ms ease-out both; }\n")
    saved = (await h.call("PATCH", "notes/7", { status: "resolved", reply: "1200ms" })).body
    const B = h.state().timelines[2].head
    expect(B).not.toBe(A)
    expect(saved.resolvedVersion).toBe(B)
    await h.session([T1, T2], 2, [{ ...note, status: "resolved" }])
    expect((await h.call("GET", "notes/7")).body).toMatchObject({ codeVersion: A, resolvedVersion: B })
  } finally {
    await h.close()
  }
})

test("an agent's lease: acknowledging takes the note's timeline; the dock asks before taking it back, force works, resolving ends it, and it expires", async () => {
  const dir = makeApp()
  const h = await host(dir, { leaseMs: 1500 })
  try {
    await h.session([T1], 1)
    await h.call("POST", "code/checkout", { branchId: 2, parentId: 1, reason: "fork" })
    const notes = [{ id: 7, branchId: 2, t: 900, text: "slower", status: "pending", replies: [] }, { id: 8, branchId: 1, t: 300, text: "bigger", status: "pending", replies: [] }]
    await h.session([T1, T2], 2, notes)
    await h.call("POST", "code/checkout", { branchId: 1 }) // the dock steps back into Timeline 1
    await h.session([T1, T2], 1, notes)
    write(dir, "bars.css", "/* T1 edit */\n")
    await h.code.observe()
    // acknowledge note 7 (on Timeline 2): files become Timeline 2's, the dock is moved there.
    const ack = (await h.call("POST", "code/checkout", { branchId: 2, reason: "note", note: 7 })).body
    expect(ack).toMatchObject({ ok: true, branchId: 2, swapped: true })
    expect(read(dir, "bars.css")).toContain("600ms")
    expect((await h.call("GET", "session")).body.activeId).toBe(2)
    expect(h.events.some((x) => x.e === "active-changed" && x.d.activeId === 2 && x.d.by === "agent" && x.d.note === 7)).toBe(true)
    // A stale save from the dock (still on 1) doesn't move it back.
    await h.session([T1, T2], 1, notes)
    expect((await h.call("GET", "session")).body.activeId).toBe(2)
    // The dock (or another agent) wants Timeline 1: refused while the lease holds.
    const refused = await h.call("POST", "code/checkout", { branchId: 1 })
    expect(refused.status).toBe(409)
    expect(refused.body.lease).toMatchObject({ note: 7, branchId: 2, name: "Timeline 2" })
    expect((await h.call("POST", "code/checkout", { branchId: 1, reason: "note", note: 8 })).status).toBe(409)
    // Switch anyway.
    expect((await h.call("POST", "code/checkout", { branchId: 1, force: true })).body.ok).toBe(true)
    expect(h.state().leaseLost).toMatchObject({ note: 7, to: "1" })
    expect(read(dir, "bars.css")).toBe("/* T1 edit */\n")
    // Taken again, then resolved: the lease ends.
    await h.call("POST", "code/checkout", { branchId: 2, reason: "note", note: 7 })
    expect(h.state().lease).toMatchObject({ note: 7 })
    await h.call("PATCH", "notes/7", { status: "resolved", reply: "done" })
    expect(h.state().lease).toBe(null)
    // And one left alone runs out.
    await h.call("POST", "code/checkout", { branchId: 2, reason: "note", note: 7 })
    expect(h.state().lease).toBeTruthy()
    await sleep(1700)
    expect(h.state().lease).toBe(null)
    expect((await h.call("POST", "code/checkout", { branchId: 1 })).body.ok).toBe(true)
  } finally {
    await h.close()
  }
})

test("the diff route: the files a timeline changed and a unified diff", async () => {
  const dir = makeApp()
  const h = await host(dir)
  try {
    await h.session([T1], 1)
    await h.call("POST", "code/checkout", { branchId: 2, parentId: 1, reason: "fork" })
    await h.session([T1, T2], 2)
    write(dir, "bars.css", ".bar { animation: grow 1200ms ease-out both; }\n")
    write(dir, "src/new.js", "export const x = 1\n")
    await h.code.observe()
    const d = (await h.call("GET", "code/diff?branch=2")).body
    expect(d.files).toEqual([{ path: "bars.css", status: "modified" }, { path: "src/new.js", status: "added" }])
    expect(d.patch).toContain("-.bar { animation: grow 600ms ease-out both; }")
    expect(d.patch).toContain("+.bar { animation: grow 1200ms ease-out both; }")
    expect(d.patch).toContain("b/src/new.js")
    expect((await h.call("GET", "code/diff?branch=1&against=2")).body.files.length).toBe(2)
    // Mutating routes need the token.
    expect((await fetch("http://127.0.0.1:3121/__retake/code/checkout", { method: "POST", body: '{"branchId":1}' })).status).toBe(403)
  } finally {
    await h.close()
  }
})

test("Start fresh (the checked-out timeline goes): the new Timeline 1 takes what's on disk", async () => {
  const dir = makeApp()
  const h = await host(dir)
  try {
    await h.session([T1], 1)
    await h.call("POST", "code/checkout", { branchId: 2, parentId: 1, reason: "fork" })
    await h.session([T1, T2], 2)
    write(dir, "bars.css", "/* B */\n")
    await h.code.observe()
    const B = h.state().timelines[2].head
    await h.session([T1], 1)
    expect(h.state()).toMatchObject({ checkedOut: 1 })
    expect(h.state().timelines[1].head).toBe(B)
    expect(h.state().deleted[2]).toMatchObject({ head: B, name: "Timeline 2" })
  } finally {
    await h.close()
  }
})

test("generated files and .retake/ignore are never part of a version, so never written", async () => {
  const dir = makeApp()
  write(dir, "next-env.d.ts", "// generated\n")
  write(dir, ".next/server/page.js", "// build output\n")
  write(dir, "src/routeTree.gen.ts", "// generated\n")
  write(dir, "local/notes.txt", "mine\n")
  write(dir, "keep.log", "log\n")
  write(dir, ".retake/ignore", "local/\n*.log\n")
  const store = createStore(dir)
  const v = store.load(store.snapshot())
  expect(Object.keys(v.files).sort()).toEqual(["bars.css", "index.html", "main.js", "package.json"])
  const h = await host(dir)
  try {
    await h.session([T1], 1)
    await h.call("POST", "code/checkout", { branchId: 2, parentId: 1, reason: "fork" })
    await h.session([T1, T2], 2)
    write(dir, "next-env.d.ts", "// generated again\n")
    write(dir, "local/notes.txt", "changed\n")
    write(dir, "bars.css", "/* B */\n")
    await h.code.observe()
    await h.call("POST", "code/checkout", { branchId: 1 })
    expect(read(dir, "next-env.d.ts")).toBe("// generated again\n")
    expect(read(dir, "local/notes.txt")).toBe("changed\n")
    expect(read(dir, ".next/server/page.js")).toBe("// build output\n")
  } finally {
    await h.close()
  }
})

test("git: HEAD, the index and refs are never touched; a commit changes nothing; a busy git refuses; a branch switch pauses swapping", async () => {
  const dir = makeApp({ git: true })
  const gitState = () => {
    const g = (...a) => execFileSync("git", a, { cwd: dir }).toString()
    return [read(dir, ".git/HEAD"), g("rev-parse", "HEAD"), fs.readFileSync(path.join(dir, ".git/index")).toString("base64"), g("for-each-ref")].join("\n")
  }
  const h = await host(dir)
  try {
    await h.session([T1], 1)
    await h.call("POST", "code/checkout", { branchId: 2, parentId: 1, reason: "fork" })
    await h.session([T1, T2], 2)
    write(dir, "bars.css", "/* B */\n")
    await h.code.observe()
    const before = gitState()
    expect((await h.call("POST", "code/checkout", { branchId: 1 })).body.ok).toBe(true)
    expect((await h.call("POST", "code/checkout", { branchId: 2 })).body.ok).toBe(true)
    expect(gitState()).toBe(before)
    // A commit: same files, nothing happens.
    const heads = JSON.stringify(h.state().timelines)
    execFileSync("git", ["commit", "-qam", "B"], { cwd: dir })
    await h.code.observe()
    expect(JSON.stringify(h.state().timelines)).toBe(heads)
    expect(h.state().suspended).toBe(null)
    // git is busy: refused, nothing written.
    write(dir, ".git/index.lock", "")
    const busy = await h.call("POST", "code/checkout", { branchId: 1 })
    expect(busy.status).toBe(409)
    expect(busy.body.error).toMatch(/git is busy/)
    expect(read(dir, "bars.css")).toBe("/* B */\n")
    fs.rmSync(path.join(dir, ".git/index.lock"))
    // A branch switch that changes files: paused, not an edit to Timeline 2.
    execFileSync("git", ["checkout", "-q", "-b", "other", "HEAD~1"], { cwd: dir })
    await h.code.observe()
    expect(h.state().suspended).toBe("git-branch-changed")
    expect(JSON.stringify(h.state().timelines)).toBe(heads)
    expect((await h.call("POST", "code/checkout", { branchId: 1 })).status).toBe(409)
    // Resume: the new tree goes to the timeline checked out.
    expect((await h.call("POST", "code/resume", {})).body.ok).toBe(true)
    expect(h.state().suspended).toBe(null)
    expect(h.state().timelines[2].head).toBe(h.state().disk)
  } finally {
    await h.close()
  }
})

test("the front server: a kept page is served again once its code is back, and not on other code", async () => {
  const dir = makeApp()
  let renders = 0
  const up = http.createServer((req, res) => {
    renders++
    res.writeHead(200, { "content-type": "text/html" })
    res.end(`<!doctype html><html><head></head><body>render ${renders}: ${read(dir, "bars.css").trim()}</body></html>`)
  })
  await new Promise((r) => up.listen(3124, "127.0.0.1", r))
  const front = await startFront({ upstream: "http://127.0.0.1:3124", port: 3123, root: dir, quiet: true, watch: dir, code: { root: dir, enabled: true } })
  const base = "http://localhost:3123"
  const token = front.token
  const call = async (method, p, body) => (await fetch(`${base}/__retake/${p}`, { method, headers: { "content-type": "application/json", "x-retake-token": token }, body: body && JSON.stringify(body) })).json()
  // (fetch() sets Sec-Fetch-* itself: a plain request says it's the dock's frame.)
  const frame = (doc) =>
    new Promise((resolve, reject) => {
      const r = http.get(`${base}/`, { headers: { "sec-fetch-mode": "navigate", "sec-fetch-dest": "iframe", "sec-fetch-site": "same-origin", accept: "text/html", ...(doc ? { cookie: `__retake_doc=${doc}` } : {}) } }, (res) => {
        let body = ""
        res.setEncoding("utf8")
        res.on("data", (c) => (body += c))
        res.on("end", () => resolve({ headers: { get: (k) => res.headers[k] ?? null }, text: async () => body }))
      })
      r.on("error", reject)
    })
  try {
    await call("PUT", "session", { branches: [T1], activeId: 1, markers: [], notes: [] })
    const A = (await call("GET", "code")).disk
    const first = await frame()
    const docId = (await first.text()).match(/"docId":"([0-9a-f]{16})"/)[1]
    const meta = JSON.parse(read(dir, `.retake/docs/${docId}.json`))
    expect(meta.version).toBe(A)
    await call("POST", "code/checkout", { branchId: 2, parentId: 1, reason: "fork" })
    await call("PUT", "session", { branches: [T1, T2], activeId: 2, markers: [], notes: [] })
    write(dir, "bars.css", "/* B */\n")
    await front.code.observe()
    // On Timeline 2's code the copy kept on A is not served.
    const onB = await frame(docId)
    expect(onB.headers.get("x-retake-doc")).toBe(null)
    expect(await onB.text()).toContain("/* B */")
    // Back on Timeline 1 (A): it is, as Timeline 1's code rendered it.
    expect((await call("POST", "code/checkout", { branchId: 1, url: "/" })).ok).toBe(true)
    const n = renders
    const onA = await frame(docId)
    expect(onA.headers.get("x-retake-doc")).toBe("stored")
    expect(onA.headers.get("x-retake-doc-version")).toBe(A)
    expect(await onA.text()).toMatch(/render \d+: \.bar \{ animation: grow 600ms/)
    expect(renders).toBe(n) // not rendered again
  } finally {
    await front.close()
    await new Promise((r) => up.close(r))
  }
  // Closing the front server put the newest code (Timeline 2's) back.
  expect(read(dir, "bars.css")).toBe("/* B */\n")
})

// ---- the CLI: a real Vite dev server on a copy, crash and exit, `retake code` ----

const PORT = 3122
const listeners = () => execSync(`lsof -ti tcp:${PORT} -sTCP:LISTEN || true`).toString().trim().split("\n").filter(Boolean).map(Number)
async function startVite(dir, args = ["--code-timelines"]) {
  if (listeners().length) throw new Error(`port ${PORT} is still in use`)
  let out = ""
  const child = spawn(process.execPath, [BIN, dir, "--port", String(PORT), ...args], { stdio: "pipe" })
  child.stdout.on("data", (d) => (out += d))
  child.stderr.on("data", (d) => (out += d))
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`http://localhost:${PORT}/__retake/code`)).ok) return { child, out: () => out }
    } catch {}
    await sleep(200)
  }
  child.kill()
  throw new Error(`the dev server didn't start:\n${out}`)
}
async function stop(child, sig = "SIGINT") {
  child.kill(sig)
  for (let i = 0; i < 80 && listeners().length; i++) await sleep(100)
  for (const pid of listeners()) process.kill(pid, "SIGKILL")
  await sleep(200)
}
async function viteCall(method, p, body) {
  const html = await (await fetch(`http://localhost:${PORT}/`)).text()
  const token = html.match(/__RETAKE_TOKEN = "([0-9a-f]+)"/)[1]
  const r = await fetch(`http://localhost:${PORT}/__retake/${p}`, { method, headers: { "content-type": "application/json", "x-retake-token": token }, body: body && JSON.stringify(body) })
  return r.json()
}
async function waitFor(fn, ms = 5000) {
  const t0 = Date.now()
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() - t0 > ms) throw new Error("timed out")
    await sleep(100)
  }
}
const cli = (dir, ...args) => execFileSync(process.execPath, [BIN, "code", ...args], { cwd: dir }).toString()

test("Vite: stopping on Timeline 1's code leaves the newest (Timeline 2's) on disk and says so; after a crash the next start puts it back", async () => {
  const dir = makeApp({ git: true })
  let { child, out } = await startVite(dir)
  try {
    await viteCall("PUT", "session", { branches: [T1], activeId: 1, markers: [], notes: [] })
    await viteCall("POST", "code/checkout", { branchId: 2, parentId: 1, reason: "fork" })
    await viteCall("PUT", "session", { branches: [T1, T2], activeId: 2, markers: [], notes: [] })
    await sleep(600) // the watcher's first scan
    write(dir, "bars.css", ".bar { animation: grow 1200ms ease-out both; }\n")
    await waitFor(async () => (await viteCall("GET", "code")).timelines[2].changed === 1)
    expect((await viteCall("POST", "code/checkout", { branchId: 1 })).ok).toBe(true)
    expect(read(dir, "bars.css")).toContain("600ms")
  } finally {
    await stop(child)
  }
  expect(read(dir, "bars.css")).toContain("1200ms")
  await expect.poll(() => out(), { timeout: 5000 }).toContain("left Timeline 2's code on disk (newest). Timeline 1 is kept in .retake/")
  expect(out()).toContain("code timelines: on")
  // A crash on Timeline 1's code.
  ;({ child, out } = await startVite(dir))
  expect((await viteCall("POST", "code/checkout", { branchId: 1 })).ok).toBe(true)
  expect(read(dir, "bars.css")).toContain("600ms")
  for (const pid of listeners()) process.kill(pid, "SIGKILL")
  child.kill("SIGKILL")
  for (let i = 0; i < 30 && listeners().length; i++) await sleep(100)
  expect(read(dir, "bars.css")).toContain("600ms")
  ;({ child } = await startVite(dir, []))
  try {
    expect(read(dir, "bars.css")).toContain("1200ms")
    expect((await viteCall("GET", "code")).enabled).toBe("ask") // no flag, nothing chosen: the dock asks
  } finally {
    await stop(child)
  }
  expect(execFileSync("git", ["status", "--porcelain"], { cwd: dir }).toString().trim()).toBe("M bars.css")
})

test("retake code: status, checkout and restore without a dev server; export as a git branch leaves the working tree, index and HEAD alone", async () => {
  const dir = makeApp({ git: true })
  const h = await host(dir, { port: 3125 })
  await h.session([T1], 1)
  await h.call("POST", "code/checkout", { branchId: 2, parentId: 1, reason: "fork" })
  await h.session([T1, T2], 2)
  write(dir, "bars.css", ".bar { animation: grow 1200ms ease-out both; }\n")
  await h.code.observe()
  await h.close()
  fs.rmSync(path.join(dir, ".retake", "server.json"), { force: true })
  expect(cli(dir, "status")).toMatch(/Code timelines: on[\s\S]*\* 2\s+Timeline 2\s+[0-9a-f]{10}\s+1 file changed/)
  expect(cli(dir, "checkout", "Timeline 1")).toContain("Files on disk are now Timeline 1's code")
  expect(read(dir, "bars.css")).toContain("600ms")
  expect(cli(dir, "restore")).toContain("(the newest)")
  expect(read(dir, "bars.css")).toContain("1200ms")
  cli(dir, "checkout", "1")
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir }).toString()
  const index = fs.readFileSync(path.join(dir, ".git/index"))
  expect(cli(dir, "export", "2")).toContain("Branch retake/timeline-2 is Timeline 2's code")
  expect(execFileSync("git", ["show", "retake/timeline-2:bars.css"], { cwd: dir }).toString()).toContain("1200ms")
  expect(execFileSync("git", ["rev-parse", "retake/timeline-2~1"], { cwd: dir }).toString()).toBe(head)
  expect(execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir }).toString()).toBe(head)
  expect(fs.readFileSync(path.join(dir, ".git/index")).equals(index)).toBe(true)
  expect(read(dir, "bars.css")).toContain("600ms") // the working tree is still Timeline 1's
})
