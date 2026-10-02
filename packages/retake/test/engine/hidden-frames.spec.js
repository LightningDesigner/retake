// F52: a request still in flight when the recording was cut was sent again by
// every frame built behind (a rebuild, a checkpoint), and by the frame on show
// playing the past. It now waits until the frame is on show at the live edge,
// then goes out once (and is recorded). The probe's ?count: the "Count"
// button's slow request, counted by the server.
import { test, expect } from "@playwright/test"
import { openDock, pick } from "./helpers.js"
import { PORTS } from "./servers.js"

const URL_ = `http://localhost:${PORTS.probe}`
test("a request cut in flight isn't sent again by rebuilds, only once Play reaches the live edge (F52)", async ({ page }) => {
  const run = Math.random().toString(36).slice(2)
  const hits = async () => Number(await (await page.request.get(`${URL_}/api/count?hits=1&id=${run}`)).text())
  const h = await openDock(page, `${URL_}/?count=${run}`)
  await page.waitForTimeout(400)
  await h.click("#count")
  await page.waitForTimeout(300)
  await h.pause() // the request (1.5s) is still in flight
  expect(await hits()).toBe(1)
  const T = (await h.state()).now
  await h.seek(T - 100)
  await h.seek(200)
  await h.seek(T - 50)
  await page.waitForTimeout(2000)
  expect(await hits()).toBe(1)
  expect(pick(await h.log(), "count")).toEqual([])
  // Play: the past replays (still nothing sent), then live it goes out once.
  await h.rt(() => __retake.play())
  await expect.poll(async () => pick(await h.log(), "count").length, { timeout: 6000 }).toBe(1)
  expect(await hits()).toBe(2)
  await h.pause()
  // ...and it's in the recording now: a rebuild after it replays it, offline.
  await h.seek((await h.state()).now - 10)
  expect(pick(await h.log(), "count")).toHaveLength(1)
  expect(await hits()).toBe(2)
})
