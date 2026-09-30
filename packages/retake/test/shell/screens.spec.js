// Screenshots for review (.coord/screens/): idle and zoomed with clips.
// Branching mid-animation and notes are taken by their own specs.
import { test, expect } from "@playwright/test"
import { openDock, DOCK_URL, recordSome, shot } from "./helpers.js"

test("screens: idle, and zoomed in on clips", async ({ page }) => {
  const h = await openDock(page, DOCK_URL)
  await page.waitForTimeout(600)
  await shot(page, "idle.png")
  await recordSome(h, ["#toggle", "#spinner", "#wave", "#toggle"])
  await h.pause()
  const s = await h.state()
  await h.seek(s.start + (s.end - s.start) * 0.45)
  const box = await page.locator(".lines").boundingBox()
  await page.mouse.move(box.x + box.width * 0.45, box.y + 30)
  await page.keyboard.down("Meta")
  for (let i = 0; i < 4; i++) await page.mouse.wheel(0, -60)
  await page.keyboard.up("Meta")
  await page.waitForTimeout(300)
  const hit = page.locator(".lines [data-clip]").first()
  const hb = await hit.boundingBox()
  if (hb) await page.mouse.move(hb.x + Math.min(8, hb.width / 2), hb.y + 1)
  await page.waitForTimeout(150)
  await shot(page, "zoomed-clips.png")
  expect(h.dockErrors).toEqual([])
})
