// S4 (Sherpa): canvas-confetti draws in a Worker (OffscreenCanvas) on real
// time and randomness, so every rebuild drew something else.
import { test, expect } from "@playwright/test"
import { openDock, pick } from "./helpers.js"
import { PORTS } from "./servers.js"

test("a worker drawing on an OffscreenCanvas draws the same thing on replay", async ({ page }) => {
  const h = await openDock(page, `http://localhost:${PORTS.probe}/`)
  await page.waitForTimeout(300)
  await h.click("#conf")
  await expect.poll(async () => pick(await h.log(), "conf").length, { timeout: 5000 }).toBe(12)
  await h.pause()
  const live = pick(await h.log(), "conf").map((e) => e.v)
  await h.seek((await h.state()).now - 1)
  await expect.poll(async () => pick(await h.log(), "conf").length, { timeout: 5000 }).toBe(12)
  expect(pick(await h.log(), "conf").map((e) => e.v)).toEqual(live)
})
