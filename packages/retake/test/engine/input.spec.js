// M5 input coverage: wheel, back/forward through hashes, requestIdleCallback.
import { test, expect } from "@playwright/test"
import { openDock, pick } from "./helpers.js"
import { PORTS } from "./servers.js"
const URL_ = `http://localhost:${PORTS.probe}/`

test("wheel and back/forward navigation replay", async ({ page }) => {
  const h = await openDock(page, URL_)
  await page.waitForTimeout(300)
  const p = await h.box("#pad")
  await page.mouse.move(p.x + 20, p.y + 20)
  await page.mouse.wheel(0, 120)
  await page.waitForTimeout(100)
  await page.mouse.wheel(0, 240)
  await page.waitForTimeout(200)
  await h.click("#next") // p=1
  await page.waitForTimeout(150)
  await h.click("#next") // p=2
  await page.waitForTimeout(150)
  await page.goBack() // the browser's Back button
  await page.waitForTimeout(400)
  await h.pause()
  const live = await h.log()
  expect(pick(live, "wheel").length).toBeGreaterThan(0)
  expect(pick(live, "page").map((e) => e.v)).toEqual(["1", "2", "1"])
  const T = (await h.state()).now
  await h.seek(T - 1)
  const replay = await h.log()
  expect(pick(replay, "wheel")).toEqual(pick(live, "wheel"))
  expect(pick(replay, "page")).toEqual(pick(live, "page"))
  expect(await h.rt(() => new URLSearchParams(location.search).get("p"))).toBe("1")
})

test("requestIdleCallback runs on the virtual clock", async ({ page }) => {
  const h = await openDock(page, URL_)
  await page.waitForTimeout(300)
  await h.pause()
  const live = pick(await h.log(), "ric")
  expect(live.length).toBe(1)
  await h.seek((await h.state()).now - 1)
  expect(pick(await h.log(), "ric")).toEqual(live)
})
