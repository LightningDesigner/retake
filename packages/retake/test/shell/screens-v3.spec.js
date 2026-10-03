// Screenshots of the dock for review: v3 (notch, buttons, Control-click,
// minimized, the notes count) and the glass over a light page.
import { test, expect } from "@playwright/test"
import { openDock, DOCK_URL, dock, recordSome, recordAndRewind, xOfTime, shot } from "./helpers.js"

test("v3 + glass screenshots", async ({ page }) => {
  const h = await openDock(page, DOCK_URL)
  await recordSome(h, ["#toggle", "#spinner", "#toggle"])
  await h.pause()
  await page.waitForTimeout(300)
  await shot(page, "dock-v3-notch.png")
  await page.screenshot({ path: "../../test-results/screens/dock-v3-buttons.png", clip: { x: 16, y: 600, width: 1248, height: 64 } })
  // Control held over the track: the guide.
  const s = await h.state()
  const g = await page.locator(".lines").boundingBox()
  const x = await xOfTime(page, s.start + (s.end - s.start) * 0.4)
  await page.mouse.move(x, g.y + g.height - 10)
  await page.keyboard.down("Control")
  await page.mouse.move(x + 1, g.y + g.height - 10)
  await expect.poll(() => dock(page, (D) => D.branchT)).not.toBe(null)
  await shot(page, "dock-v3-ctrl-guide.png")
  await page.mouse.click(x + 1, g.y + g.height - 10)
  await page.keyboard.up("Control")
  await expect.poll(() => dock(page, (D) => D.branches.length)).toBe(2)
  await h.settle()
  await page.waitForTimeout(300)
  expect((await h.state()).playing).toBe(false)
  await shot(page, "dock-v3-new-branch.png")
  // A note, then its count on the notes icon.
  const b = await h.box("#card")
  await page.keyboard.down("Meta")
  await page.mouse.move(b.x + 30, b.y + 20)
  await page.mouse.click(b.x + 30, b.y + 20)
  await page.keyboard.up("Meta")
  await page.locator("#wb-note textarea").fill("Softer blue here")
  await page.locator("#wb-note textarea").press("Enter")
  await expect(page.locator(".notes-count .n")).toHaveText("1")
  await shot(page, "dock-v3-notes-count.png")
  await page.keyboard.press("Escape")
  // Minimized: colour dots.
  await dock(page, (D) => (D.height = 60))
  await page.waitForTimeout(300)
  await shot(page, "dock-v3-minimized.png")
  expect(await dock(page, (D) => D.compact)).toBe(true)
  // Glass over a light page.
  await dock(page, (D) => (D.height = 200))
  await page.goto(DOCK_URL + "other.html")
  await page.waitForTimeout(1500)
  await shot(page, "dock-glass-light.png")
})
