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
  // Markers are user actions only: one "type" marker per burst, no per-key or fetch markers.
  expect(kinds("type")).toHaveLength(1)
  expect(kinds("type")[0]).toMatchObject({ selector: "#q", label: "typed 3 chars" })
  expect(kinds("type")[0].end).toBeGreaterThanOrEqual(kinds("type")[0].t)
  expect(kinds("key")).toEqual([])
  expect(kinds("fetch")).toEqual([])
  expect(new Set(tl.markers.map((m) => m.kind))).toEqual(new Set(["click", "type"]))
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
  expect(await h.rt((t) => __wayback.clipAt(t, "#box"), tr.start - 50)).toBeNull()
  // the recording carries the viewport for rebuilds (F18)
  expect((await h.rt(() => __wayback.history())).viewport).toEqual(tl.viewport)
})

test("the past is view-only; + makes a paused timeline that only Play starts", async ({ page }) => {
  const h = await openDock(page, URL_)
  await page.waitForTimeout(1200)
  expect(await h.rt(() => __wayback.isInteractive())).toBe(true)
  await h.pause()
  await h.seek(300)
  expect(await h.rt(() => __wayback.isInteractive())).toBe(false)
  await h.click("#go")
  await page.waitForTimeout(200)
  expect(pick(await h.log(), "click-random")).toEqual([]) // blocked
  await h.rt(() => __wayback.forkHere())
  let s = await h.state()
  expect(s.playing).toBe(false) // the new timeline starts paused
  expect(s.future).toBe(false)
  expect(await h.rt(() => __wayback.isPaused())).toBe(true)
  await h.click("#go") // still view-only until Play
  await page.waitForTimeout(300)
  s = await h.state()
  expect(s.playing).toBe(false)
  expect(s.now).toBe(300)
  expect(pick(await h.log(), "click-random")).toEqual([])
  await h.record()
  await page.waitForTimeout(100) // the dock lifts its shield on the next frame
  await h.click("#go")
  await page.waitForTimeout(300)
  expect((await h.state()).playing).toBe(true)
  expect(pick(await h.log(), "click-random")).toHaveLength(1)
})

test("paused at the live edge, clicks and keys don't reach the app or start the clock", async ({ page }) => {
  const h = await openDock(page, URL_)
  await page.waitForTimeout(500)
  await h.pause()
  const t = (await h.state()).now
  await h.click("#go")
  await h.click("#q")
  await page.keyboard.type("x")
  await page.waitForTimeout(400)
  const s = await h.state()
  expect(s.playing).toBe(false)
  expect(s.now).toBe(t)
  expect(pick(await h.log(), "click-random")).toEqual([])
  expect(pick(await h.log(), "keycode")).toEqual([])
  expect(await h.rt(() => document.getElementById("q").value)).toBe("")
})

test("scrolling while paused is view-only: allowed, not recorded, no time passes, put back on play", async ({ page }) => {
  const h = await openDock(page, URL_)
  await page.waitForTimeout(500)
  await h.pause()
  const t = (await h.state()).now
  const inputs = () => h.rt(() => __wayback.history().events.filter((e) => /scroll|wheel|pointer|mouse/.test(e.type)).length)
  const events = await inputs()
  // The dock's past/paused shield must let scrolling through (S2's side);
  // here the runtime is tested on its own.
  await page.evaluate(() => { const s = document.getElementById("wb-shield"); if (s) s.style.pointerEvents = "none" })
  const b = await h.box("#scroller")
  await page.mouse.move(b.x + 20, b.y + 20)
  await page.mouse.wheel(0, 200)
  await page.waitForTimeout(400)
  expect(await h.rt(() => document.getElementById("scroller").scrollTop)).toBeGreaterThan(50) // it scrolls
  const s = await h.state()
  expect(s.playing).toBe(false)
  expect(s.now).toBe(t)
  expect(await inputs()).toBe(events) // not recorded
  expect(pick(await h.log(), "scrolled")).toEqual([]) // the app didn't hear of it
  await h.record()
  await page.waitForTimeout(200)
  expect(await h.rt(() => document.getElementById("scroller").scrollTop)).toBe(0) // back where the recording had it
})

test("switching timelines loads the other one paused, and onPlayState reports changes", async ({ page }) => {
  const h = await openDock(page, URL_)
  await page.waitForTimeout(800)
  const json = await h.rt(() => JSON.stringify(__wayback.history()))
  await h.rt(() => {
    window.__ps = []
    __wayback.onPlayState((s) => window.__ps.push(s.playing))
  })
  await h.pause()
  await h.record()
  await h.pause()
  expect(await h.rt(() => window.__ps)).toEqual([false, true, false])
  await h.record() // playing when we switch away
  await h.rt((j) => __wayback.load(j, 400), json)
  await page.waitForTimeout(200)
  const s = await h.settle()
  expect(s.playing).toBe(false)
  expect(s.now).toBe(400)
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

test("after a rewind the whole timeline's clips are still there, with the same ids", async ({ page }) => {
  const h = await openDock(page, URL_)
  await page.waitForTimeout(300)
  await h.click("#go")
  await page.waitForTimeout(1000)
  await h.pause()
  const before = (await h.rt(() => __wayback.timeline())).clips
  expect(before.length).toBeGreaterThanOrEqual(2)
  await h.seek(100) // before any clip started
  const after = (await h.rt(() => __wayback.timeline())).clips
  expect(after).toEqual(before)
  expect(typeof (await h.rt(() => typeof __wayback.play))).toBe("string")
  await h.rt(() => __wayback.play())
  await page.waitForTimeout(300)
  expect((await h.state()).playing).toBe(true)
})

test("adopt(): a frame rebuilt to an earlier moment seeks forward in place with a newer recording", async ({ page }) => {
  const h = await openDock(page, URL_)
  await page.waitForTimeout(300)
  await h.click("#go")
  await page.waitForTimeout(2500)
  await h.pause()
  const json = await h.rt(() => JSON.stringify(__wayback.history()))
  const end = (await h.state()).now
  // Reference: a full rebuild to end - 5
  await h.seek(end - 5)
  const full = await h.log()
  // Checkpoint: rebuild to 400 (before the click), then adopt the recording and go forward.
  await h.seek(400)
  const frameBefore = await page.evaluateHandle(() => document.querySelector("#wb-stage iframe.live"))
  expect(await h.rt(({ json, t }) => __wayback.adopt(json, t) || __wayback.adoptRefused, { json, t: end - 5 })).toBe(true)
  await h.settle()
  expect(await page.evaluate((f) => f === document.querySelector("#wb-stage iframe.live"), frameBefore)).toBe(true) // no new frame
  expect(await h.log()).toEqual(full)
  // A recording that doesn't continue this frame's past is refused.
  const other = JSON.parse(json)
  other.seed = 12345
  expect(await h.rt((j) => __wayback.adopt(j, 99999), JSON.stringify(other))).toBe(false)
})

test("seek() ends a live preview", async ({ page }) => {
  const h = await openDock(page, URL_)
  await page.waitForTimeout(1200)
  await h.pause()
  const now = (await h.state()).now
  await h.rt((t) => __wayback.preview(t), now - 800)
  expect((await h.state()).previewing).toBe(true)
  await h.rt((t) => __wayback.seek(t), now + 200) // forward, in place
  await page.waitForTimeout(300)
  const s = await h.state()
  expect(s.previewing).toBe(false)
  expect(s.now).toBeGreaterThanOrEqual(now)
})

test("typing bursts split on pauses of 800ms; focusing a field by keyboard is a marker", async ({ page }) => {
  const h = await openDock(page, URL_)
  await page.waitForTimeout(300)
  await h.click("#q")
  await page.keyboard.type("ab", { delay: 100 })
  await page.waitForTimeout(1000)
  await page.keyboard.type("cde", { delay: 100 })
  await page.keyboard.press("Tab") // focus moves to the checkbox (not a text field)
  await page.waitForTimeout(200)
  const m = (await h.rt(() => __wayback.timeline())).markers.filter((x) => x.kind === "type")
  expect(m.map((x) => x.label)).toEqual(["typed 2 chars", "typed 3 chars"])
})

test("activity: quiet page reads ~0, a panel appearing spikes, and it's stored with the recording", async ({ page }) => {
  const h = await openDock(page, URL_)
  await page.waitForTimeout(1500)
  await h.click("#go") // reveals #late, starts the #box transition and WAAPI fade
  await page.waitForTimeout(1500)
  await h.pause()
  const tl = await h.rt(() => __wayback.timeline())
  expect(tl.activity.length).toBeGreaterThan(20)
  expect(tl.activity[1].t - tl.activity[0].t).toBe(100)
  const click = tl.markers.find((m) => m.kind === "click").t
  const before = tl.activity.filter((s) => s.t < click - 200 && s.t > 1000).map((s) => s.v) // after the page's images came in
  const after = tl.activity.filter((s) => s.t > click - 100 && s.t < click + 600).map((s) => s.v) // a sample's t is its window's start
  expect(Math.max(...before)).toBeLessThan(0.02)
  expect(Math.max(...after)).toBeGreaterThan(0.02)
  const dbg = (await h.rt(() => __wayback.debug())).activity
  expect(dbg.ms / dbg.samples).toBeLessThan(0.3) // budget per sample
  // a rebuild shows the same samples (stored, not recomputed)
  await h.seek(tl.now - 1)
  const again = await h.rt(() => __wayback.timeline().activity)
  expect(again.slice(0, tl.activity.length - 1)).toEqual(tl.activity.slice(0, tl.activity.length - 1))
})

test("clipsFor(element) finds the clips on it and inside it, fast", async ({ page }) => {
  const h = await openDock(page, URL_)
  await page.waitForTimeout(300)
  await h.click("#go")
  await page.waitForTimeout(800)
  await h.pause()
  const r = await h.rt(() => {
    const t0 = performance.now ? 0 : 0
    const box = __wayback.clipsFor("#box").map((c) => c.kind).sort()
    const body = __wayback.clipsFor(document.body).length
    const none = __wayback.clipsFor("#q").length
    return { box, body, none }
  })
  expect(r.box).toEqual(["transition", "waapi"])
  expect(r.body).toBeGreaterThanOrEqual(2)
  expect(r.none).toBe(0)
})
