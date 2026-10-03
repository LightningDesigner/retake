// Element-centric animation tracks: ⌘-clicking an element gives it a row on
// the track with its own clips; opening one shows its own clock (a local ruler
// from 0 at the end of its delay, keyframe ticks, the delay hatched), where the
// playhead is on it (the hint), and the path it moves the element along (on
// the app). A click on it pins the note at that local time. Port 3356.
import { test, expect } from "@playwright/test"
import { dock, shot, openDock } from "./helpers.js"
import { serveAnimApp, recordAnims, metaClick, rowPoint, openCapsule, activeStartOf } from "./anim-fixture.js"

const PORT = 3356
const URL = `http://localhost:${PORT}/`
let server
test.beforeAll(async () => {
  server = await serveAnimApp(PORT)
})
test.afterAll(async () => {
  await server?.close()
})

test("⌘-click a word: its row shows rise; opening it shows its own clock, ticks, readout and path", async ({ page }) => {
  const { h, rise } = await recordAnims(page, URL)
  expect(rise).toBeTruthy()
  // Nothing focused: no row.
  expect(await dock(page, (D) => !!(D.scene && D.scene.focus))).toBe(false)
  await h.seek(rise.start + 300 + 400)
  await metaClick(h, ".word")
  await expect.poll(() => dock(page, (D) => D.scene.focus && D.scene.focus.capsules.map((c) => c.clip.label))).toContain("rise")
  expect(await dock(page, (D) => D.focus.label)).toBe("<span.word>")

  await openCapsule(h, rise.id)
  const f = await dock(page, (D) => D.scene.focus)
  expect(f.ruler[0]).toBe("0")
  expect(f.ruler).toContain("1.2s")
  expect(f.ticks.map((k) => k.offset)).toEqual([0, 0.4, 0.7, 1])
  expect(f.delay).toBeTruthy()
  // Each tick where its keyframe is reached: activeStart + offset × 1200 (the effect's easing is linear).
  const a0 = await activeStartOf(page)
  expect(a0).toBeCloseTo(rise.start + 300, 0)
  for (const k of f.ticks) {
    const want = await rowPoint(page, a0 + k.offset * 1200)
    const r = await page.locator(".lines").boundingBox()
    expect(Math.abs(r.x + k.x - want.x)).toBeLessThanOrEqual(2)
  }
  // The delay is 300ms wide on the track.
  const d0 = await rowPoint(page, rise.start)
  const d1 = await rowPoint(page, a0)
  const r = await page.locator(".lines").boundingBox()
  expect(Math.abs(r.x + f.delay.x0 - d0.x)).toBeLessThanOrEqual(2)
  expect(Math.abs(r.x + f.delay.x1 - d1.x)).toBeLessThanOrEqual(2)

  // A click at local 100: the note is pinned there, the hint reads it.
  const p = await rowPoint(page, a0 + 100)
  await page.mouse.click(p.x, p.y)
  await expect(page.locator(".hint")).toContainText("100ms of 1200")
  await expect(page.locator(".hint")).toContainText("8%")
  await expect(page.locator("#wb-note .note-at")).toContainText(/^at 100ms \(8%\) of rise on <span\.word>/)
  // The path on the app: the samples of where it moves the word.
  await expect.poll(() => page.locator("#wb-path").getAttribute("data-points").then(Number)).toBeGreaterThanOrEqual(2)
  await expect(page.locator("#wb-path")).toBeVisible()
  await shot(page, "anim-track-open.png")

  // Esc closes the clip (the element stays focused), Esc again the note.
  await page.keyboard.press("Escape")
  await expect.poll(() => dock(page, (D) => !!(D.focus && !D.focus.open))).toBe(true)
  await expect(page.locator("#wb-path")).toBeHidden()
  await page.keyboard.press("Escape")
  await expect(page.locator("#wb-note")).toBeHidden()
  await expect.poll(() => dock(page, (D) => !!(D.scene && D.scene.focus))).toBe(false)
  expect(h.dockErrors).toEqual([])
})

test("frame note: a click at local 100 saves the point, its segment, values and box", async ({ page }) => {
  const { h, rise } = await recordAnims(page, URL)
  await h.seek(rise.start + 300 + 400)
  await metaClick(h, ".word")
  await openCapsule(h, rise.id)
  const a0 = await activeStartOf(page)
  const p = await rowPoint(page, a0 + 100)
  await page.mouse.click(p.x, p.y)
  await expect(page.locator("#wb-note .note-at")).toContainText(/at 100ms \(\d+%\) of/)
  await page.waitForTimeout(300)
  const ta = page.locator("#wb-note textarea")
  await ta.fill("Pop it here")
  await ta.press("Enter")
  await expect(page.locator("#wb-note")).toBeHidden()
  const n = await dock(page, (D) => JSON.parse(JSON.stringify(D.notes[D.notes.length - 1], (k, v) => (k === "el" ? undefined : v))))
  expect(n.anims[0].name).toBe("rise")
  expect(n.anims[0].primary).toBe(true)
  expect(Math.abs(n.anims[0].at.local - 100)).toBeLessThanOrEqual(17)
  expect(n.anims[0].at.segment).toMatchObject({ index: 0, fromOffset: 0, toOffset: 0.4, easing: "ease-out" })
  expect(n.anims[0].keyframes).toHaveLength(4)
  expect(n.anims[0].timing).toMatchObject({ delay: 300, duration: 1200 })
  expect(Number(n.anims[0].at.values.opacity)).toBeGreaterThan(0)
  expect(Number(n.anims[0].at.values.opacity)).toBeLessThan(0.6)
  expect(n.anims[0].at.frame.before).toBeTruthy()
  expect(n.target.geometry.page.w).toBeGreaterThan(10)
  expect(n.target.matches).toBeGreaterThanOrEqual(1)
  expect(JSON.stringify(n).length).toBeLessThan(12000)
  const text = await page.evaluate(() => window.__retakeDock.prompt(window.__retakeDock.state.notes.at(-1)))
  expect(text).toContain("Animation: @keyframes rise on this element")
  expect(text).toMatch(/At: local 1\d\dms of 1200ms|At: local 9\dms of 1200ms/)
  expect(text).toContain("segment 0 → 0.4 (ease-out)")
  expect(text).toContain("Selector: ")
  // Both words run @keyframes rise: the note says so, and the exact edit gives this one its own copy.
  expect(text).toMatch(/shared: the same @keyframes rise also runs on 1 other element \(span\.word/)
  expect(text).toMatch(/Exact edit: .*Add these as @keyframes rise-\w+ and point only this element at it/)
  expect(text).toMatch(/← the note's point, local \d+ms/)
  expect(h.dockErrors).toEqual([])
})

test("a still element: the row says nothing animates and lists what's inside", async ({ page }) => {
  const { h, rise } = await recordAnims(page, URL)
  await h.seek(rise.start + 300 + 400)
  await metaClick(h, ".hero", { x: 0.97, y: 0.5 })
  const f = await dock(page, (D) => ({ empty: D.scene.focus.empty, insides: D.scene.focus.insides.length, label: D.focus.label }))
  expect(f.label).toBe("<div.hero>")
  expect(f.empty).toBe(true)
  expect(f.insides).toBeGreaterThanOrEqual(1)
  const ta = page.locator("#wb-note textarea")
  await ta.fill("Space these out")
  await ta.press("Enter")
  const text = await page.evaluate(() => window.__retakeDock.prompt(window.__retakeDock.state.notes.at(-1)))
  expect(text).toContain("Nothing animates on this element at this moment.")
  expect(text).toMatch(/Also inside the element \(not this note's subject\): rise on /)
})

test("screens: an open clip at 1440 and 390 wide, the head row unchanged, no sideways scroll", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const { h, ticker } = await recordAnims(page, URL)
  const head0 = await page.locator("#wb-dock .head").boundingBox()
  await h.seek(ticker.start + 200 + 300)
  await metaClick(h, ".ticker")
  await openCapsule(h, ticker.id)
  const head1 = await page.locator("#wb-dock .head").boundingBox()
  expect(head1).toEqual(head0)
  await shot(page, "anim-track-1440.png")
  await page.setViewportSize({ width: 390, height: 800 })
  await page.waitForTimeout(400)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await shot(page, "anim-track-390.png")
})

// Two transitions started together (transform and opacity on the pill): their
// capsules stack on the element's row, so each can be opened. Going to a point
// on the open clip can swap in a new frame; the note still describes the
// element (found again in the frame on show). The @keyframes line comes from the
// <link>ed stylesheet as served (style.css:7), not from Vite's JS wrapper.
test("overlapping clips stack on the row; a note after the frame swaps still has its animation", async ({ page }) => {
  const h = await openDock(page, URL)
  await h.record()
  await page.waitForTimeout(300)
  await h.click("#pop")
  await page.waitForTimeout(300)
  await h.click("#go")
  await page.waitForTimeout(1900)
  await h.pause()
  await page.waitForTimeout(300)
  const tl = await h.rt(() => __retake.timeline())
  const rise = tl.clips.find((c) => c.label === "rise")
  const tr = tl.clips.filter((c) => c.kind === "transition" && /pill/.test(c.selector))
  expect(tr.map((c) => c.property).sort()).toEqual(["opacity", "transform"])
  const opacity = tr.find((c) => c.property === "opacity")
  await h.seek(opacity.start + 300)
  await metaClick(h, ".pill")
  const caps = await dock(page, (D) => D.scene.focus.capsules.map((c) => ({ id: c.clip.id, y: c.y })))
  expect(caps).toHaveLength(2)
  expect(caps[0].y).not.toBe(caps[1].y)
  // Hovering a capsule names it in the hint.
  const pos = await dock(page, (D, id) => {
    const r = document.querySelector(".lines").getBoundingClientRect()
    const c = D.scene.focus.capsules.find((x) => x.clip.id === id)
    return { x: r.left + Math.max(c.x0 + 3, Math.min((c.x0 + c.x1) / 2, r.width - 40)), y: r.top + c.y }
  }, opacity.id)
  await page.mouse.move(pos.x, pos.y)
  await expect(page.locator(".hint")).toContainText("opacity transition")
  await page.mouse.click(pos.x, pos.y)
  await page.waitForFunction(() => window.__retakeDock.state.scene.focus && window.__retakeDock.state.scene.focus.open)
  expect(await dock(page, (D) => D.focus.open.clip.property)).toBe("opacity")
  await page.waitForTimeout(500)
  const a0 = await activeStartOf(page)
  // Back from the moment on show: a new frame is built and swapped in.
  const p = await rowPoint(page, a0 + 150)
  await page.mouse.click(p.x, p.y)
  await page.waitForTimeout(400)
  // As after a frame swap: the focused element is a node of a document no longer on show
  // (its window gone). The note finds it again in the frame on show.
  await dock(page, (D) => {
    const old = document.implementation.createHTMLDocument("gone")
    D.focus.el = old.importNode(D.focus.el, true)
    old.body.appendChild(D.focus.el)
  })
  const ta = page.locator("#wb-note textarea")
  await ta.fill("Fade in sooner")
  await ta.press("Enter")
  const n = await dock(page, (D) => JSON.parse(JSON.stringify(D.notes.at(-1), (k, v) => (k === "el" ? undefined : v))))
  expect(n.anims[0].name).toBe("opacity transition")
  expect(Math.abs(n.anims[0].at.local - 150)).toBeLessThanOrEqual(17)
  expect(Number(n.anims[0].at.values.opacity)).toBeGreaterThan(0.2)
  expect(n.target.geometry.page.w).toBeGreaterThan(10)
  const text = await page.evaluate(() => window.__retakeDock.prompt(window.__retakeDock.state.notes.at(-1)))
  expect(text).toContain("Exact edit (CSS transition)")
  expect(text).toMatch(/opacity 400ms linear\(0 0%, .*\)/)
  // The rise clip's source line, from the linked stylesheet as served.
  await h.seek(rise.start + 300 + 400)
  await metaClick(h, ".word")
  await openCapsule(h, rise.id)
  await expect.poll(() => dock(page, (D) => D.focus.open.model.defined)).toMatchObject({ file: "style.css", line: 7 })
  expect(h.dockErrors).toEqual([])
})
