// S4 (Sherpa): :hover styles never showed in rebuilds or previews, so hover
// transitions logged live as clips were invisible when scrubbing.
import { test, expect } from "@playwright/test"
import { openDock } from "./helpers.js"
import { PORTS } from "./servers.js"
const bg = (h) => h.rt(() => getComputedStyle(document.getElementById("hov")).backgroundColor)

test(":hover and its transition replay at the recorded moment, and in the preview", async ({ page }) => {
  const h = await openDock(page, `http://localhost:${PORTS.probe}/`)
  await page.waitForTimeout(300)
  const b = await h.box("#hov")
  await page.mouse.move(b.x - 30, b.y + 10)
  await page.waitForTimeout(100)
  await page.mouse.move(b.x + 20, b.y + 10)
  await page.waitForTimeout(90)
  await h.pause()
  await page.waitForTimeout(100)
  const midT = (await h.state()).now
  const mid = await bg(h)
  expect(mid).not.toBe("rgb(255, 255, 255)") // mid-transition
  expect(mid).not.toBe("rgb(0, 0, 255)")
  await h.record()
  await page.waitForTimeout(500)
  await h.pause()
  const endT = (await h.state()).now
  expect(await bg(h)).toBe("rgb(0, 0, 255)")
  // preview (drag back) at the mid moment
  await h.rt((t) => __retake.preview(t), midT)
  await page.waitForTimeout(50)
  expect(await h.rt(() => document.getElementById("hov").hasAttribute("data-rt-hover"))).toBe(true)
  await h.rt(() => __retake.endPreview())
  // rebuild to the mid moment: same colour as live
  await h.seek(midT)
  expect(await bg(h)).toBe(mid)
  // and to the end (still hovered, fully blue)
  await h.seek(endT - 1)
  expect(await bg(h)).toBe("rgb(0, 0, 255)")
})
