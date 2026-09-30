// Records one session on the probe fixture, rewinds to (almost) its end, and
// compares what the app observed live against what it observed on replay.
// Known gaps are test.fail with their AUDIT.md finding ID; flip them when fixed.
import { test, expect } from "@playwright/test"
import { openDock, pick } from "./helpers.js"
import { PORTS } from "./servers.js"

let live, replay, T, h, context
test.describe.configure({ mode: "serial" })

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await context.newPage()
  h = await openDock(page, `http://localhost:${PORTS.probe}/`)
  await h.record()
  await page.waitForTimeout(800)
  await h.click("#go")
  await page.waitForTimeout(2500)
  await h.click("#q"); await page.keyboard.type("hi"); await page.keyboard.press("Enter")
  await h.click("#cb")
  const s = await h.box("#slider")
  await page.mouse.move(s.x + 10, s.y + s.h / 2); await page.mouse.down(); await page.mouse.move(s.x + 150, s.y + s.h / 2, { steps: 8 }); await page.mouse.up()
  const p = await h.box("#pad")
  await page.mouse.move(p.x + 5, p.y + 20); await page.mouse.move(p.x + 150, p.y + 20, { steps: 10 }); await page.mouse.click(p.x + 100, p.y + 40)
  await h.click("#sse")
  await page.waitForTimeout(300)
  await h.click("#slow")
  await page.waitForTimeout(3500)
  await h.pause()
  const st = await h.state()
  live = await h.log()
  T = st.now - 5
  await h.seek(T)
  replay = await h.log()
  T += 1000 // log times are performance.now(), which is clock + 1000
})
test.afterAll(() => context && context.close())

const same = (k) => expect(pick(replay, k, T), k).toEqual(pick(live, k, T))

test("Math.random, randomUUID and Date replay identically", () => { same("random"); same("uuid"); same("date"); same("click-random") })
test("timers replay identically", () => { expect(pick(live, "tick", T).length).toBeGreaterThan(10); same("tick") })
test("CSS transitions and WAAPI end at the same virtual time", () => { same("transitionend"); same("waapi-finished") })
test("fetch responses are served from the recording", () => { expect(pick(live, "json", T).length).toBe(1); same("json") })
test("localStorage is restored to the recording's start", () => same("storage"))
test("pointer capture + slider drag replays", () => { same("capture"); same("slider") })
test("microtasks are deterministic", () => same("microtask"))

test("F17 crypto.getRandomValues is seeded", () => { test.fail(); same("getRandomValues") })
test("F17 IntersectionObserver/ResizeObserver fire at the recorded time", () => { test.fail(); same("io"); same("ro") })
test("F17 Worker messages replay", () => { test.fail(); same("worker") })
test("F8 cookies are restored", () => { test.fail(); same("cookie") })
test("F8 IndexedDB is restored", () => { test.fail(); same("idb-count") })
test("F6 XHR is recorded and replayed", () => { test.fail(); same("xhr") })
test("F6 EventSource is recorded and replayed", () => { test.fail(); expect(pick(live, "sse", T).length).toBe(4); same("sse") })
test("F5 streamed fetch bodies arrive chunk by chunk", () => {
  test.fail()
  const chunks = pick(live, "stream-chunk", T)
  expect(chunks.length).toBeGreaterThan(1)
  expect(chunks[chunks.length - 1].vt - chunks[0].vt).toBeGreaterThan(500)
  same("stream-chunk")
})
test("F11 keyCode survives replay", () => { test.fail(); same("keycode") })
test("F11 mousemove replays", () => { test.fail(); expect(pick(live, "mousemoves", T)[0].v).toBeGreaterThan(0); same("mousemoves") })
test("F12 Enter-to-submit (no submit button) replays", () => { test.fail(); expect(pick(live, "submit", T).length).toBe(1); same("submit") })
test("F12 checkbox fires one change on replay", () => { test.fail(); same("change") })
test("F13 aborted fetch rejects with AbortError", () => { test.fail(); expect(pick(live, "slow-err", T)[0].v).toBe("AbortError") })
test("no page errors", () => expect(h.errors).toEqual([]))
