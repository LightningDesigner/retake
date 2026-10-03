// Screenshots of the dock for review (test-results/screens/dock-v2-*.png), with the
// assertions that make them worth looking at. Zoomed-out-with-0-pinned is
// taken by timeline.spec.js, branching mid-growth by branching.spec.js.
import { test, expect } from "@playwright/test"
import { openDock, DOCK_URL, recordSome, dock, shot } from "./helpers.js"

const laneY = (page, id) => dock(page, (D, id) => D.lanes.get(id ?? D.activeId).y + document.querySelector(".lines").getBoundingClientRect().top, id)
const xOf = (page, t) =>
  page.evaluate((t) => {
    const D = window.__retakeDock.state
    const r = document.querySelector(".lines").getBoundingClientRect()
    return r.left + 12 + ((t - D.view.from) / (D.view.to - D.view.from)) * (r.width - 30)
  }, t)

test("dock v2: idle drawer", async ({ page }) => {
  const h = await openDock(page, DOCK_URL)
  await page.waitForTimeout(900)
  await shot(page, "dock-v2-idle.png")
  expect(h.dockErrors).toEqual([])
})

test("dock v2: a note popover near the right edge stays on screen, arrow on the spot", async ({ page }) => {
  const h = await openDock(page, DOCK_URL)
  await recordSome(h, ["#toggle"])
  await h.pause()
  const s = await h.state()
  await h.seek(s.start + (s.end - s.start) * 0.5)
  await page.waitForTimeout(250)
  const b = await h.box("[id=':r1:']")
  const spot = { x: b.x + b.w - 12, y: b.y + b.h / 2 }
  await page.keyboard.down("Meta")
  await page.mouse.move(spot.x, spot.y)
  await page.mouse.click(spot.x, spot.y)
  await page.keyboard.up("Meta")
  const ta = page.locator("#wb-note textarea")
  await ta.fill("This box should stop short of the edge")
  await ta.press("Enter")
  await page.locator(".canvas-pin").click()
  await expect(page.locator("#wb-note .note-text")).toBeVisible()
  await page.waitForTimeout(250)
  const card = await page.locator("#wb-note").boundingBox()
  expect(card.x).toBeGreaterThanOrEqual(8)
  expect(card.x + card.width).toBeLessThanOrEqual(1280 - 8 + 0.5)
  const dockTop = (await page.locator("#wb-dock").boundingBox()).y
  expect(card.y + card.height).toBeLessThanOrEqual(dockTop)
  // The arrow's tip is on the clicked spot (within a few px).
  const arrow = await page.locator("#wb-note .arrow").boundingBox()
  const side = await page.locator("#wb-note").getAttribute("data-side")
  const ax = arrow.x + arrow.width / 2
  const ay = arrow.y + arrow.height / 2
  if (side === "below" || side === "above") expect(Math.abs(ax - spot.x)).toBeLessThan(6)
  else expect(Math.abs(ay - spot.y)).toBeLessThan(6)
  // Details fold away; the selector isn't dumped in the card.
  await expect(page.locator("#wb-note .details dl")).toBeHidden()
  await page.locator("#wb-note .details summary").click()
  await expect(page.locator("#wb-note .details dd").first()).toContainText("#\\:r1\\:")
  await shot(page, "dock-v2-note.png")
  expect(h.dockErrors).toEqual([])
})
