// Range notes: a drag on an open clip of the focused element selects part of
// its own clock ("200–400ms of the ticker"); the note carries both edges on
// that clock and on the recording's, the keyframes inside, samples between, and
// copies as "change only local 200–400ms". Shift+drag on the track selects a
// range of recording time first, for an element that has no animation. Numbers
// typed in the note are read on the animation's own clock. Port 3357.
import { test, expect } from "@playwright/test"
import { dock } from "./helpers.js"
import { serveAnimApp, recordAnims, metaClick, rowPoint, openCapsule, activeStartOf } from "./anim-fixture.js"

const PORT = 3357
const URL = `http://localhost:${PORT}/`
let server
test.beforeAll(async () => {
  server = await serveAnimApp(PORT)
})
test.afterAll(async () => {
  await server?.close()
})

const lastNote = (page) => dock(page, (D) => JSON.parse(JSON.stringify(D.notes[D.notes.length - 1], (k, v) => (k === "el" ? undefined : v))))

test("drag 200→400 on the ticker's open clip: a range note on its own clock", async ({ page }) => {
  const { h, ticker } = await recordAnims(page, URL)
  await h.seek(ticker.start + 200 + 300)
  await metaClick(h, ".ticker")
  await openCapsule(h, ticker.id)
  const a0 = await activeStartOf(page)
  expect(a0).toBeCloseTo(ticker.start + 200, 0)
  const p0 = await rowPoint(page, a0 + 200)
  const p1 = await rowPoint(page, a0 + 400)
  await page.mouse.move(p0.x, p0.y)
  await page.mouse.down()
  await page.mouse.move((p0.x + p1.x) / 2, p0.y, { steps: 4 })
  await page.mouse.move(p1.x, p1.y, { steps: 4 })
  await page.mouse.up()
  await expect.poll(() => dock(page, (D) => D.scene.focus.band && D.scene.focus.band.label)).toBe("200–400ms · 10–20% of transform")
  await expect(page.locator("#wb-note .note-at")).toContainText("200–400ms (10–20%) of transform on <div.ticker>")
  await page.waitForTimeout(300)
  const ta = page.locator("#wb-note textarea")
  await ta.fill("between 200 and 400 ms slow it down")
  await expect(page.locator("#wb-note .note-asked")).toContainText("The dragged range is used")
  await ta.press("Enter")
  await expect(page.locator("#wb-note")).toBeHidden()
  const n = await lastNote(page)
  expect(n.range.to - n.range.from).toBeGreaterThan(190)
  expect(n.t).toBe(n.range.from)
  const a = n.anims[0]
  expect(a.kind).toBe("waapi")
  expect(Math.round(a.from.local)).toBe(200)
  expect(Math.round(a.to.local)).toBe(400)
  expect(a.keyframesInside).toEqual([])
  expect(a.samples).toHaveLength(8)
  expect(a.keyframes).toHaveLength(4)
  expect(a.timing).toMatchObject({ duration: 2000, delay: 200, easing: "ease-in-out" })
  // Sampled values follow the effect's easing: translateX grows between the edges.
  const tx = (v) => Number((/matrix\([^,]+,[^,]+,[^,]+,[^,]+,\s*([-\d.]+)/.exec(v.transform) || [])[1])
  expect(tx(a.to.values)).toBeGreaterThan(tx(a.from.values))
  expect(a.samples[7].geometry.page.x).toBeGreaterThan(a.samples[0].geometry.page.x)
  expect(n.asked).toBe(null)

  const text = await page.evaluate(() => window.__retakeDock.prompt(window.__retakeDock.state.notes.at(-1)))
  expect(text).toContain("local 200ms → 400ms of 2000ms")
  expect(text).toContain("Scope: change only local 200–400ms of this animation")
  expect(text).toContain("no keyframe inside the range")
  expect(text).toContain("How (WAAPI)")
  expect(text).toContain("The effect has one easing (ease-in-out)")
  // The exact edit: plain-time offsets with the edges as keyframes, the effect's easing moved into them.
  expect(text).toContain("Exact edit (element.animate)")
  expect(text).toMatch(/\{ offset: 0\.1, transform: "translate\([\d.]+px, 0px\)", easing: "[^"]+" \}, \/\/ ← range start, local 200ms/)
  expect(text).toContain('easing: "linear", fill: "none" }')
  // The note's pin carries a bracket to the end of its range on the lane.
  await expect.poll(() => dock(page, (D) => D.scene.notes.length)).toBe(1)
  expect(h.dockErrors).toEqual([])
})

test("Shift+drag on the track, then ⌘-click a still element: a range note in recording time", async ({ page }) => {
  const { h, rise } = await recordAnims(page, URL)
  const s = await h.state()
  const from = rise.start + 100
  const to = rise.start + 600
  const x0 = await dock(page, (D, t) => {
    const r = document.querySelector(".lines").getBoundingClientRect()
    return { x: r.left + 12 + ((t - D.view.from) / (D.view.to - D.view.from)) * (r.width - 30), y: r.top + D.lanes.get(D.activeId).y }
  }, from)
  const x1 = await dock(page, (D, t) => {
    const r = document.querySelector(".lines").getBoundingClientRect()
    return r.left + 12 + ((t - D.view.from) / (D.view.to - D.view.from)) * (r.width - 30)
  }, to)
  await page.keyboard.down("Shift")
  await page.mouse.move(x0.x, x0.y)
  await page.mouse.down()
  await page.mouse.move(x1, x0.y, { steps: 6 })
  await page.mouse.up()
  await page.keyboard.up("Shift")
  await expect.poll(() => dock(page, (D) => !!D.range)).toBe(true)
  const r = await dock(page, (D) => D.range)
  expect(Math.abs(r.from - from)).toBeLessThan(40)
  expect(Math.abs(r.to - to)).toBeLessThan(40)
  await page.waitForTimeout(400)
  await metaClick(h, ".still")
  expect(await dock(page, (D) => !!D.range)).toBe(false)
  const ta = page.locator("#wb-note textarea")
  await ta.fill("Fade this in over this stretch")
  await ta.press("Enter")
  const n = await lastNote(page)
  expect(n.range).toBeTruthy()
  expect(n.anims).toEqual([])
  const text = await page.evaluate(() => window.__retakeDock.prompt(window.__retakeDock.state.notes.at(-1)))
  expect(text).toContain("Nothing animates on this element in this range.")
  expect(text).toMatch(/Moment: 00:0\d\.\d\d → 00:0\d\.\d\d into the recording/)
  expect(s.started).toBe(true)
})

test("typed numbers: “between 200 and 400 ms” on the ticker reads as its own time", async ({ page }) => {
  const { h, ticker } = await recordAnims(page, URL)
  await h.seek(ticker.start + 200 + 300)
  await metaClick(h, ".ticker")
  const ta = page.locator("#wb-note textarea")
  await ta.fill("between 200 and 400 ms slow it down")
  await expect(page.locator("#wb-note .note-asked")).toContainText(`Reads "between 200 and 400 ms" as transform's own time (after its 200ms delay)`)
  // Clicking the chip switches to recording time, and back.
  await page.locator("#wb-note .note-asked").click()
  await expect(page.locator("#wb-note .note-asked")).toContainText("recording time from the note's moment")
  await page.locator("#wb-note .note-asked").click()
  await ta.press("Enter")
  const n = await lastNote(page)
  expect(n.asked).toMatchObject({ reading: "local", from: 200, to: 400 })
  expect(n.anims[0].at).toBeTruthy()
  const text = await page.evaluate(() => window.__retakeDock.prompt(window.__retakeDock.state.notes.at(-1)))
  expect(text).toContain(`Read "between 200 and 400 ms" as local time of clip ${ticker.id} (200–400ms).`)
})
