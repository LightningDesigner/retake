// Ranges and branches without a mouse (F129): on an open animation with a
// point, Shift+←/→ grows a range from the point, 10ms of its own clock a press
// (stopping on keyframes; ⌥ jumps to the next one), and the hint reads it;
// ⌥+←/→ moves the point keyframe to keyframe; + branches at the playhead.
// Port 3338 (the anim-app fixture, served here).
import { test, expect } from "@playwright/test"
import { dock } from "./helpers.js"
import { serveAnimApp, recordAnims, metaClick, rowPoint, openCapsule, activeStartOf } from "./anim-fixture.js"

const PORT = 3338
const URL = `http://localhost:${PORT}/`
let server
test.beforeAll(async () => {
  server = await serveAnimApp(PORT)
})
test.afterAll(async () => {
  await server?.close()
})

// The ticker open on its own clock, the point at local `at` ms.
async function pointOnTicker(page, at) {
  const { h, ticker } = await recordAnims(page, URL)
  await h.seek(ticker.start + 200 + 300)
  await metaClick(h, ".ticker")
  await openCapsule(h, ticker.id)
  const a0 = await activeStartOf(page)
  const p = await rowPoint(page, a0 + at)
  await page.mouse.click(p.x, p.y)
  await expect.poll(() => dock(page, (D) => D.focus.pin != null && Math.round(D.focus.pin - D.focus.open.model.timing.activeStart))).toBe(at)
  return { h, ticker, a0 }
}
// Where a keyframe is reached on the open clip's own clock (its tick on the row).
const keyframeLocal = (page, offset) => dock(page, (D, o) => D.scene.focus.ticks.find((k) => Math.abs(k.offset - o) < 1e-6).local, offset)
const localRange = (page) => dock(page, (D) => D.focus.range && [Math.round(D.focus.range.from - D.focus.open.model.timing.activeStart), Math.round(D.focus.range.to - D.focus.open.model.timing.activeStart)])

test("F129: Shift+→ grows a range from the point 10ms at a time, the hint reads it, Shift+← turns it round", async ({ page }) => {
  const { h } = await pointOnTicker(page, 200)
  for (let i = 0; i < 3; i++) await page.keyboard.press("Shift+ArrowRight")
  expect(await localRange(page)).toEqual([200, 230])
  await expect(page.locator(".hint")).toHaveText("Range 200–230ms · 10–12% of transform")
  // Back past the point: the range is on its other side.
  for (let i = 0; i < 4; i++) await page.keyboard.press("Shift+ArrowLeft")
  expect(await localRange(page)).toEqual([190, 200])
  // ⌥+Shift: to the next keyframe (offset 0.3, reached at local ~759ms through the effect's ease-in-out).
  const kf = await keyframeLocal(page, 0.3)
  await page.keyboard.press("Shift+ArrowRight")
  await page.keyboard.press("Alt+Shift+ArrowRight")
  expect(await localRange(page)).toEqual([200, kf])
  // The note carries it.
  await page.waitForTimeout(400)
  const ta = page.locator("#wb-note textarea")
  await ta.fill("hold it here")
  await ta.press("Enter")
  const n = await dock(page, (D) => D.notes.at(-1).anims[0])
  expect([Math.round(n.from.local), Math.round(n.to.local)]).toEqual([200, kf])
  expect(h.dockErrors).toEqual([])
})

test("F129: ⌥+→ moves the point keyframe to keyframe; a range grown from it stops on a keyframe", async ({ page }) => {
  const { a0 } = await pointOnTicker(page, 580)
  const kf = await keyframeLocal(page, 0.3)
  const pin = () => dock(page, (D) => Math.round(D.focus.pin - D.focus.open.model.timing.activeStart))
  await page.keyboard.press("Alt+ArrowRight")
  await expect.poll(pin).toBe(kf)
  await page.keyboard.press("Alt+ArrowLeft")
  await expect.poll(pin).toBe(0)
  // Growing past a keyframe off the 10ms grid: the range stops on it, then goes on.
  const start = Math.floor(kf / 10) * 10 - 30
  const p = await rowPoint(page, a0 + start)
  await page.mouse.click(p.x, p.y)
  await expect.poll(pin).toBe(start)
  for (let i = 0; i < 4; i++) await page.keyboard.press("Shift+ArrowRight")
  expect(await localRange(page)).toEqual([start, kf])
  await page.keyboard.press("Shift+ArrowRight")
  expect(await localRange(page)).toEqual([start, start + 40])
})

test("+ branches a new timeline at the playhead", async ({ page }) => {
  const { h } = await recordAnims(page, URL)
  const s = await h.state()
  await h.seek(s.start + (s.end - s.start) / 2)
  const before = await dock(page, (D) => D.branches.length)
  await page.keyboard.press("+")
  await expect.poll(() => dock(page, (D) => D.branches.length)).toBe(before + 1)
})
