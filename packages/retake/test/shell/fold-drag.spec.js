// Dragging the divider down follows the pointer all the way to the bottom edge
// (below the minimum height the dock slides down rather than stopping), then on
// release it eases into the corner icon, or springs back up to the minimum.
import { test, expect } from "@playwright/test"
import { openDock, DOCK_URL, shot } from "./helpers.js"

const SHOW = 'button[aria-label="Show timeline"]'
const frames = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
const dockTop = (page) => page.evaluate(() => document.querySelector("#wb-dock").getBoundingClientRect().top)
const dockTransform = (page) => page.evaluate(() => getComputedStyle(document.querySelector("#wb-dock")).transform)

async function grab(page) {
  await page.evaluate(() => localStorage.removeItem("retake:collapsed"))
  const div = await page.locator(".divider span").boundingBox()
  const x = div.x + div.width / 2
  const y = div.y + div.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  return { x, y, grip: y - (await dockTop(page)) }
}

test("the dock follows the pointer down past its minimum height to the bottom edge, without resizing the app", async ({ page }) => {
  const h = await openDock(page, DOCK_URL)
  const app = await page.locator("#wb-stage iframe.live").boundingBox()
  const { x, y: y0, grip } = await grab(page)
  const minTop = 800 - (await page.evaluate(() => window.__retakeDock.state.branches.length * 10 + 96))
  const told = []
  for (let y = y0; y <= 790; y += 25) {
    await page.mouse.move(x, y)
    await frames(page)
    // The handle stays under the pointer the whole way: no hard stop at the minimum.
    expect(Math.abs((await dockTop(page)) - (y - grip))).toBeLessThanOrEqual(2)
    told.push(await page.evaluate(() => document.querySelector("#wb-stage iframe.live").contentWindow.__retakeDockHeight))
  }
  expect(await dockTop(page)).toBeGreaterThan(minTop + 40)
  // Below the minimum it's a transform: the app keeps its size, and what the app
  // is told about the dock stops at the minimum height.
  expect(await page.locator("#wb-stage iframe.live").boundingBox()).toEqual(app)
  expect(Math.min(...told)).toBeGreaterThanOrEqual(96)
  expect(await dockTransform(page)).toMatch(/^matrix\(1, 0, 0, 1, 0, \d/)
  await page.mouse.up()
  await expect(page.locator(SHOW)).toBeVisible()
  expect(h.dockErrors).toEqual([])
})

test("let go low enough and it eases into the icon; let go higher and it springs back to the minimum height", async ({ page }) => {
  const h = await openDock(page, DOCK_URL)
  // A little below the minimum: back up, animated, to the minimum.
  let g = await grab(page)
  const minH = await page.evaluate(() => Math.max(96, 56 + 24 + window.__retakeDock.state.branches.length * 10 + 16))
  const minTopHandle = 800 - minH + g.grip
  await page.mouse.move(g.x, minTopHandle + 20, { steps: 6 })
  await frames(page)
  expect(await dockTop(page)).toBeGreaterThan(800 - minH + 15)
  await page.mouse.up()
  // Mid-spring it's on its way up, not there yet and not jumped.
  const mid = await dockTop(page)
  expect(mid).toBeGreaterThan(800 - minH + 2)
  await expect.poll(() => dockTop(page)).toBeCloseTo(800 - minH, 0)
  expect(await dockTransform(page)).toBe("none")
  await expect(page.locator(SHOW)).toBeHidden()
  expect(await page.locator("#wb-dock").evaluate((d) => d.offsetHeight)).toBe(minH)

  // Past half the minimum height: it carries on down into the icon, with an animation.
  g = await grab(page)
  await page.mouse.move(g.x, g.y + minH * 0.6, { steps: 6 })
  await frames(page)
  const before = await dockTop(page)
  await page.mouse.up()
  await frames(page)
  const during = await dockTop(page)
  expect(during).toBeGreaterThanOrEqual(before - 1)
  expect(during).toBeLessThan(800)
  await expect(page.locator(SHOW)).toBeVisible()
  await expect(page.locator("#wb-dock")).toBeHidden()
  await shot(page, "fold-drag-folded.png")
  expect(h.dockErrors).toEqual([])
})

test("with reduced motion it folds at once", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" })
  const h = await openDock(page, DOCK_URL)
  const g = await grab(page)
  await page.mouse.move(g.x, 795, { steps: 6 })
  await page.mouse.up()
  await frames(page)
  await expect(page.locator("#wb-dock")).toBeHidden({ timeout: 200 })
  await expect(page.locator(SHOW)).toBeVisible()
  expect(h.dockErrors).toEqual([])
})

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test("a finger drags the dock down continuously; let go high, it springs back; at the bottom, it folds", async ({ page }) => {
    const h = await openDock(page, DOCK_URL)
    await page.evaluate(() => localStorage.removeItem("retake:collapsed"))
    const cdp = await page.context().newCDPSession(page)
    const touchDrag = async (to, check) => {
      const div = await page.locator(".divider span").boundingBox()
      const x = Math.round(div.x + div.width / 2)
      const y0 = Math.round(div.y + div.height / 2)
      const grip = y0 - (await dockTop(page))
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y: y0 }] })
      for (let i = 1; i <= 12; i++) {
        const y = Math.round(y0 + ((to - y0) * i) / 12)
        await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y }] })
        if (check) {
          await frames(page)
          expect(Math.abs((await dockTop(page)) - (y - grip))).toBeLessThanOrEqual(2)
        }
      }
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
    }
    const minH = await page.evaluate(() => Math.max(96, 56 + 24 + window.__retakeDock.state.branches.length * 10 + 16))
    // First down to the minimum, then a short pull below it: back up.
    await touchDrag(844 - minH + 10)
    await expect.poll(() => dockTop(page)).toBeCloseTo(844 - minH, 0)
    await touchDrag(844 - minH + 30, true)
    await expect.poll(() => dockTop(page)).toBeCloseTo(844 - minH, 0)
    await expect(page.locator(SHOW)).toBeHidden()
    // All the way: it follows the finger, then folds.
    await touchDrag(840, true)
    await expect(page.locator(SHOW)).toBeVisible()
    expect(await page.evaluate(() => document.body.classList.contains("dragging"))).toBe(false)
    expect(h.dockErrors).toEqual([])
  })
})
