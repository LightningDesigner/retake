// The /__retake/ HTTP API (CONTRACT.md "Server HTTP") and page serving.
import fs from "node:fs"
import path from "node:path"
import { test, expect } from "@playwright/test"
import { PORTS, FIXTURES } from "./servers.js"
const base = `http://localhost:${PORTS.probe}`
const token = async (request) => (await (await request.get(base + "/")).text()).match(/__RETAKE_TOKEN = "([0-9a-f]+)"/)[1]

test("the dock page has the token and no Vite client (F10)", async ({ request }) => {
  const html = await (await request.get(base + "/")).text()
  expect(html).toContain("wb-dock")
  expect(html).toMatch(/__RETAKE_TOKEN = "[0-9a-f]{32}"/)
  expect(html).not.toContain("@vite/client")
  const app = await (await request.get(base + "/?__wb=app")).text()
  expect(app).toContain("@vite/client") // the app frame keeps HMR
  expect(app).toContain("data-retake")
})

test("top-level loads get the dock; iframe loads get the plain page (F16)", async ({ request }) => {
  const nested = await (await request.get(base + "/embed.html", { headers: { "sec-fetch-dest": "iframe" } })).text()
  expect(nested).toContain("emb-body")
  expect(nested).not.toContain("wb-dock")
  expect(nested).not.toContain("data-retake")
  const top = await (await request.get(base + "/embed.html", { headers: { "sec-fetch-dest": "document" } })).text()
  expect(top).toContain("wb-dock")
})

test("mutating requests need the token", async ({ request }) => {
  expect((await request.put(base + "/__retake/session", { data: {} })).status()).toBe(403)
  expect((await request.patch(base + "/__retake/notes/1", { data: { status: "resolved" } })).status()).toBe(403)
  expect((await request.put(base + "/__retake/session", { data: {}, headers: { "x-retake-token": "nope" } })).status()).toBe(403)
})

test("session, recordings and notes persist to .retake and PATCH updates notes", async ({ request }) => {
  const t = await token(request)
  const h = { "x-retake-token": t }
  const session = {
    branches: [{ id: 1, parentId: null, forkAt: 0, name: "Timeline 1", codeVersion: null }, { id: 2, parentId: 1, forkAt: 500, name: "Timeline 2", codeVersion: null }],
    activeId: 2,
    markers: [],
    notes: [{ id: 7, branchId: 2, t: 900, clip: null, selector: "#go", component: null, source: null, classes: [], rect: { x: 0, y: 0, w: 10, h: 10 }, text: "make it blue", status: "pending", replies: [] }],
  }
  expect((await request.put(base + "/__retake/session", { data: session, headers: h })).ok()).toBe(true)
  // The server says which code each timeline has, and the code a note was made on (code timelines).
  const got = await (await request.get(base + "/__retake/session")).json()
  const version = expect.stringMatching(/^[0-9a-f]{10}$/)
  expect(got).toEqual({ ...session, branches: session.branches.map((b) => ({ ...b, codeVersion: version })), notes: session.notes.map((n) => ({ ...n, codeVersion: version })) })
  expect(fs.existsSync(path.join(FIXTURES, "probe", ".retake", "session.json"))).toBe(true)

  expect((await request.put(base + "/__retake/recording/2", { data: { v: 1, events: [1, 2] }, headers: h })).ok()).toBe(true)
  expect(await (await request.get(base + "/__retake/recording/2")).json()).toEqual({ v: 1, events: [1, 2] })
  expect((await request.get(base + "/__retake/recording/99")).status()).toBe(404)
  expect((await request.get(base + "/__retake/recording/..%2Fsession")).status()).toBe(400)

  const r = await request.patch(base + "/__retake/notes/7", { data: { status: "acknowledged", reply: "on it" }, headers: h })
  const note = await r.json()
  expect(note.status).toBe("acknowledged")
  expect(note.replies).toEqual([expect.objectContaining({ from: "agent", text: "on it" })])
  expect((await (await request.get(base + "/__retake/notes")).json())[0].status).toBe("acknowledged")
  expect((await request.patch(base + "/__retake/notes/7", { data: { status: "bogus" }, headers: h })).status()).toBe(400)

  // Start fresh: an empty session drops the recordings too.
  await request.put(base + "/__retake/session", { data: { branches: [], activeId: null, markers: [], notes: [] }, headers: h })
  expect((await request.get(base + "/__retake/recording/2")).status()).toBe(404)
})

test("the SSE stream announces note updates", async ({ page, request }) => {
  const t = await token(request)
  const h = { "x-retake-token": t }
  await request.put(base + "/__retake/session", { data: { branches: [], activeId: 1, markers: [], notes: [{ id: 3, text: "x", status: "pending", replies: [] }] }, headers: h })
  await page.goto(base + "/?retake=0")
  const got = page.evaluate(() => new Promise((resolve) => {
    const es = new EventSource("/__retake/events")
    es.addEventListener("note-updated", (e) => { es.close(); resolve(JSON.parse(e.data)) })
  }))
  await page.waitForTimeout(300)
  await request.patch(base + "/__retake/notes/3", { data: { status: "resolved" }, headers: h })
  expect((await got).status).toBe("resolved")
  await request.put(base + "/__retake/session", { data: { branches: [], activeId: null, markers: [], notes: [] }, headers: h })
})

test("server.json tells local tools where the server is", async () => {
  const info = JSON.parse(fs.readFileSync(path.join(FIXTURES, "probe", ".retake", "server.json"), "utf8"))
  expect(info.url).toBe(base)
  expect(info.token).toMatch(/^[0-9a-f]{32}$/)
})

test("F10 with @vitejs/plugin-react: the dock page has no module scripts, and a full reload doesn't navigate it", async ({ page, request }) => {
  const reactBase = `http://localhost:${PORTS.react}`
  const html = await (await request.get(reactBase + "/")).text()
  expect(html).toContain("wb-dock")
  expect(html).not.toMatch(/<script[^>]*type=["']?module/i)
  const { openDock } = await import("./helpers.js")
  const h = await openDock(page, reactBase + "/")
  await page.waitForTimeout(800)
  let navigated = false
  page.on("framenavigated", (f) => f === page.mainFrame() && (navigated = true))
  const f = path.join(FIXTURES, "react", "src", "main.tsx")
  const orig = fs.readFileSync(f, "utf8")
  try {
    fs.writeFileSync(f, orig + "\n// touched by server.spec\n")
    await page.waitForTimeout(2500)
  } finally {
    fs.writeFileSync(f, orig)
  }
  await page.waitForTimeout(1500)
  expect(navigated).toBe(false)
  const s = await h.settle()
  expect(s.started).toBe(true)
  expect(s.recording).toBe(true) // it was recording before the reload, so it carries on
})

test("the session API is a plain handler: it runs on a bare http.Server", async () => {
  const http = await import("node:http")
  const os = await import("node:os")
  const { createBus, createSessionHandler } = await import("../../src/server/api.js")
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "retake-handler-"))
  const handler = createSessionHandler({ root, token: "t0k", bus: createBus() })
  const server = http.createServer((req, res) => handler(req, res, () => res.end("app")))
  await new Promise((r) => server.listen(3336, "127.0.0.1", r))
  try {
    const base = "http://127.0.0.1:3336"
    expect(await (await fetch(base + "/elsewhere")).text()).toBe("app") // not ours: next()
    expect((await fetch(base + "/__retake/session", { method: "PUT", body: "{}" })).status).toBe(403)
    const session = { branches: [{ id: 1 }], activeId: 1, markers: [], notes: [] }
    expect((await fetch(base + "/__retake/session", { method: "PUT", body: JSON.stringify(session), headers: { "x-retake-token": "t0k" } })).ok).toBe(true)
    expect(await (await fetch(base + "/__retake/session")).json()).toEqual(session)
    expect(fs.existsSync(path.join(root, ".retake", "session.json"))).toBe(true)
  } finally {
    handler.close()
    await new Promise((r) => server.close(r))
  }
})
