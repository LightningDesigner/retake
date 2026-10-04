// Ranges and branches without a mouse (F129): on an open animation with a
// point, Shift+←/→ grows a range from the point, 10ms of its own clock a press
// (stopping on keyframes; ⌥ jumps to the next one), and the hint reads it;
// ⌥+←/→ moves the point keyframe to keyframe; + branches at the playhead.
// Opening a clip without a mouse (F140): after a ⌘-click, Enter or ↓ opens the
// element's main clip, ↑/↓ go through its clips, the hint says which. The row's
// canvas items are buttons too (F141).
// Port 3338 (the anim-app fixture, served here).
import { test, expect } from "@playwright/test"
import { dock, openDock } from "./helpers.js"
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

// The pill: a transform and an opacity transition started together (#pop).
async function onPill(page) {
  const h = await openDock(page, URL)
  await h.record()
  await page.waitForTimeout(300)
  await h.click("#pop")
  await page.waitForTimeout(800)
  await h.pause()
  await page.waitForTimeout(300)
  const tl = await h.rt(() => __retake.timeline())
  const tr = tl.clips.filter((c) => c.kind === "transition" && /pill/.test(c.selector))
  await h.seek(Math.min(...tr.map((c) => c.start)) + 150)
  await metaClick(h, ".pill")
  return h
}
const openName = (page) => dock(page, (D) => D.focus && D.focus.open && D.focus.open.clip.property)

test("F140: after a ⌘-click, ↓ opens the main clip, ↑/↓ go through the element's clips, the hint says which; a range by keys; Esc closes", async ({ page }) => {
  const h = await onPill(page)
  const ta = page.locator("#wb-note textarea")
  await expect(ta).toBeFocused()
  await page.keyboard.press("ArrowDown")
  await expect.poll(() => openName(page)).not.toBeNull()
  const first = await openName(page)
  await expect(page.locator(".hint")).toContainText(`Open: ${first} transition`)
  await expect(page.locator(".hint")).toContainText(/\(\d of 2\)/)
  await page.keyboard.press("ArrowDown")
  await expect.poll(() => openName(page)).not.toBe(first)
  const second = await openName(page)
  expect([first, second].sort()).toEqual(["opacity", "transform"])
  await expect(page.locator(".hint")).toContainText(`Open: ${second} transition`)
  await page.keyboard.press("ArrowUp")
  await expect.poll(() => openName(page)).toBe(first)
  // A range from the point, by keys only, still in the empty note.
  await page.waitForTimeout(500)
  for (let i = 0; i < 3; i++) await page.keyboard.press("Shift+ArrowRight")
  await expect.poll(() => dock(page, (D) => !!D.focus.range)).toBe(true)
  await expect(page.locator(".hint")).toContainText("Range ")
  // Esc closes the clip, then the note.
  await page.keyboard.press("Escape")
  await expect.poll(() => openName(page)).toBeNull()
  await expect(page.locator("#wb-note")).toBeVisible()
  // Enter in the empty note opens it too; typed, Enter saves the note with the clip.
  await page.keyboard.press("Enter")
  await expect.poll(() => openName(page)).toBe(first)
  await expect(page.locator("#wb-note")).toBeVisible()
  await ta.fill("Fade faster")
  await ta.press("Enter")
  await expect(page.locator("#wb-note")).toBeHidden()
  expect(await dock(page, (D) => D.notes.at(-1).anims[0].name)).toBe(`${first} transition`)
  expect(h.dockErrors).toEqual([])
})

test("F140: Enter or ↓ with the dock focused (not the note) opens the clip; Enter on a dock button still presses it", async ({ page }) => {
  await onPill(page)
  // Out of the note, which stays open.
  await page.locator("#wb-note textarea").evaluate((el) => el.blur())
  await expect(page.locator("#wb-note")).toBeVisible()
  await page.keyboard.press("Enter")
  await expect.poll(() => openName(page)).not.toBeNull()
  await page.keyboard.press("Escape")
  await expect.poll(() => openName(page)).toBeNull()
  await page.keyboard.press("ArrowDown")
  await expect.poll(() => openName(page)).not.toBeNull()
  await page.keyboard.press("Escape")
  // Enter on Play plays (the row doesn't take it).
  await page.locator("#wb-dock button.play").focus()
  await page.keyboard.press("Enter")
  await expect.poll(() => dock(page, (D) => !!D.last.playing)).toBe(true)
})

test("F141: the row's clips are buttons, named and reachable without a pointer; Enter opens one, its Close button closes it", async ({ page }) => {
  const h = await onPill(page)
  const open = page.getByRole("button", { name: /^Open (transform|opacity) transition, \d+ms$/ })
  await expect(open).toHaveCount(2)
  const opacity = page.getByRole("button", { name: /^Open opacity transition/ })
  // Over its capsule on the canvas.
  const [b, cap] = await Promise.all([
    opacity.boundingBox(),
    dock(page, (D) => {
      const r = document.querySelector(".lines").getBoundingClientRect()
      const c = D.scene.focus.capsules.find((x) => x.clip.property === "opacity")
      return { x: r.left + (c.x0 + c.x1) / 2, y: r.top + c.y }
    }),
  ])
  expect(Math.abs(b.x + b.width / 2 - cap.x)).toBeLessThan(2)
  expect(Math.abs(b.y + b.height / 2 - cap.y)).toBeLessThan(2)
  await opacity.focus()
  await page.keyboard.press("Enter")
  await expect.poll(() => openName(page)).toBe("opacity")
  await expect(page.locator(".hint")).toContainText("Open: opacity transition")
  const close = page.getByRole("button", { name: "Close opacity transition" })
  await expect(close).toHaveAttribute("aria-expanded", "true")
  await expect(close).toBeFocused()
  await page.keyboard.press("Enter")
  await expect.poll(() => openName(page)).toBeNull()
  // A mouse click on the capsule (through the button) opens it once, as before.
  await page.waitForTimeout(500)
  await page.mouse.click(cap.x, cap.y)
  await expect.poll(() => openName(page)).toBe("opacity")
  expect(h.dockErrors).toEqual([])
})

// Enter with the playhead in the main clip's delay (F147): the clip opened
// there, the point stayed in the delay, where every frame reads "in the delay",
// so → looked frozen and Shift+→ gave a range of negative local times. It opens
// at its local 0 (as from outside it), then → and Shift+→ step its own clock.
const localPin = (page) => dock(page, (D) => (D.focus.pin != null ? Math.round(D.focus.pin - D.focus.open.model.timing.activeStart) : null))
for (const where of ["note", "page"]) {
  test(`F147: Enter in the clip's delay opens it at its start; → steps the point, Shift+→ ×2 a range (focus in the ${where === "note" ? "empty note" : "page"})`, async ({ page }) => {
    const { h, ticker } = await recordAnims(page, URL)
    // The ticker waits 200ms before it moves.
    await h.seek(ticker.start + 100)
    await metaClick(h, ".ticker")
    const ta = page.locator("#wb-note textarea")
    await expect(ta).toBeFocused()
    if (where === "page") {
      await ta.evaluate((el) => el.blur())
      expect(await page.evaluate(() => document.activeElement.tagName)).toBe("BODY")
    }
    await page.keyboard.press("Enter")
    await expect.poll(() => dock(page, (D) => !!D.focus.open)).toBe(true)
    await expect(page.locator(".hint")).toContainText("Open: transform")
    await h.settle()
    // The build behind replays a click (focus goes into its frame): a note being written keeps it.
    if (where === "note") await expect(ta).toBeFocused()
    const local = () => dock(page, (D) => Math.round((D.last.previewing ? D.last.previewAt : D.last.now) - D.focus.open.model.timing.activeStart))
    expect(await local()).toBe(1)
    await page.keyboard.press("ArrowRight")
    await expect.poll(() => localPin(page)).toBe(18)
    await expect(page.locator("#wb-note .note-at")).toContainText("at 18ms")
    await page.keyboard.press("Shift+ArrowRight")
    await page.keyboard.press("Shift+ArrowRight")
    await expect.poll(() => localRange(page)).toEqual([18, 30])
    await expect(page.locator(".hint")).toContainText("Range 18–30ms")
    expect(h.dockErrors).toEqual([])
  })
}
