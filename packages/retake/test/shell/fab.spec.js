// The dock is open on a first visit. Folded, it's a round button that starts in
// the bottom-right corner and can be dragged anywhere (mouse or finger): a
// press that barely moves is still a click, a drag eases to the nearer side
// edge on release, and where it sits is remembered across reloads and resizes.
// The button wears Retake's mark (src/mark.svg) and a dot for the phase.
import { test, expect } from "@playwright/test"
import { openDock, DOCK_URL, recordSome, dock, shot } from "./helpers.js"
import { markSvg, shellHtml } from "../../src/plugin.js"

const SHOW = 'button[aria-label="Show timeline"]'
const box = (page) => page.locator(SHOW).boundingBox()
const settled = async (page) => {
  // The snap is a short transition: wait until the button stops moving.
  let last = null
  await expect
    .poll(async () => {
      const b = await box(page)
      const same = last && Math.abs(b.x - last.x) < 0.5 && Math.abs(b.y - last.y) < 0.5
      last = b
      return same
    })
    .toBe(true)
  return last
}

async function fold(page) {
  // ⌥T from the dock (the app, live, keeps its own keys).
  await page.locator("#wb-dock .play").focus()
  await page.keyboard.press("Alt+KeyT")
  await expect(page.locator(SHOW)).toBeVisible()
  return settled(page)
}

test("a first visit opens with the dock expanded; folding puts the button in the bottom-right corner", async ({ page }) => {
  const h = await openDock(page, DOCK_URL)
  expect(await page.evaluate(() => localStorage.getItem("retake:collapsed"))).toBe(null)
  await expect(page.locator("#wb-dock")).toBeVisible()
  await expect(page.locator(SHOW)).toBeHidden()
  const b = await fold(page)
  expect(b.x + b.width).toBeCloseTo(1280 - 16, 0)
  expect(b.y + b.height).toBeCloseTo(800 - 16, 0)
  expect(h.dockErrors).toEqual([])
})

test("drag the button anywhere: it follows the pointer, eases to the nearer side, stays on screen and is remembered", async ({ page }) => {
  const h = await openDock(page, DOCK_URL)
  let b = await fold(page)
  const cx = b.x + b.width / 2
  const cy = b.y + b.height / 2
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  // Under the pointer while it moves.
  for (const [x, y] of [[1000, 600], [600, 400], [300, 300]]) {
    await page.mouse.move(x, y, { steps: 6 })
    const now = await box(page)
    expect(Math.abs(now.x + now.width / 2 - x)).toBeLessThanOrEqual(1)
    expect(Math.abs(now.y + now.height / 2 - y)).toBeLessThanOrEqual(1)
  }
  await page.mouse.up()
  // Not a click: the dock stays folded. It eases to the left edge, same height.
  await page.waitForTimeout(50)
  const mid = await box(page)
  expect(mid.x).toBeGreaterThan(16 + 1) // still on its way
  b = await settled(page)
  expect(b.x).toBeCloseTo(16, 0)
  expect(b.y + b.height / 2).toBeCloseTo(300, 0)
  await expect(page.locator("#wb-dock")).toBeHidden()
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("retake:fab")))
  expect(stored.side).toBe("left")

  // Remembered across a reload.
  await page.reload()
  await h.settle()
  b = await settled(page)
  expect(b.x).toBeCloseTo(16, 0)
  expect(b.y + b.height / 2).toBeCloseTo(300, 0)

  // A smaller window: still on its side, the same way down, fully on screen.
  await page.setViewportSize({ width: 700, height: 500 })
  b = await settled(page)
  expect(b.x).toBeCloseTo(16, 0)
  const frac = (300 - 22 - 16) / (800 - 44 - 32)
  expect(b.y).toBeCloseTo(16 + frac * (500 - 44 - 32), 0)

  // Dragged past the window's corner, it stops at the edge and snaps right.
  await page.mouse.move(b.x + 22, b.y + 22)
  await page.mouse.down()
  await page.mouse.move(2000, 2000, { steps: 8 })
  const edge = await box(page)
  expect(edge.x + edge.width / 2).toBeLessThanOrEqual(700 - 16 - 22 + 0.5)
  expect(edge.y + edge.height / 2).toBeLessThanOrEqual(500 - 16 - 22 + 0.5)
  await page.mouse.up()
  b = await settled(page)
  expect(b.x + b.width).toBeCloseTo(700 - 16, 0)
  expect(b.y + b.height).toBeCloseTo(500 - 16, 0)
  await expect(page.locator("#wb-dock")).toBeHidden()
  expect(h.dockErrors).toEqual([])
})

test("a press that moves a few px is still a click; Space and Enter open the dock too", async ({ page }) => {
  const h = await openDock(page, DOCK_URL)
  let b = await fold(page)
  await page.mouse.move(b.x + 20, b.y + 20)
  await page.mouse.down()
  await page.mouse.move(b.x + 23, b.y + 22, { steps: 2 })
  await page.mouse.up()
  await expect(page.locator("#wb-dock")).toBeVisible()
  await expect(page.locator(SHOW)).toBeHidden()

  await fold(page)
  await page.locator(SHOW).focus()
  await page.keyboard.press("Space")
  await expect(page.locator("#wb-dock")).toBeVisible()
  await fold(page)
  await page.locator(SHOW).focus()
  await page.keyboard.press("Enter")
  await expect(page.locator("#wb-dock")).toBeVisible()
  // After a drag, the next plain click still opens it.
  b = await fold(page)
  await page.mouse.move(b.x + 22, b.y + 22)
  await page.mouse.down()
  await page.mouse.move(400, 200, { steps: 6 })
  await page.mouse.up()
  await expect(page.locator("#wb-dock")).toBeHidden()
  b = await settled(page)
  await page.mouse.click(b.x + 22, b.y + 22)
  await expect(page.locator("#wb-dock")).toBeVisible()
  expect(h.dockErrors).toEqual([])
})

test("the button wears Retake's mark and the phase dot; markSvg() is the same mark", async ({ page }) => {
  const h = await openDock(page, DOCK_URL)
  const mark = markSvg()
  expect(mark).toMatch(/^<svg [^>]*viewBox="0 0 24 24"/)
  expect(mark).not.toMatch(/<svg[^>]*\s(width|height)=/)
  expect(shellHtml()).toContain(mark.slice(mark.indexOf(">") + 1))
  await recordSome(h, ["#toggle"])
  await fold(page)
  await expect(page.locator(`${SHOW} svg circle`)).toHaveCount(1)
  await expect(page.locator(`${SHOW} svg`)).toHaveAttribute("width", "22")
  await expect(page.locator(SHOW)).toHaveAttribute("data-phase", "live")
  await page.locator(SHOW).screenshot({ path: "../../test-results/screens/fab.png" })
  await shot(page, "fab-corner.png")
  expect(h.dockErrors).toEqual([])
})

test("with reduced motion the snap is instant", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" })
  const h = await openDock(page, DOCK_URL)
  const b = await fold(page)
  await page.mouse.move(b.x + 22, b.y + 22)
  await page.mouse.down()
  await page.mouse.move(500, 300, { steps: 6 })
  await page.mouse.up()
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
  expect((await box(page)).x).toBeCloseTo(16, 0)
  expect(h.dockErrors).toEqual([])
})

test("a new timeline says so: \"Timeline 2 started\"", async ({ page }) => {
  const h = await openDock(page, DOCK_URL)
  await recordSome(h, ["#toggle", "#toggle"])
  await h.pause()
  const s = await h.state()
  await dock(page, (D, t) => window.__retakeDock.newTimelineAt(t), s.start + (s.end - s.start) / 2)
  await expect(page.locator(".hint")).toHaveText("Timeline 2 started")
  await expect(page.locator(".hint")).not.toHaveClass(/warn/)
  await expect(page.locator(".hint")).toHaveText("", { timeout: 5000 })
  expect(h.dockErrors).toEqual([])
})

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test("a finger drags the button to another spot; a tap opens the dock", async ({ page }) => {
    const h = await openDock(page, DOCK_URL)
    const b = await fold(page)
    const cdp = await page.context().newCDPSession(page)
    const x0 = Math.round(b.x + b.width / 2)
    const y0 = Math.round(b.y + b.height / 2)
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x0, y: y0 }] })
    for (let i = 1; i <= 12; i++) {
      const x = Math.round(x0 + ((80 - x0) * i) / 12)
      const y = Math.round(y0 + ((200 - y0) * i) / 12)
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y }] })
    }
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
    const during = await box(page)
    expect(Math.abs(during.x + during.width / 2 - 80)).toBeLessThanOrEqual(1)
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
    const at = await settled(page)
    expect(at.x).toBeCloseTo(16, 0)
    expect(at.y + at.height / 2).toBeCloseTo(200, 0)
    await expect(page.locator("#wb-dock")).toBeHidden()
    await page.touchscreen.tap(at.x + 22, at.y + 22)
    await expect(page.locator("#wb-dock")).toBeVisible()
    expect(h.dockErrors).toEqual([])
  })
})
