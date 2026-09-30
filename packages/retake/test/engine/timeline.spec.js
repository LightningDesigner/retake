// timeline() / clipAt() / isInteractive() / setToolActive() and the
// interaction model (CONTRACT.md).
import { test, expect } from "@playwright/test"
import { openDock, pick } from "./helpers.js"
import { PORTS } from "./servers.js"
const URL_ = `http://localhost:${PORTS.probe}/`

test("recording is on from page load", async ({ page }) => {
  const h = await openDock(page, URL_)
  const s = await h.state()
  expect(s.started).toBe(true)
  expect(s.recording).toBe(true)
})

test("timeline() has markers for what you did and clips for what animated", async ({ page }) => {
  const h = await openDock(page, URL_)
  await page.waitForTimeout(300)
  await h.click("#go")
  await page.waitForTimeout(600)
  await h.click("#q")
  await page.keyboard.type("abc")
  await page.waitForTimeout(200)
  await h.click("#out") // focus off the field, then a bare key
  await page.keyboard.press("k")
  await page.waitForTimeout(300)
  const tl = await h.rt(() => __wayback.timeline())
  expect(tl.viewport).toEqual(await h.rt(() => ({ w: innerWidth, h: innerHeight })))
  expect(tl.end).toBeGreaterThanOrEqual(tl.now)
  const kinds = (k) => tl.markers.filter((m) => m.kind === k)
  expect(kinds("click").find((m) => m.selector === "#go")).toMatchObject({ label: "Go" })
  expect(kinds("input")).toHaveLength(1) // one burst of typing is one marker
  expect(kinds("input")[0].selector).toBe("#q")
  expect(kinds("key").map((m) => m.label)).toEqual(["k"])
  expect(kinds("fetch").map((m) => m.label)).toContain("GET /api/json?c=1")
  expect(tl.markers.map((m) => m.t)).toEqual([...tl.markers.map((m) => m.t)].sort((a, b) => a - b))

  const tr = tl.clips.find((c) => c.kind === "transition")
  expect(tr).toMatchObject({ selector: "#box", property: "transform" })
  expect(tr.end - tr.start).toBeCloseTo(400, -1)
  const wa = tl.clips.find((c) => c.kind === "waapi")
  expect(wa).toMatchObject({ selector: "#box", property: "opacity" })
  expect(wa.end - wa.start).toBeCloseTo(300, -1)
  expect(new Set(tl.clips.map((c) => c.id)).size).toBe(tl.clips.length)

  const at = await h.rt((t) => __wayback.clipAt(t, "#box"), tr.start + 350)
  expect(at.clip.id).toBe(tr.id)
  expect(at.offset).toBeCloseTo(350, 0)
  expect(await h.rt((t) => __wayback.clipAt(t), tr.start - 50)).toBeNull()
  // the recording carries the viewport for rebuilds (F18)
  expect((await h.rt(() => __wayback.history())).viewport).toEqual(tl.viewport)
})

test("the past is view-only; the live edge is live", async ({ page }) => {
  const h = await openDock(page, URL_)
  await page.waitForTimeout(1200)
  expect(await h.rt(() => __wayback.isInteractive())).toBe(true)
  await h.pause()
  await h.seek(300)
  expect(await h.rt(() => __wayback.isInteractive())).toBe(false)
  await h.click("#go")
  await page.waitForTimeout(200)
  expect(pick(await h.log(), "click-random")).toEqual([]) // blocked
  // + makes a new timeline here, and the app is live from there
  await h.rt(() => __wayback.forkHere())
  const why = await h.rt(() => ({ i: __wayback.isInteractive(), ...__wayback.state(), rebuilding: parent.__waybackShell.rebuilding }))
  expect(why).toMatchObject({ i: true })
  await page.waitForTimeout(100)
  await h.click("#go")
  await page.waitForTimeout(300)
  const s = await h.state()
  expect(s.playing).toBe(true) // acting at the live edge resumes recording
  expect(pick(await h.log(), "click-random")).toHaveLength(1)
})

test("acting while paused at the live edge is recorded", async ({ page }) => {
  const h = await openDock(page, URL_)
  await page.waitForTimeout(500)
  await h.pause()
  await h.click("#go")
  await page.waitForTimeout(500)
  await h.pause()
  const liveClicks = pick(await h.log(), "click-random")
  expect(liveClicks).toHaveLength(1)
  const T = (await h.state()).now
  await h.seek(T - 1)
  expect(pick(await h.log(), "click-random")).toEqual(liveClicks)
})

test("setToolActive stops the app from seeing input", async ({ page }) => {
  const h = await openDock(page, URL_)
  await h.rt(() => __wayback.setToolActive(true))
  expect(await h.rt(() => __wayback.isInteractive())).toBe(false)
  await h.click("#go")
  await page.waitForTimeout(200)
  expect(pick(await h.log(), "click-random")).toEqual([])
  await h.rt(() => __wayback.setToolActive(false))
  await page.waitForTimeout(100) // the dock lifts its shield on the next frame
  await h.click("#go")
  await page.waitForTimeout(200)
  expect(pick(await h.log(), "click-random")).toHaveLength(1)
})

test("route changes are markers", async ({ page }) => {
  const h = await openDock(page, `http://localhost:${PORTS.react}/`)
  await page.waitForTimeout(300)
  await h.click("#nav-anim")
  await page.waitForTimeout(200)
  await h.click("#nav-about")
  await page.waitForTimeout(200)
  const routes = (await h.rt(() => __wayback.timeline())).markers.filter((m) => m.kind === "route").map((m) => m.label)
  expect(routes).toEqual(expect.arrayContaining(["/anim", "/about"]))
})
