// `retake mcp` with code timelines: where a note's edit must land, and the
// tools that move the files (acknowledge, checkout_timeline) or show them
// (get_code_diff). Against a throwaway project in the OS temp dir (port 3127).
import { spawn } from "node:child_process"
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { test, expect } from "@playwright/test"
import { BIN } from "./servers.js"
import { createCodeHost } from "../../src/code-versions.js"
import { createBus, createSessionHandler } from "../../src/server/api.js"

const PORT = 3127
const write = (dir, f, text) => fs.writeFileSync(path.join(dir, f), text)
const read = (dir, f) => fs.readFileSync(path.join(dir, f), "utf8")

async function project({ enabled = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "retake-ctm-"))
  write(dir, "package.json", "{}")
  write(dir, "bars.css", ".bar { animation: grow 600ms ease-out both; }\n")
  const token = "t0ken"
  const bus = createBus()
  const hooks = {}
  const api = createSessionHandler({ root: dir, token, bus, hooks })
  const code = createCodeHost({ root: dir, token, bus, sessions: api.store, enabled, quiet: true, restoreOnExit: false })
  Object.assign(hooks, code.hooks)
  const server = http.createServer((req, res) => code.handler(req, res, () => api(req, res)))
  await new Promise((r) => server.listen(PORT, "127.0.0.1", r))
  // How `retake mcp` finds it (as a dev server writes it).
  write(dir, ".retake/server.json", JSON.stringify({ url: `http://127.0.0.1:${PORT}`, token, pid: process.pid }))
  const call = (method, p, body) => fetch(`http://127.0.0.1:${PORT}/__retake/${p}`, { method, headers: { "content-type": "application/json", "x-retake-token": token }, body: body && JSON.stringify(body) }).then((r) => r.json())
  return { dir, code, call, token, close: () => (code.close(), api.close(), new Promise((r) => server.close(r))) }
}

function mcp(dir) {
  const child = spawn(process.execPath, [BIN, "mcp"], { cwd: dir, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, RETAKE_URL: "" } })
  let buf = ""
  const waiting = new Map()
  child.stdout.setEncoding("utf8")
  child.stdout.on("data", (d) => {
    buf += d
    let i
    while ((i = buf.indexOf("\n")) >= 0) {
      const msg = JSON.parse(buf.slice(0, i))
      buf = buf.slice(i + 1)
      waiting.get(msg.id)?.(msg)
    }
  })
  let seq = 0
  const rpc = (method, params) =>
    new Promise((resolve) => {
      const id = ++seq
      waiting.set(id, resolve)
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n")
    })
  const tool = async (name, args = {}) => {
    const r = await rpc("tools/call", { name, arguments: args })
    const text = r.result.content[0].text
    return { isError: !!r.result.isError, text, json: (() => { try { return JSON.parse(text) } catch { return null } })() }
  }
  return { tool, close: () => child.kill() }
}

const T1 = { id: 1, parentId: null, forkAt: 0, name: "Timeline 1" }
const T2 = { id: 2, parentId: 1, forkAt: 4200, name: "Timeline 2" }
const NOTE = { id: 7, branchId: 2, t: 5000, selector: ".bar:nth-child(3)", text: "slower, 1200ms, spring", status: "pending", replies: [] }

// Timeline 2 forked from Timeline 1, a note on it, and the dock back on Timeline 1.
async function seed(p) {
  await p.call("PUT", "session", { branches: [T1], activeId: 1, markers: [], notes: [] })
  await p.call("POST", "code/checkout", { branchId: 2, parentId: 1, reason: "fork" })
  await p.call("PUT", "session", { branches: [T1, T2], activeId: 2, markers: [], notes: [NOTE] })
  await p.call("POST", "code/checkout", { branchId: 1 })
  await p.call("PUT", "session", { branches: [T1, T2], activeId: 1, markers: [], notes: [NOTE] })
}

test("get_note says which timeline the edit belongs to and whose code is on disk; acknowledge puts the note's timeline's code there and moves the dock", async () => {
  const p = await project()
  const m = mcp(p.dir)
  try {
    await seed(p)
    const A = p.code.state().disk
    const note = await m.tool("get_note", { id: 7 })
    expect(note.text).toContain(`Timeline: "Timeline 2" (branched from "Timeline 1" at 00:04.20), code version ${A}, no code changes since it started`)
    expect(note.text).toContain("Files on disk now: Timeline 1's code. acknowledge switches them to Timeline 2's before you edit.")
    // Timeline 1 moves on meanwhile (an edit there), so the switch has files to move.
    write(p.dir, "bars.css", "/* Timeline 1's own edit */\n")
    await p.code.observe()
    const ack = await m.tool("acknowledge", { id: 7, message: "on it" })
    expect(ack.isError).toBe(false)
    expect(ack.text).toBe(`Acknowledged note 7. Files on disk are now Timeline 2's code (version ${A}). Edit as usual: your changes land in Timeline 2.`)
    expect(read(p.dir, "bars.css")).toContain("600ms")
    expect((await p.call("GET", "session")).activeId).toBe(2)
    // The agent's edit, then resolve: it landed where it should.
    write(p.dir, "bars.css", ".bar { animation: grow 1200ms cubic-bezier(.3,1.4,.5,1) both; }\n")
    const res = await m.tool("resolve", { id: 7, summary: "1200ms with a springy curve" })
    const B = p.code.state().timelines[2].head
    expect(res.text).toBe(`Resolved note 7 (code version ${B}).`)
    expect(B).not.toBe(A)
    const active = (await m.tool("get_active_timeline")).json
    expect(active).toMatchObject({ codeTimelines: "on", checkedOut: { id: 2, name: "Timeline 2", version: B } })
    expect(active.code["Timeline 2"]).toMatchObject({ fork: A, head: B, changed: 1 })
    expect(active.code["Timeline 1"].changed).toBe(1)
    // get_code_diff: what Timeline 2 changed.
    const diff = await m.tool("get_code_diff", { timeline: "Timeline 2" })
    expect(diff.text).toContain(`"Timeline 2"'s code (version ${B}) against where it started (version ${A}): 1 file\nmodified bars.css`)
    expect(diff.text).toContain("+.bar { animation: grow 1200ms")
    // checkout_timeline: Timeline 1's code back (the lease went with resolve).
    const co = await m.tool("checkout_timeline", { timeline: 1 })
    expect(co.text).toContain("Files on disk are now Timeline 1's code")
    expect(co.text).toContain("wrote bars.css")
    expect(read(p.dir, "bars.css")).toBe("/* Timeline 1's own edit */\n")
  } finally {
    m.close()
    await p.close()
  }
})

test("an edit that landed on the wrong timeline: resolve says so; a second note can't take the files while the first is in progress", async () => {
  const p = await project()
  const m = mcp(p.dir)
  try {
    await seed(p)
    await p.call("PUT", "session", { branches: [T1, T2], activeId: 1, markers: [], notes: [NOTE, { id: 8, branchId: 1, t: 300, text: "bigger", status: "pending", replies: [] }] })
    expect((await m.tool("acknowledge", { id: 7 })).isError).toBe(false)
    const refused = await m.tool("acknowledge", { id: 8 })
    expect(refused.isError).toBe(true)
    expect(refused.text).toContain("Not acknowledged: Timeline 2 is checked out for note 7")
    expect((await p.call("GET", "notes/8")).status).toBe("pending")
    // The user takes the files back mid-edit; the agent edits anyway and resolves.
    await p.call("POST", "code/checkout", { branchId: 1, force: true })
    write(p.dir, "bars.css", "/* meant for Timeline 2 */\n")
    const res = await m.tool("resolve", { id: 7, summary: "slower" })
    expect(res.text).toContain("Note 7 is on Timeline 2, but the user switched the files away while you worked (to Timeline 1).")
  } finally {
    m.close()
    await p.close()
  }
})

test("with code timelines off, get_note says an edit changes every timeline, and acknowledge only moves the dock", async () => {
  const p = await project({ enabled: false })
  const m = mcp(p.dir)
  try {
    await seed(p)
    expect((await m.tool("get_note", { id: 7 })).text).toContain("Code timelines are off: an edit changes every timeline's code.")
    const ack = await m.tool("acknowledge", { id: 7 })
    expect(ack.text).toBe("Acknowledged note 7. The dock is on Timeline 2; your edit is kept as its code (code timelines are off: every timeline shares the files).")
    expect((await p.call("GET", "session")).activeId).toBe(2)
    expect((await m.tool("checkout_timeline", { timeline: "Timeline 1" })).text).toContain("every timeline shares the files, so nothing on disk changed")
  } finally {
    m.close()
    await p.close()
  }
})
