// M4 network: streams, binary, request bodies, sockets, pause, signals, forks.
import { test, expect } from "@playwright/test"
import { openDock, pick } from "./helpers.js"
import { PORTS } from "./servers.js"
const URL_ = `http://localhost:${PORTS.probe}/`

async function recordThenReplay(page, clicks, wait = 2500) {
  const h = await openDock(page, URL_)
  await page.waitForTimeout(300)
  for (const c of clicks) {
    await h.click(c)
    await page.waitForTimeout(150)
  }
  await page.waitForTimeout(wait)
  await h.pause()
  const live = await h.log()
  const T = (await h.state()).now
  await h.seek(T - 1)
  return { h, live, replay: await h.log(), T: T - 1 + 1000 }
}

test("a streamed LLM-style reply replays token by token, at the recorded pace", async ({ page }) => {
  const { live, replay, T } = await recordThenReplay(page, ["#llm"])
  const tokens = pick(live, "token")
  expect(tokens.length).toBeGreaterThanOrEqual(6)
  expect(tokens[tokens.length - 1].vt - tokens[0].vt).toBeGreaterThan(500) // really streamed while recording
  expect(pick(replay, "token", T)).toEqual(tokens)
  expect(pick(replay, "llm-done", T)).toEqual(pick(live, "llm-done"))
})

test("binary bodies survive (base64), and replay doesn't hit the server", async ({ page }) => {
  const { live, replay, T } = await recordThenReplay(page, ["#bytes"], 800)
  const b = pick(live, "bytes")
  expect(b[0].v[0]).toBe(256)
  expect(pick(replay, "bytes", T)).toEqual(b)
})

test("POSTs to one URL are matched by body", async ({ page }) => {
  const { live, replay, T } = await recordThenReplay(page, ["#post"], 800)
  expect(pick(live, "post")[0].v).toEqual(["first-1", "second-1"])
  expect(pick(replay, "post", T)).toEqual(pick(live, "post"))
})

test("WebSocket messages are recorded and replayed without a connection", async ({ page }) => {
  const { live, replay, T } = await recordThenReplay(page, ["#ws"], 1500)
  expect(pick(live, "ws").map((e) => e.v.split("-")[0])).toEqual(["ws0", "ws1", "ws2"])
  expect(pick(live, "ws-close").length).toBe(1)
  for (const k of ["ws-open", "ws", "ws-close"]) expect(pick(replay, k, T), k).toEqual(pick(live, k))
})

test("pausing at the live edge holds a stream until play", async ({ page }) => {
  const h = await openDock(page, URL_)
  await page.waitForTimeout(300)
  await h.click("#llm")
  await page.waitForTimeout(250)
  await h.pause()
  const before = pick(await h.log(), "token").length
  await page.waitForTimeout(1500) // the server finishes meanwhile
  expect(pick(await h.log(), "token").length).toBe(before)
  await h.record()
  await page.waitForTimeout(1500)
  expect(pick(await h.log(), "llm-done").length).toBe(1)
})

test("F14 rewinding mid-stream then playing on doesn't hang the request", async ({ page }) => {
  const h = await openDock(page, URL_)
  await page.waitForTimeout(300)
  await h.click("#llm")
  await page.waitForTimeout(400)
  await h.pause()
  const T = (await h.state()).now
  await h.seek(T - 200)
  await h.record() // back to the end, then live
  await page.waitForTimeout(2500)
  expect(pick(await h.log(), "llm-done").length).toBe(1)
})

test("F15 fetches made in the past don't fork a new timeline", async ({ page }) => {
  const h = await openDock(page, URL_)
  await page.waitForTimeout(300)
  await h.click("#go")
  await page.waitForTimeout(1800)
  await h.pause()
  const end = (await h.state()).end
  await h.seek(200)
  const before = await page.evaluate(() => (window.__retakeDock && window.__retakeDock.branches ? window.__retakeDock.branches().length : 1))
  await h.rt(() => fetch("/api/json?unrecorded=1")) // not in the recording
  await page.waitForTimeout(300)
  const s = await h.state()
  expect(s.future).toBe(true)
  expect(s.end).toBeGreaterThanOrEqual(end - 1)
  const after = await page.evaluate(() => (window.__retakeDock && window.__retakeDock.branches ? window.__retakeDock.branches().length : 1))
  expect(after).toBe(before)
})

test("an abort signal is honoured during replay", async ({ page }) => {
  const { live, replay, T } = await recordThenReplay(page, ["#slow"], 800)
  expect(pick(live, "slow-err")[0].v).toBe("AbortError")
  expect(pick(replay, "slow-err", T)).toEqual(pick(live, "slow-err"))
})

test("a response whose body the app never reads is still recorded whole and replayed offline", async ({ page }) => {
  const h = await openDock(page, URL_)
  await page.waitForTimeout(300)
  await h.click("#unread")
  await page.waitForTimeout(2200) // the (unread) stream finishes on the server
  await h.pause()
  const entry = await h.rt(() => __retake.history().fetches.find((f) => f && f.key.includes("unread")))
  expect(entry.done).toBe(true)
  expect(entry.chunks.length).toBeGreaterThan(1)
  let hits = 0
  page.on("request", (r) => r.url().includes("unread=1") && hits++)
  await h.seek((await h.state()).now - 1)
  expect(pick(await h.log(), "unread")).toHaveLength(1)
  expect(hits).toBe(0)
})

test("a prefetch and a navigation of one URL each replay their own answer (router headers are in the key)", async ({ page }) => {
  const h = await openDock(page, URL_ + "?rsc")
  await page.waitForTimeout(300)
  await h.click("#rsc")
  await page.waitForTimeout(800)
  await h.pause()
  const live = pick(await h.log(), "rsc")
  expect(live).toHaveLength(1)
  expect(live[0].v[1]).toBe(live[0].v[0] + 1) // the prefetch went first, live
  const keys = await h.rt(() => __retake.history().fetches.filter((f) => f && f.key.includes("route=a")).map((f) => f.key))
  expect(keys).toEqual(["GET /api/json?route=a rsc=1 next-router-prefetch=1", "GET /api/json?route=a rsc=1"])
  await h.seek((await h.state()).now - 10) // rebuilt: the navigation asks first (so it lands later)
  expect(pick(await h.log(), "rsc").map((e) => e.v)).toEqual(live.map((e) => e.v))
})
