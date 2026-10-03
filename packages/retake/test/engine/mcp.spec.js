// `retake mcp`: the stdio MCP server, against the probe fixture's dev server.
import { spawn } from "node:child_process"
import path from "node:path"
import { test, expect } from "@playwright/test"
import { BIN, FIXTURES, PORTS } from "./servers.js"
import { animFromClip, animationBlock, pointOf } from "../../src/note-text.js"
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
  const token = html.match(/__RETAKE_TOKEN = "([0-9a-f]+)"/)[1]
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
  await request.put(base + "/__retake/session", { data: session, headers: { "x-retake-token": token } })
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
    expect(names).toEqual(["list_notes", "get_note", "get_moment", "get_animation", "get_timeline_events", "get_active_timeline", "acknowledge", "resolve", "reply", "watch_notes"])
    expect(init.result.instructions).toContain("CSS @keyframes: add stops at the range edges")

    const list = await m.tool("list_notes")
    expect(list.json.notes.map((n) => n.id)).toEqual(["n1"]) // open only
    expect(list.json.notes[0]).toMatchObject({ timeline: "Timeline 2", source: "src/Go.tsx:12", component: "GoButton" })
    expect((await m.tool("list_notes", { status: "all" })).json.count).toBe(3)

    const note = await m.tool("get_note", { id: "n1" })
    expect(note.text).toContain("Make this blue")
    expect(note.text).toContain("Selector: #go")
    expect(note.text).toContain("Source: src/Go.tsx:12")
    expect(note.text).toContain('branched from "Timeline 1"')
    expect(note.text).toContain("120ms into a 400ms animation (clip c3; it runs 00:02.18 → 00:02.58)")
    expect(note.text).toContain('get_moment with id "n1"')

    const active = await m.tool("get_active_timeline")
    expect(active.json.active).toMatchObject({ name: "Timeline 2", parent: "Timeline 1", codeVersion: "abc1234567" })
    expect(active.json.openNotes.map((n) => n.id)).toEqual(["n1"])

    expect((await m.tool("acknowledge", { id: "n1", message: "on it" })).isError).toBe(false)
    let n1 = await (await request.get(base + "/__retake/notes/n1")).json()
    expect(n1.status).toBe("acknowledged")
    await m.tool("reply", { id: "n1", text: "blue as in #2563eb?" })
    expect((await m.tool("resolve", { id: "n1", summary: "Button is #2563eb now" })).isError).toBe(false)
    n1 = await (await request.get(base + "/__retake/notes/n1")).json()
    expect(n1.status).toBe("resolved")
    expect(n1.replies.map((r) => [r.from, r.text])).toEqual([["agent", "on it"], ["agent", "blue as in #2563eb?"], ["agent", "Button is #2563eb now"]])

    expect((await m.tool("get_note", { id: "n4" })).text).toContain("5550ms into a running fm-note-rise animation (clip c32; it runs 00:00.45 → still running)")
    const missing = await m.tool("get_note", { id: "nope" })
    expect(missing.isError).toBe(true)
    expect(missing.text).toContain("no note with id nope")
  } finally {
    m.close()
    await request.put(base + "/__retake/session", { data: { branches: [], activeId: null, markers: [], notes: [] }, headers: { "x-retake-token": token } })
  }
})

test("watch_notes returns when the user adds a note", async ({ request }) => {
  const token = await seed(request)
  const m = mcp([], path.join(FIXTURES, "probe")) // finds the server via .retake/server.json
  try {
    await m.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {} })
    const watching = m.tool("watch_notes", { timeout_seconds: 20 })
    await new Promise((r) => setTimeout(r, 500))
    const session = await (await request.get(base + "/__retake/session")).json()
    session.notes.push({ id: "n3", branchId: 2, t: 3000, selector: "#pad", text: "Bigger pad", status: "pending", replies: [] })
    await request.put(base + "/__retake/session", { data: session, headers: { "x-retake-token": token } })
    const got = await watching
    expect(got.json.changed).toEqual([expect.objectContaining({ id: "n3", new: true, text: "Bigger pad" })])
  } finally {
    m.close()
    await request.put(base + "/__retake/session", { data: { branches: [], activeId: null, markers: [], notes: [] }, headers: { "x-retake-token": token } })
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
  await request.put(base + "/__retake/session", { data: { branches: [], activeId: null, markers: [], notes: [] }, headers: { "x-retake-token": token } })
})

// ---- what happened over time (get_moment, get_timeline_events) -----------------------

// A recording as the runtime stores it, small enough to know every line of the answer.
const RECORDING = {
  v: 1, url: base + "/", start: 0, end: 20000, frames: [], viewport: { w: 1280, h: 800 },
  events: [
    { type: "input", t: 3000, path: ["q"], css: "input#q", inputType: "insertText", data: "h", value: "h" },
    { type: "input", t: 3200, path: ["q"], css: "input#q", inputType: "insertText", data: "i", value: "hi" },
    { type: "pointermove", t: 8000, path: ["show"], clientX: 10, clientY: 10 },
    { type: "click", t: 8120, path: ["show"], css: "button#show", label: "Show" },
    { type: "net", list: "fetches", i: 0, kind: "head", t: 8160 },
    { type: "net", list: "fetches", i: 0, kind: "end", t: 8195 },
    { type: "keydown", t: 12500, path: "d", key: "Escape", inField: false, css: "body" },
  ],
  fetches: [{ key: "GET /api/items", t0: 8130, status: 200, done: true, chunks: [] }],
  routes: [{ t: 9000, path: "/items" }],
  clips: [
    { id: "c1", start: 1000, end: 1300, kind: "transition", label: "color transition", property: "color", selector: "h1.title", path: [] },
    { id: "c2", start: 2000, end: null, kind: "css-animation", label: "spin", selector: "div.spinner", iterations: "infinite", dur: 1000, path: [] },
    { id: "c3", start: 9500, end: 10700, kind: "css-animation", label: "fade-in", property: "opacity, transform", selector: "h1.title", component: "Hero", path: [], from: { opacity: "0", transform: "translateY(8px)" }, to: { opacity: "1", transform: "none" } },
    { id: "c4", start: 12000, end: 12400, kind: "transition", label: "opacity transition", property: "opacity", selector: "h1.title.gone", path: [], from: { opacity: "1" }, to: { opacity: "0" } },
  ],
  activity: { start: 0, step: 100, v: Array.from({ length: 200 }, (_, i) => (i === 102 ? 40 : 0)) },
}

async function seedRecording(request) {
  const html = await (await request.get(base + "/")).text()
  const token = html.match(/__RETAKE_TOKEN = "([0-9a-f]+)"/)[1]
  const headers = { "x-retake-token": token }
  await request.put(base + "/__retake/session", {
    headers,
    data: {
      branches: [{ id: 1, parentId: null, forkAt: 0, name: "Timeline 1" }],
      activeId: 1,
      markers: [],
      notes: [{ id: "m1", branchId: 1, t: 10910, selector: "h1.title", component: "Hero", source: { file: "/_next/static/chunks/app_1r3jkso._.js", line: 4366, mapped: true }, text: "Make it appear at this time and then disappear", status: "pending", replies: [] }],
    },
  })
  await request.put(base + "/__retake/recording/1", { headers, data: RECORDING })
  return token
}

test("get_moment: what happened around a note's moment, from its recording", async ({ request }) => {
  const token = await seedRecording(request)
  const m = mcp(["--url", base])
  try {
    await m.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {} })
    const r = await m.tool("get_moment", { id: "m1" })
    expect(r.isError).toBe(false)
    const lines = r.text.split("\n")
    expect(lines[0]).toBe('Timeline "Timeline 1" around note m1 ("Make it appear at this time and then disappear") on h1.title:')
    expect(lines).toContain("Window: 00:05.91 → 00:15.91 of a 00:20.00 recording; the moment is 00:10.91.")
    // The element's animations: when it appeared, what it animated between, and when it goes.
    expect(lines).toContain("- (on) 00:09.50 → 00:10.70 (1.20s) animation `fade-in` (opacity, transform) on h1.title [Hero]; opacity 0 → 1, transform translateY(8px) → none; ended 210ms before the moment (clip c3)")
    expect(lines).toContain("- (on) 00:12.00 → 00:12.40 (400ms) opacity transition on h1.title.gone; opacity 1 → 0; starts 1.09s after the moment (clip c4)")
    expect(lines).toContain("Outside the window this element also animates at: 00:01.00 (color transition).")
    expect(lines).toContain("At the moment nothing on it is animating (see above for what came before and after).")
    // What the user did, and requests, in order around the moment.
    const order = ['- 00:08.12 click "Show" (button#show)', "- 00:08.13 GET /api/items → 200 (65ms)", "- 00:09.00 route → /items", "- 00:10.91 ◆ the moment", "- 00:12.50 key Escape"]
    expect(order.map((l) => lines.indexOf(l))).toEqual([...order.map((l) => lines.indexOf(l))].sort((a, b) => a - b))
    expect(order.every((l) => lines.includes(l))).toBe(true)
    expect(r.text).not.toContain("pointermove")
    expect(lines).toContain('Last action before the moment: click "Show" (button#show) at 00:08.12 (2.79s earlier). Next after: key Escape at 00:12.50.')
    expect(lines).toContain("- 00:02.00 → looping (1.00s each) animation `spin` on div.spinner; running at the moment (clip c2)")
    expect(lines).toContain("Screen changed most at: 00:10.20 (40% of the view).")

    // A narrower window, and a moment of a timeline without a note.
    const narrow = await m.tool("get_moment", { id: "m1", before_seconds: 1, after_seconds: 0.5 })
    expect(narrow.text).not.toContain("- 00:08.12 click")
    expect(narrow.text).toContain("fade-in")
    const at = await m.tool("get_moment", { timeline: "Timeline 1", at: "00:03.10", selector: "input#q", before_seconds: 1, after_seconds: 1 })
    expect(at.text).toContain('- 00:03.00–00:03.20 typed 2 chars in input#q (now "hi")')

    const ev = await m.tool("get_timeline_events", { from: "00:00", to: "00:09.00" })
    expect(ev.text).toContain("Window: 00:00.00 → 00:09.00 of a 00:20.00 recording.")
    expect(ev.text).toContain("typed 2 chars in input#q")
    expect(ev.text).toContain("route → /items")
    expect(ev.text).not.toContain("Escape")
    expect(ev.text).toContain("00:01.00 → 00:01.30 (300ms) color transition on h1.title")
    const capped = await m.tool("get_timeline_events", { limit: 2 })
    expect(capped.text).toMatch(/\(\d+ more not shown/)

    // get_note: says it's pinned to a moment, and that its compiled source isn't known.
    const note = await m.tool("get_note", { id: "m1" })
    expect(note.text).toContain('get_moment with id "m1"')
    expect(note.text).toContain("Source: not known. The note only has a line of a compiled bundle, with no source map to read it by; find the element by its component (Hero) and selector instead.")
    expect(note.text).not.toContain("4366")
    expect((await m.tool("list_notes")).json.notes[0].source).toMatch(/^unknown \(compiled bundle/)

    expect((await m.tool("get_moment", {})).isError).toBe(true)
    expect((await m.tool("get_timeline_events", { timeline: "Nope" })).text).toContain('no timeline "Nope"')
    expect((await m.tool("get_timeline_events", { from: "soon" })).text).toContain("can't read the time")
  } finally {
    m.close()
    await request.put(base + "/__retake/session", { data: { branches: [], activeId: null, markers: [], notes: [] }, headers: { "x-retake-token": token } })
  }
})

test("get_moment on a real recording: the click, the requests and the element's transition", async ({ page, request }) => {
  const { openDock } = await import("./helpers.js")
  const h = await openDock(page, base + "/")
  const html = await (await request.get(base + "/")).text()
  const token = html.match(/__RETAKE_TOKEN = "([0-9a-f]+)"/)[1]
  try {
    await h.record()
    await page.waitForTimeout(300)
    await h.click("#go")
    await page.waitForTimeout(900)
    await h.pause()
    // The dock saves the recording once it's paused.
    let rec = null
    await expect.poll(async () => {
      const r = await request.get(base + "/__retake/recording/1")
      rec = r.ok() ? await r.json() : null
      return !!rec && (rec.clips || []).some((c) => c.kind === "transition")
    }, { timeout: 15000 }).toBe(true)
    await page.goto("about:blank")
    const { readRecording } = await import("../../src/server/moments.js")
    const clip = readRecording(rec).clips.find((c) => c.kind === "transition" && /#box/.test(c.selector))
    expect(clip.from.transform).toBeTruthy()
    expect(clip.to.transform).toMatch(/200/)
    const session = await (await request.get(base + "/__retake/session")).json()
    session.notes = [{ id: "r1", branchId: session.activeId, t: clip.start + 100, selector: "#box", text: "Make it appear later", status: "pending", replies: [] }]
    await request.put(base + "/__retake/session", { data: session, headers: { "x-retake-token": token } })

    const m = mcp(["--url", base])
    try {
      await m.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {} })
      const r = await m.tool("get_moment", { id: "r1" })
      expect(r.isError).toBe(false)
      expect(r.text).toMatch(/- \(on\) \d\d:\d\d\.\d\d → \d\d:\d\d\.\d\d \(400ms\) transform transition on #box; transform .+ → .*200.*; running at the moment, 25% through \(clip c\d+\)/)
      expect(r.text).toMatch(/At the moment it is mid-animation: .*transform transition/)
      expect(r.text).toMatch(/- (\d\d:\d\d\.\d\d) click "Go" \(#go\)\n- \1/) // the click first, then what it set off
      expect(r.text).toMatch(/GET \/api\/json\?c=\d+ → 200/)
      expect(r.text).toMatch(/XHR GET \/api\/xhr → 200/)
      expect(r.text).toMatch(/opacity 1 → 0\.2/) // the Web Animation on the same element
    } finally {
      m.close()
    }
  } finally {
    await request.put(base + "/__retake/session", { data: { branches: [], activeId: null, markers: [], notes: [] }, headers: { "x-retake-token": token } })
  }
})

// ---- element-centric notes: one formatter, one verdict ------------------------------------

// A range note on h1.title's fade-in (clip c3), as the dock saves it: the
// animation's keyframes, timing and the range on its own clock.
function rangeNote() {
  const clip = { ...RECORDING.clips[2], kf: [
    { offset: 0, easing: "ease-out", values: { opacity: "0", transform: "translateY(8px)" } },
    { offset: 0.5, easing: "linear", values: { opacity: "0.8", transform: "translateY(2px)" } },
    { offset: 1, easing: "linear", values: { opacity: "1", transform: "none" } },
  ], timing: { delay: 0, duration: 1200, iterations: 1, direction: "normal", fill: "both", easing: "linear", playbackRate: 1 } }
  const a = { ...animFromClip(clip), relation: "on", primary: true, selector: "h1.title" }
  a.from = { ...pointOf(a, 9700), values: { opacity: "0.31" }, geometry: { page: { x: 32, y: 40, w: 400, h: 48 } } }
  a.to = { ...pointOf(a, 9900), values: { opacity: "0.62" }, geometry: { page: { x: 32, y: 36, w: 400, h: 48 } } }
  a.keyframesInside = []
  a.samples = []
  return {
    id: "m2", branchId: 1, t: 9700, range: { from: 9700, to: 9900 }, selector: "h1.title", component: "Hero", source: { file: "src/Hero.tsx", line: 9 },
    text: "between 200 and 400 ms ease it more", status: "pending", replies: [], classes: ["title"], rect: { x: 32, y: 40, w: 400, h: 48 },
    el: { label: "<h1.title>", text: "Hello", selector: "h1.title", components: ["Hero"], page: "/" },
    target: { path: [0, 1], selector: "h1.title", matches: 1, tag: "<h1.title>", text: "Hello", geometry: { page: { x: 32, y: 40, w: 400, h: 48 }, view: { w: 1280, h: 800 }, scroll: { x: 0, y: 0 } } },
    anims: [a], inside: [], asked: { text: "between 200 and 400 ms", reading: "local", from: 200, to: 400 },
  }
}

test("element-centric note: get_note, get_moment and get_animation tell the same story", async ({ request }) => {
  const token = await seedRecording(request)
  const headers = { "x-retake-token": token }
  const note = rangeNote()
  const session = await (await request.get(base + "/__retake/session")).json()
  await request.put(base + "/__retake/session", { headers, data: { ...session, notes: [...session.notes, note] } })
  const m = mcp(["--url", base])
  try {
    await m.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {} })
    const block = animationBlock(note, { start: 0 }).join("\n")
    const got = await m.tool("get_note", { id: "m2" })
    expect(got.text).toContain(block)
    expect(got.text).toContain("Range: local 200ms → 400ms of 1200ms")
    expect(got.text).toContain("Scope: change only local 200–400ms of this animation")
    expect(got.text).toContain('Read "between 200 and 400 ms" as local time of clip c3 (200–400ms).')

    // get_moment: the note's own verdict and clips, not a selector guess (c4 is on h1.title.gone, another element).
    const mo = await m.tool("get_moment", { id: "m2" })
    expect(mo.text).toContain(block)
    expect(mo.text).toContain("At the note's moment it is mid-animation (the note says): fade-in.")
    expect(mo.text).toMatch(/- \(on\) .*fade-in.*\(clip c3\)/)
    expect(mo.text).not.toMatch(/- \(on\) .*h1\.title\.gone/)

    const an = await m.tool("get_animation", { id: "m2" })
    expect(an.text).toContain("keyframes on its own clock:")
    expect(an.text).toContain("Recording 00:09.70: local 200ms, progress 0.1667")
    expect(an.text).toContain("as CSS: 16.67% of the keyframes · as Motion times: 0.1667")
    expect(an.text).toContain("sampled: opacity 0.31")
    const byClip = await m.tool("get_animation", { clip: "c3", at: "00:10.10" })
    expect(byClip.text).toContain("Recording 00:10.10: local 600ms, progress 0.5")
    expect(byClip.text).toContain("only the first and last were recorded")

    const list = await m.tool("list_notes")
    const m2 = list.json.notes.find((n) => n.id === "m2")
    expect(m2).toMatchObject({ range: "00:09.70 → 00:09.90", animation: "fade-in 200–400ms (17–33%)" })
  } finally {
    m.close()
  }
  await request.put(base + "/__retake/session", { data: { branches: [], activeId: null, markers: [], notes: [] }, headers })
})
