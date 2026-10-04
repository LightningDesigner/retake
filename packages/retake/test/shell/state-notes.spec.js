// Notes on states, presses and media (the anim-app fixture's states.html):
// - F143: a hover that starts several effects (border color, shadow, a glow on
//   ::before and ::after): each clip says what started it, and the note groups
//   the effects of that one trigger as the hover state.
// - F144: a press (:active) is over before a pause can keep it: with nothing
//   running at the note's moment, the note lists what ran last on the element
//   and inside it, newest first, with what started each; a moment inside the
//   press gets the press's transition.
// - F146: motion that is a <video>: the note describes the media (source, time,
//   duration, loop, playbackRate).
// Port 3359.
import { test, expect } from "@playwright/test"
import { dock, openDock } from "./helpers.js"
import { serveAnimApp, metaClick } from "./anim-fixture.js"

const PORT = 3359
const URL = `http://localhost:${PORT}/states.html`
let server
test.beforeAll(async () => {
  server = await serveAnimApp(PORT)
})
test.afterAll(async () => {
  await server?.close()
})

const lastNote = (page) => dock(page, (D) => JSON.parse(JSON.stringify(D.notes.at(-1), (k, v) => (k === "el" ? undefined : v))))
const promptOfLast = (page) => page.evaluate(() => window.__retakeDock.prompt(window.__retakeDock.state.notes.at(-1)))
async function save(page, text) {
  await page.waitForTimeout(200)
  const ta = page.locator("#wb-note textarea")
  await ta.fill(text)
  await ta.press("Enter")
  await expect(page.locator("#wb-note")).toBeHidden()
}
// The centre of an element in the app, on the page.
async function centre(h, sel) {
  const b = await h.box(sel)
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 }
}

test("F143: a hover's effects are one hover state: each says it was started by :hover, the note lists all four", async ({ page }) => {
  const h = await openDock(page, URL)
  await h.record()
  await page.waitForTimeout(300)
  const c = await centre(h, ".card")
  await page.mouse.move(c.x - 200, c.y)
  await page.mouse.move(c.x, c.y, { steps: 4 })
  await page.waitForTimeout(700)
  await h.pause()
  await page.waitForTimeout(300)
  const tl = await h.rt(() => __retake.timeline())
  const hovered = tl.clips.filter((x) => /card/.test(x.selector || ""))
  expect(hovered.length).toBe(4)
  for (const x of hovered) expect(x.trigger && x.trigger.kind).toBe("hover")
  await metaClick(h, ".card")
  await save(page, "feels off here")
  const n = await lastNote(page)
  expect(n.anims[0].trigger.kind).toBe("hover")
  expect(n.state.trigger.kind).toBe("hover")
  expect(n.state.effects.map((e) => `${e.name}${e.pseudo || ""}`).sort()).toEqual(["border-bottom-color transition", "box-shadow transition", "opacity transition::after", "opacity transition::before"])
  const text = await promptOfLast(page)
  expect(text).toContain("started by :hover on a.card")
  expect(text).toMatch(/Hover state: started by :hover on a\.card at .*it started 4 effects together/)
  expect(text).toContain("opacity transition 300ms on this element's ::before")
  expect(text).toContain("Read the note as about this whole hover")
  expect(h.dockErrors).toEqual([])
})

test("F144: after a press, a note with nothing running lists the press (newest first, with its trigger); a moment inside the press gets it", async ({ page }) => {
  const h = await openDock(page, URL)
  await h.record()
  await page.waitForTimeout(300)
  const p = await centre(h, ".press")
  await page.mouse.move(p.x, p.y)
  await page.mouse.down()
  await page.waitForTimeout(250)
  await page.mouse.up()
  await page.waitForTimeout(800)
  await h.pause()
  await page.waitForTimeout(300)
  const tl = await h.rt(() => __retake.timeline())
  const press = tl.clips.find((x) => x.trigger && x.trigger.kind === "press" && /press/.test(x.selector || ""))
  expect(press && press.property).toBe("transform")
  await metaClick(h, ".press")
  await save(page, "less bouncy")
  const n = await lastNote(page)
  expect(n.recent.length).toBeGreaterThanOrEqual(2)
  expect(n.recent[0].start).toBeGreaterThan(n.recent[1].start)
  expect(n.recent.map((e) => e.trigger && e.trigger.kind)).toContain("press")
  const text = await promptOfLast(page)
  expect(text).toContain("Recent animations on it and inside it (nothing runs at this moment; newest first):")
  expect(text).toMatch(/pressed at \d\d:\d\d\.\d\d → transform transition 150ms on this element/)
  expect(text).toMatch(/clicked at .* → transform transition/)
  // Back inside the press: the note is about it.
  await page.keyboard.press("Escape")
  await h.seek(press.start + 70)
  await page.waitForTimeout(300)
  await metaClick(h, ".press")
  await save(page, "less bouncy here")
  const m = await lastNote(page)
  expect(m.anims[0].name).toBe("transform transition")
  expect(m.anims[0].trigger.kind).toBe("press")
  expect(await promptOfLast(page)).toContain("started by a press on button.press (:active)")
  expect(h.dockErrors).toEqual([])
})

test("F146: a note on a footer whose motion is a video describes the video: source, time, duration, loop, playbackRate", async ({ page }) => {
  const h = await openDock(page, URL)
  await h.record()
  await page.waitForTimeout(1300)
  await h.pause()
  await page.waitForTimeout(300)
  await metaClick(h, ".foot-text")
  await save(page, "make this calmer")
  const n = await lastNote(page)
  expect(n.media.length).toBe(1)
  const v = n.media[0]
  expect(v.label).toBe("<video.clouds>")
  expect(v.where).toBe("under the point")
  expect(v.src).toBe("/clouds.webm")
  expect(v.duration).toBeCloseTo(2, 0)
  expect(v.currentTime).toBeGreaterThan(0)
  expect(v.loop).toBe(true)
  expect(v.playbackRate).toBe(1)
  const text = await promptOfLast(page)
  expect(text).toContain("No CSS or JS animation runs on this element at this moment; what moves here is media (below).")
  expect(text).toMatch(/Media: <video\.clouds> \(under the point\).*src \/clouds\.webm, at [\d.]+s of 2s, loop, playbackRate 1, playing, muted, autoplay/)
  expect(text).toContain("set playbackRate")
  expect(h.dockErrors).toEqual([])
})
