// The /__wayback/ HTTP API (CONTRACT.md "Server HTTP") and page serving.
import fs from "node:fs"
import path from "node:path"
import { test, expect } from "@playwright/test"
import { PORTS, FIXTURES } from "./servers.js"
const base = `http://localhost:${PORTS.probe}`
const token = async (request) => (await (await request.get(base + "/")).text()).match(/__WAYBACK_TOKEN = "([0-9a-f]+)"/)[1]

test("the dock page has the token and no Vite client (F10)", async ({ request }) => {
  const html = await (await request.get(base + "/")).text()
  expect(html).toContain("wb-dock")
  expect(html).toMatch(/__WAYBACK_TOKEN = "[0-9a-f]{32}"/)
  expect(html).not.toContain("@vite/client")
  const app = await (await request.get(base + "/?__wb=app")).text()
  expect(app).toContain("@vite/client") // the app frame keeps HMR
  expect(app).toContain("data-wayback")
})

test("top-level loads get the dock; iframe loads get the plain page (F16)", async ({ request }) => {
  const nested = await (await request.get(base + "/embed.html", { headers: { "sec-fetch-dest": "iframe" } })).text()
  expect(nested).toContain("emb-body")
  expect(nested).not.toContain("wb-dock")
  expect(nested).not.toContain("data-wayback")
  const top = await (await request.get(base + "/embed.html", { headers: { "sec-fetch-dest": "document" } })).text()
  expect(top).toContain("wb-dock")
})

test("mutating requests need the token", async ({ request }) => {
  expect((await request.put(base + "/__wayback/session", { data: {} })).status()).toBe(403)
  expect((await request.patch(base + "/__wayback/notes/1", { data: { status: "resolved" } })).status()).toBe(403)
  expect((await request.put(base + "/__wayback/session", { data: {}, headers: { "x-wayback-token": "nope" } })).status()).toBe(403)
})

test("session, recordings and notes persist to .retake and PATCH updates notes", async ({ request }) => {
  const t = await token(request)
  const h = { "x-wayback-token": t }
  const session = {
    branches: [{ id: 1, parentId: null, forkAt: 0, name: "Timeline 1", codeVersion: null }, { id: 2, parentId: 1, forkAt: 500, name: "Timeline 2", codeVersion: null }],
    activeId: 2,
    markers: [],
    notes: [{ id: 7, branchId: 2, t: 900, clip: null, selector: "#go", component: null, source: null, classes: [], rect: { x: 0, y: 0, w: 10, h: 10 }, text: "make it blue", status: "pending", replies: [] }],
  }
  expect((await request.put(base + "/__wayback/session", { data: session, headers: h })).ok()).toBe(true)
  expect(await (await request.get(base + "/__wayback/session")).json()).toEqual(session)
  expect(fs.existsSync(path.join(FIXTURES, "probe", ".retake", "session.json"))).toBe(true)

  expect((await request.put(base + "/__wayback/recording/2", { data: { v: 1, events: [1, 2] }, headers: h })).ok()).toBe(true)
  expect(await (await request.get(base + "/__wayback/recording/2")).json()).toEqual({ v: 1, events: [1, 2] })
  expect((await request.get(base + "/__wayback/recording/99")).status()).toBe(404)
  expect((await request.get(base + "/__wayback/recording/..%2Fsession")).status()).toBe(400)

  const r = await request.patch(base + "/__wayback/notes/7", { data: { status: "acknowledged", reply: "on it" }, headers: h })
  const note = await r.json()
  expect(note.status).toBe("acknowledged")
  expect(note.replies).toEqual([expect.objectContaining({ from: "agent", text: "on it" })])
  expect((await (await request.get(base + "/__wayback/notes")).json())[0].status).toBe("acknowledged")
  expect((await request.patch(base + "/__wayback/notes/7", { data: { status: "bogus" }, headers: h })).status()).toBe(400)

  // Start fresh: an empty session drops the recordings too.
  await request.put(base + "/__wayback/session", { data: { branches: [], activeId: null, markers: [], notes: [] }, headers: h })
  expect((await request.get(base + "/__wayback/recording/2")).status()).toBe(404)
})

test("the SSE stream announces note updates", async ({ page, request }) => {
  const t = await token(request)
  const h = { "x-wayback-token": t }
  await request.put(base + "/__wayback/session", { data: { branches: [], activeId: 1, markers: [], notes: [{ id: 3, text: "x", status: "pending", replies: [] }] }, headers: h })
  await page.goto(base + "/?retake=0")
  const got = page.evaluate(() => new Promise((resolve) => {
    const es = new EventSource("/__wayback/events")
    es.addEventListener("note-updated", (e) => { es.close(); resolve(JSON.parse(e.data)) })
  }))
  await page.waitForTimeout(300)
  await request.patch(base + "/__wayback/notes/3", { data: { status: "resolved" }, headers: h })
  expect((await got).status).toBe("resolved")
  await request.put(base + "/__wayback/session", { data: { branches: [], activeId: null, markers: [], notes: [] }, headers: h })
})

test("server.json tells local tools where the server is", async () => {
  const info = JSON.parse(fs.readFileSync(path.join(FIXTURES, "probe", ".retake", "server.json"), "utf8"))
  expect(info.url).toBe(base)
  expect(info.token).toMatch(/^[0-9a-f]{32}$/)
})
