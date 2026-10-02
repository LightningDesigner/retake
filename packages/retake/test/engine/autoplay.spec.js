// S4 (Sherpa): a background <video autoplay loop muted> wasn't put at its
// recorded time after a rebuild and kept playing while the clock was paused.
import { test, expect } from "@playwright/test"
import { openDock } from "./helpers.js"
import { PORTS } from "./servers.js"
test.use({ launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] } })
const ct = (h) => h.rt(() => { const a = document.getElementById("bg"); return { t: a.currentTime, paused: a.paused } })

test("autoplay media pauses with the clock and sits at its virtual time after a rebuild and in the preview", async ({ page }) => {
  const h = await openDock(page, `http://localhost:${PORTS.probe}/`)
  await page.waitForTimeout(2000)
  await h.pause()
  await page.waitForTimeout(300)
  const a = await ct(h)
  expect(a.paused).toBe(true)
  await page.waitForTimeout(500)
  expect((await ct(h)).t).toBeCloseTo(a.t, 1) // really stopped
  const now = (await h.state()).now
  await h.seek(now - 1000)
  await page.waitForTimeout(300) // the rebuilt frame media loads in real time
  const b = await ct(h)
  expect(b.paused).toBe(true)
  const want = (((a.t - 1) % 3) + 3) % 3
  expect(Math.abs(b.t - want)).toBeLessThan(0.15)
  await h.seek(now)
  await page.waitForTimeout(300)
  expect(Math.abs((await ct(h)).t - a.t)).toBeLessThan(0.15)
  await h.rt((t) => __retake.preview(t), now - 500)
  await page.waitForTimeout(100)
  expect(Math.abs((await ct(h)).t - ((((a.t - 0.5) % 3) + 3) % 3))).toBeLessThan(0.15)
  await h.rt(() => __retake.endPreview())
})
