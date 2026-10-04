// The dock's side of code timelines (each timeline keeps its own code). The
// server's /__retake/code routes and its events are stood in for, so each case
// is exact and nothing on disk changes.
import { test, expect } from "@playwright/test"
import { openDock, dock, recordSome } from "./helpers.js"
import { fakeServer } from "./fake-server.js"
import { SHELL_PORTS } from "./servers.js"

const URL_ = `http://localhost:${SHELL_PORTS.codeBranches}/`
const A = "aaaaaaaaaa"
const B = "bbbbbbbbbb"

// A stand-in for the code host: its state, the requests it got, and events to push.
async function fakeCode(page, state) {
  const calls = []
  const queue = []
  const reply = { checkout: null }
  await page.route("**/__retake/code**", async (route) => {
    const req = route.request()
    const p = new URL(req.url()).pathname
    if (req.method() === "GET" && p === "/__retake/code") return route.fulfill({ contentType: "application/json", body: JSON.stringify(named(state)) })
    const body = JSON.parse(req.postData() || "{}")
    calls.push({ path: p.replace("/__retake/", ""), body, token: req.headers()["x-retake-token"] })
    if (p.endsWith("/checkout")) {
      const r = reply.checkout ? reply.checkout(body) : { ok: true, version: (state.timelines[body.branchId] || {}).head, files: [] }
      if (r.ok !== false && body.reason !== "fork") state.checkedOut = body.branchId
      if (r.ok !== false && body.reason === "fork") {
        state.timelines[body.branchId] = { ...state.timelines[body.parentId] }
        state.checkedOut = body.branchId
      }
      return route.fulfill({ status: r.ok === false ? 409 : 200, contentType: "application/json", body: JSON.stringify(r) })
    }
    if (p.endsWith("/enabled")) {
      state.enabled = body.on
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, enabled: body.on }) })
    }
    return route.fulfill({ contentType: "application/json", body: '{"ok":true}' })
  })
  // Server events: each connection gets what's queued, then the stream ends and
  // the dock reconnects (retry 200ms).
  await page.route("**/__retake/events", (route) => {
    const out = queue.splice(0).map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e.data)}\n\n`).join("")
    return route.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body: "retry: 200\n\n" + out })
  })
  return { calls, push: (type, data) => queue.push({ type, data }), reply, state }
}
const named = (state) => ({ ...state, checkedOutName: `Timeline ${state.checkedOut}` })
const baseState = (over = {}) => ({ enabled: true, checkedOut: 1, checkedOutName: "Timeline 1", disk: A, version: A, newest: A, suspended: null, lease: null, leaseLost: null, offEdits: null, restored: false, timelines: { 1: { fork: A, head: A, changed: 0, files: [] } }, deleted: {}, ...over })

// Record, pause, and fork Timeline 2 from the middle (the dock asks the server to start it).
async function twoTimelines(h, page) {
  await recordSome(h, ["#toggle", "#toggle"])
  await h.pause()
  const s = await h.state()
  await dock(page, (D, t) => window.__retakeDock.newTimelineAt(t), s.start + (s.end - s.start) * 0.5)
  await expect.poll(() => dock(page, (D) => D.activeId)).toBe(2)
  await page.waitForTimeout(400)
}
// Every holdDev call on the frame on show.
const spyHold = (page) =>
  page.evaluate(() => {
    const pt = window.__retakeDock.state.frame.contentWindow.__retake
    const real = pt.holdDev
    window.__holds = []
    pt.holdDev = (on) => (window.__holds.push(on), real(on))
  })

test("a new timeline is started on the server; stepping into another asks for its code by branchId, holds the dev server's pushes, and says what changed", async ({ page }) => {
  await fakeServer(page)
  const code = await fakeCode(page, baseState())
  const h = await openDock(page, URL_)
  await twoTimelines(h, page)
  expect(code.calls.find((c) => c.path === "code/checkout")).toMatchObject({ body: { branchId: 2, parentId: 1, reason: "fork" }, token: expect.stringMatching(/^[0-9a-f]+$/) })
  // An edit on Timeline 2 (the server says so).
  code.state.timelines[2] = { fork: A, head: B, changed: 1, files: ["bars.css"] }
  code.state.newest = code.state.disk = B
  await h.settle()
  await spyHold(page)
  code.reply.checkout = (body) => ({ ok: true, version: A, files: [{ path: "bars.css", change: "write" }], swapped: true })
  expect(await dock(page, () => window.__retakeDock.switchTo(1, 0))).toBe(true)
  expect(code.calls.filter((c) => c.path === "code/checkout").pop().body).toMatchObject({ branchId: 1, reason: "dock", force: false })
  expect(await page.evaluate(() => window.__holds)).toEqual([true])
  await expect(page.locator(".hint")).toHaveText("Files swapped to Timeline 1's code (1 file)")
  expect(await dock(page, (D) => D.branches.map((b) => b.version))).toEqual([A, B])
  expect(h.dockErrors).toEqual([])
})

test("a refused switch lets the dev server's pushes through again and stays put", async ({ page }) => {
  await fakeServer(page)
  const code = await fakeCode(page, baseState())
  const h = await openDock(page, URL_)
  await twoTimelines(h, page)
  await h.settle()
  await spyHold(page)
  code.reply.checkout = () => ({ ok: false, error: "git is busy (an index.lock is held); try again when it's done" })
  expect(await dock(page, () => window.__retakeDock.switchTo(1, 0))).toBe(false)
  expect(await page.evaluate(() => window.__holds)).toEqual([true, false])
  expect(await dock(page, (D) => D.activeId)).toBe(2)
  await expect(page.locator(".hint")).toContainText("git is busy")
})

test("the lane chip shows only where a timeline's code changed, with the files on hover; the top row says whose code is on disk", async ({ page }) => {
  await fakeServer(page)
  const code = await fakeCode(page, baseState())
  const h = await openDock(page, URL_)
  await twoTimelines(h, page)
  code.state.timelines[2] = { fork: A, head: B, changed: 2, files: ["src/Bars.tsx", "src/bars.css"] }
  await expect(page.locator('.lane-name[data-lane="2"] .code-chip')).toHaveAttribute("title", "2 files changed since Timeline 1: src/Bars.tsx, src/bars.css", { timeout: 5000 })
  await expect(page.locator('.lane-name[data-lane="1"] .code-chip')).toHaveCount(0)
  await expect(page.locator(".code-item")).toHaveText("Code: Timeline 2")
  // Shared code: no chips, no item.
  code.state.enabled = false
  await expect(page.locator(".code-chip")).toHaveCount(0, { timeout: 5000 })
  await expect(page.locator(".code-item")).toBeHidden()
})

test("not chosen yet: the first code change with two timelines asks once, and the answer goes to the server", async ({ page }) => {
  await fakeServer(page)
  const code = await fakeCode(page, baseState({ enabled: "ask" }))
  const h = await openDock(page, URL_)
  await twoTimelines(h, page)
  await expect(page.locator(".hint [data-code]")).toHaveCount(0)
  code.state.timelines[2] = { fork: A, head: B, changed: 1, files: ["bars.css"] }
  code.push("code-version", { reason: "edit", branchId: 2, ...named(code.state) })
  await expect(page.locator(".hint")).toContainText("Code changed on Timeline 2. Give each timeline its own code?", { timeout: 5000 })
  await page.locator('.hint [data-code="separate"]').click()
  expect(code.calls.filter((c) => c.path === "code/enabled").map((c) => c.body)).toEqual([{ on: true }])
  await expect(page.locator(".hint [data-code]")).toHaveCount(0)
  // Once a page: another edit doesn't ask again.
  code.state.enabled = "ask"
  code.push("code-version", { reason: "edit", branchId: 2, ...named(code.state) })
  await page.waitForTimeout(1200)
  await expect(page.locator(".hint [data-code]")).toHaveCount(0)
})

test("Share code is an answer too, and the lane menu turns separate code on or off later", async ({ page }) => {
  await fakeServer(page)
  const code = await fakeCode(page, baseState({ enabled: "ask" }))
  const h = await openDock(page, URL_)
  await twoTimelines(h, page)
  code.push("code-version", { reason: "edit", branchId: 2, ...named(code.state) })
  await page.locator('.hint [data-code="share"]').click({ timeout: 5000 })
  expect(code.calls.filter((c) => c.path === "code/enabled").map((c) => c.body)).toEqual([{ on: false }])
  await page.locator('.lane-name[data-lane="1"]').click({ button: "right" })
  await expect(page.locator('#wb-menu [data-code="toggle"]')).toHaveText("Separate code per timeline")
  await page.locator('#wb-menu [data-code="toggle"]').click()
  expect(code.calls.filter((c) => c.path === "code/enabled").map((c) => c.body)).toEqual([{ on: false }, { on: true }])
})

test("an agent took a timeline: the dock follows, paused, and says so", async ({ page }) => {
  await fakeServer(page)
  const code = await fakeCode(page, baseState())
  const h = await openDock(page, URL_)
  await twoTimelines(h, page)
  await h.settle()
  code.state.checkedOut = 1
  code.push("active-changed", { activeId: 1, by: "agent", note: 7 })
  await expect.poll(() => dock(page, (D) => D.activeId), { timeout: 5000 }).toBe(1)
  await expect(page.locator(".hint")).toHaveText("An agent took Timeline 1 for note 7")
  await page.waitForTimeout(400)
  expect((await h.state()).playing).toBe(false)
})

test("while an agent edits another timeline, switching asks first; Switch anyway takes the files", async ({ page }) => {
  await fakeServer(page)
  const code = await fakeCode(page, baseState())
  const h = await openDock(page, URL_)
  await twoTimelines(h, page)
  await h.settle()
  const lease = { note: 7, branchId: 2, name: "Timeline 2", at: Date.now() }
  code.reply.checkout = (body) => (body.force ? { ok: true, version: A, files: [] } : { ok: false, error: "Timeline 2 is checked out for note 7", lease })
  expect(await dock(page, () => window.__retakeDock.switchTo(1, 0))).toBe(false)
  await expect(page.locator(".hint")).toContainText("An agent is editing Timeline 2 (note 7)")
  await page.locator('.hint [data-code="force"]').click()
  await expect.poll(() => dock(page, (D) => D.activeId)).toBe(1)
  expect(code.calls.filter((c) => c.path === "code/checkout").pop().body).toMatchObject({ branchId: 1, force: true })
})

test("with code timelines on, an edit on the timeline you're in rebuilds the moment on the new code", async ({ page }) => {
  await fakeServer(page)
  const code = await fakeCode(page, baseState())
  const h = await openDock(page, URL_)
  await twoTimelines(h, page)
  await h.settle()
  const frame = await dock(page, (D) => D.frame.dataset.n || (D.frame.dataset.n = String(Math.random())))
  code.state.timelines[2] = { fork: A, head: B, changed: 1, files: ["bars.css"] }
  code.push("code-version", { reason: "edit", branchId: 2, ...named(code.state) })
  await expect.poll(() => dock(page, (D) => D.frame.dataset.n || null), { timeout: 8000 }).not.toBe(frame)
  await h.settle()
  expect(await dock(page, (D) => D.activeId)).toBe(2)
  expect((await h.state()).playing).toBe(false)
})
