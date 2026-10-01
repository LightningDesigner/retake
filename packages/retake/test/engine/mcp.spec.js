// `retake mcp`: the stdio MCP server, against the probe fixture's dev server.
import { spawn } from "node:child_process"
import path from "node:path"
import { test, expect } from "@playwright/test"
import { BIN, FIXTURES, PORTS } from "./servers.js"
const base = `http://localhost:${PORTS.probe}`

function mcp(args = [], cwd = process.cwd()) {
  const child = spawn(process.execPath, [BIN, "mcp", ...args], { cwd, stdio: ["pipe", "pipe", "pipe"] })
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
  return { child, rpc, tool, close: () => child.kill() }
}

async function seed(request) {
  const html = await (await request.get(base + "/")).text()
  const token = html.match(/__WAYBACK_TOKEN = "([0-9a-f]+)"/)[1]
  const session = {
    branches: [{ id: 1, parentId: null, forkAt: 0, name: "Timeline 1" }, { id: 2, parentId: 1, forkAt: 1500, name: "Timeline 2", codeVersion: "abc1234567" }],
    activeId: 2,
    markers: [],
    notes: [
      { id: "n1", branchId: 2, t: 2300, clip: { id: "c3", offset: 120, duration: 400 }, selector: "#go", component: "GoButton", source: { file: "src/Go.tsx", line: 12 }, classes: ["btn", "primary"], rect: { x: 10, y: 20, w: 80, h: 32 }, text: "Make this blue", status: "pending", replies: [] },
      { id: "n2", branchId: 1, t: 500, selector: "#box", text: "Slower", status: "resolved", replies: [] },
      { id: "n4", branchId: 1, t: 6000, selector: "#bar", clip: { id: "c32", offset: 5550, duration: null, label: "fm-note-rise" }, text: "Less bounce", status: "dismissed", replies: [] },
    ],
  }
  await request.put(base + "/__wayback/session", { data: session, headers: { "x-wayback-token": token } })
  return token
}

test("initialize, list tools, and work a note end to end", async ({ request }) => {
  const token = await seed(request)
  const m = mcp(["--url", base])
  try {
    const init = await m.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } })
    expect(init.result.serverInfo.name).toBe("retake")
    expect(init.result.protocolVersion).toBe("2025-06-18")
    m.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n")
    const names = (await m.rpc("tools/list", {})).result.tools.map((t) => t.name)
    expect(names).toEqual(["list_notes", "get_note", "get_active_timeline", "acknowledge", "resolve", "reply", "watch_notes"])

    const list = await m.tool("list_notes")
    expect(list.json.notes.map((n) => n.id)).toEqual(["n1"]) // open only
    expect(list.json.notes[0]).toMatchObject({ timeline: "Timeline 2", source: "src/Go.tsx:12", component: "GoButton" })
    expect((await m.tool("list_notes", { status: "all" })).json.count).toBe(3)

    const note = await m.tool("get_note", { id: "n1" })
    expect(note.text).toContain("Make this blue")
    expect(note.text).toContain("Selector: #go")
    expect(note.text).toContain("Source: src/Go.tsx:12")
    expect(note.text).toContain('branched from "Timeline 1"')
    expect(note.text).toContain("120ms into a 400ms animation (clip c3)")

    const active = await m.tool("get_active_timeline")
    expect(active.json.active).toMatchObject({ name: "Timeline 2", parent: "Timeline 1", codeVersion: "abc1234567" })
    expect(active.json.openNotes.map((n) => n.id)).toEqual(["n1"])

    expect((await m.tool("acknowledge", { id: "n1", message: "on it" })).isError).toBe(false)
    let n1 = await (await request.get(base + "/__wayback/notes/n1")).json()
    expect(n1.status).toBe("acknowledged")
    await m.tool("reply", { id: "n1", text: "blue as in #2563eb?" })
    expect((await m.tool("resolve", { id: "n1", summary: "Button is #2563eb now" })).isError).toBe(false)
    n1 = await (await request.get(base + "/__wayback/notes/n1")).json()
    expect(n1.status).toBe("resolved")
    expect(n1.replies.map((r) => [r.from, r.text])).toEqual([["agent", "on it"], ["agent", "blue as in #2563eb?"], ["agent", "Button is #2563eb now"]])

    expect((await m.tool("get_note", { id: "n4" })).text).toContain("5550ms into a running fm-note-rise animation (clip c32)")
    const missing = await m.tool("get_note", { id: "nope" })
    expect(missing.isError).toBe(true)
    expect(missing.text).toContain("no note with id nope")
  } finally {
    m.close()
    await request.put(base + "/__wayback/session", { data: { branches: [], activeId: null, markers: [], notes: [] }, headers: { "x-wayback-token": token } })
  }
})

test("watch_notes returns when the user adds a note", async ({ request }) => {
  const token = await seed(request)
  const m = mcp([], path.join(FIXTURES, "probe")) // finds the server via .retake/server.json
  try {
    await m.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {} })
    const watching = m.tool("watch_notes", { timeout_seconds: 20 })
    await new Promise((r) => setTimeout(r, 500))
    const session = await (await request.get(base + "/__wayback/session")).json()
    session.notes.push({ id: "n3", branchId: 2, t: 3000, selector: "#pad", text: "Bigger pad", status: "pending", replies: [] })
    await request.put(base + "/__wayback/session", { data: session, headers: { "x-wayback-token": token } })
    const got = await watching
    expect(got.json.changed).toEqual([expect.objectContaining({ id: "n3", new: true, text: "Bigger pad" })])
  } finally {
    m.close()
    await request.put(base + "/__wayback/session", { data: { branches: [], activeId: null, markers: [], notes: [] }, headers: { "x-wayback-token": token } })
  }
})

test("a clear error when no dev server is running", async () => {
  const m = mcp(["--url", "http://localhost:3199"])
  try {
    await m.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {} })
    const r = await m.tool("list_notes")
    expect(r.isError).toBe(true)
    expect(r.text).toMatch(/can't reach the Retake dev server at http:\/\/localhost:3199/)
  } finally {
    m.close()
  }
})

test("a client that closes its input right after asking still gets the answer", async ({ request }) => {
  const token = await seed(request)
  const { spawnSync } = await import("node:child_process")
  const input = [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {} } },
    { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "list_notes", arguments: {} } },
  ].map((m) => JSON.stringify(m)).join("\n") + "\n"
  const r = spawnSync(process.execPath, [BIN, "mcp", "--url", base], { input, encoding: "utf8", timeout: 15000 })
  const replies = r.stdout.trim().split("\n").map((l) => JSON.parse(l))
  expect(replies.map((x) => x.id)).toEqual([1, 2])
  expect(JSON.parse(replies[1].result.content[0].text).notes[0].id).toBe("n1")
  await request.put(base + "/__wayback/session", { data: { branches: [], activeId: null, markers: [], notes: [] }, headers: { "x-wayback-token": token } })
})
