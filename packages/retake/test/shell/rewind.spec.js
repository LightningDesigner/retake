// Going back without waiting (F31-F37). Letting go of a scrub keeps the moment
// on screen as a live preview while ONE hidden frame builds the real moment
// behind it; it swaps in when ready with nothing on screen moving. The user
// only waits (Building N%) if they ask for the real moment first (Play, +).
// Real mouse on the dock's track throughout.
import { test, expect } from "@playwright/test"
import { openDock, DOCK_URL, dock, recordSome, xOfTime } from "./helpers.js"

const fmt = (ms) => {
  const s = Math.max(0, ms) / 1000
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${(s % 60).toFixed(2).padStart(5, "0")}`
}
const visTop = (page) => dock(page, (D) => Math.round(D.frame.contentDocument.scrollingElement.scrollTop))
const phase = (page) => page.locator(".readout .phase")
const swapped = (page) => dock(page, (D) => !D.building && document.querySelectorAll("#wb-stage iframe:not(.checkpoint)").length === 1)
const landed = (page) =>
  dock(page, (D) => {
    try {
      const s = D.building && D.building.pt && D.building.pt.state()
      return !!s && s.booted && !s.seeking && s.target == null
    } catch {
      return false
    }
  })

// From now on, every dock frame: what the readout says, which frame is visible
// and what it shows, how many frames are being built. Also counts frames added.
async function watch(page) {
  await page.evaluate(() => {
    const W = (window.__watch = { samples: [], added: 0, upAt: null, stop: false })
    let id = 0
    const ids = new WeakMap()
    const idOf = (f) => (f ? ids.get(f) || (ids.set(f, ++id), id) : null)
    new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => n.tagName === "IFRAME" && !n.classList.contains("checkpoint") && W.added++))).observe(document.querySelector("#wb-stage"), { childList: true })
    addEventListener("pointerup", () => (W.upAt = performance.now()), true)
    const loop = () => {
      const D = window.__retakeDock.state
      let s = null
      let top = null
      try {
        s = D.PT.state()
        top = Math.round(D.frame.contentDocument.scrollingElement.scrollTop)
      } catch {}
      W.samples.push({
        at: performance.now(),
        phase: document.querySelector(".readout .phase").textContent,
        readout: document.querySelector(".readout .t").textContent,
        vis: idOf(D.frame),
        building: document.querySelectorAll("#wb-stage iframe.building").length,
        previewAt: s && s.previewing ? s.previewAt : null,
        now: s ? s.now : null,
        playing: s ? s.playing : null,
        top,
      })
      if (!W.stop) requestAnimationFrame(loop)
    }
    requestAnimationFrame(loop)
  })
}
const stopWatch = (page) => page.evaluate(() => ((window.__watch.stop = true), window.__watch))

// A real drag on an empty part of the track from time `from` to time `to`
// (alt held: no snapping). Returns the time the dock had at the release.
async function drag(page, from, to, { steps = 10, hold = 60, release = true, free = true } = {}) {
  const g = await page.locator(".lines").boundingBox()
  const y = g.y + g.height - 6
  const x0 = await xOfTime(page, from)
  const x1 = await xOfTime(page, to)
  if (free) await page.keyboard.down("Alt")
  await page.mouse.move(x0, y)
  await page.mouse.down()
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(x0 + ((x1 - x0) * i) / steps, y)
    await page.waitForTimeout(16)
  }
  await page.waitForTimeout(hold)
  const t = await dock(page, (D) => D.dragT)
  if (free) await page.keyboard.up("Alt")
  if (release) await page.mouse.up()
  return t
}

// A press and release (no drag) dx pixels from the playhead.
async function clickPlayhead(page, dx) {
  const g = await page.locator(".lines").boundingBox()
  const x = await dock(page, (D) => D.scene.playhead + document.querySelector(".lines").getBoundingClientRect().left)
  await page.mouse.click(Math.round(x) + dx, g.y + g.height - 6)
  await page.waitForTimeout(150)
}

test("F31: letting go of a scrub keeps the moment on screen; one hidden frame builds it and swaps in", async ({ page }) => {
  const h = await openDock(page, DOCK_URL)
  await recordSome(h, ["#toggle", "#toggle", "#toggle"])
  await h.pause()
  const s = await h.state()
  await watch(page)
  const t = await drag(page, s.now, s.start + (s.end - s.start) * 0.4)
  await expect.poll(() => swapped(page)).toBe(true)
  await page.waitForTimeout(100)
  const w = await stopWatch(page)
  const after = w.samples.filter((x) => x.at >= w.upAt)
  expect(after.length).toBeGreaterThan(2)
  // The readout shows the moment let go at, from the release on: never the live end.
  for (const x of after) expect(x.readout).toBe(fmt(t - s.start))
  for (const x of after) expect(["Scrubbing", "Paused"]).toContain(x.phase)
  // The old frame previews that moment until the new one swaps in, at that moment.
  const old = after[0].vis
  const before = after.filter((x) => x.vis === old)
  for (const x of before) expect(x.previewAt).toBe(t)
  const fresh = after.filter((x) => x.vis !== old)
  expect(fresh.length).toBeGreaterThan(0)
  for (const x of fresh) expect(Math.abs(x.now - t)).toBeLessThan(1)
  expect(w.added).toBe(1)
  expect(Math.max(...w.samples.map((x) => x.building))).toBe(1)
  expect(await dock(page, (D) => D.lastRebuild.via)).toBe("replay")
  expect(h.dockErrors).toEqual([])
})

test("F31: Play before the real moment is ready waits for it, then plays from that moment", async ({ page }) => {
  const h = await openDock(page, DOCK_URL)
  await recordSome(h, ["#toggle", "#toggle", "#toggle"])
  await h.pause()
  const s = await h.state()
  await dock(page, (D) => (D.holdSwap = true))
  const t = await drag(page, s.now, s.start + (s.end - s.start) * 0.4)
  await expect(phase(page)).toHaveText("Paused")
  await page.keyboard.press("Space")
  await expect(phase(page)).toHaveText(/^Building( \d+%)?$/)
  await expect(page.locator(".readout .t")).toHaveText(fmt(t - s.start))
  await watch(page)
  await dock(page, (D) => (D.holdSwap = false))
  await expect.poll(() => swapped(page)).toBe(true)
  await expect(phase(page)).toHaveText("Playing")
  await page.waitForTimeout(200)
  const w = await stopWatch(page)
  const old = w.samples[0].vis
  const first = w.samples.find((x) => x.vis !== old)
  expect(first.now).toBe(t)
  // Its first frame of play steps on from t, not from before the build (no time skipped).
  const moved = w.samples.find((x) => x.vis !== old && x.now > t)
  expect(moved.now - t).toBeLessThanOrEqual(50)
  expect(h.dockErrors).toEqual([])
})

test("F31: on a heavy page, Play pressed while the moment builds plays from that moment, not from a little after it", async ({ page }) => {
  const h = await openDock(page, DOCK_URL + "?busy")
  await recordSome(h, ["#toggle", "#toggle", "#toggle"])
  await h.pause()
  const s = await h.state()
  await watch(page)
  const t = await drag(page, s.now, s.start + (s.end - s.start) * 0.6)
  await page.keyboard.press("Space")
  await expect.poll(() => swapped(page)).toBe(true)
  await expect(phase(page)).toHaveText("Playing")
  await page.waitForTimeout(200)
  const w = await stopWatch(page)
  const replayMs = await dock(page, (D) => D.lastRebuild.seekMs)
  expect(replayMs).toBeGreaterThan(80) // long enough that a step from before the replay would show
  const old = w.samples[0].vis
  const first = w.samples.find((x) => x.vis !== old)
  expect(first.now).toBe(t)
  // Its first frame of play steps on from t, not from before the build (no time skipped).
  const moved = w.samples.find((x) => x.vis !== old && x.now > t)
  expect(moved.now - t).toBeLessThanOrEqual(50)
  expect(h.dockErrors).toEqual([])
})

test("+ before the real moment is ready forks there once it is", async ({ page }) => {
  const h = await openDock(page, DOCK_URL)
  await recordSome(h, ["#toggle", "#toggle", "#toggle"])
  await h.pause()
  const s = await h.state()
  await dock(page, (D) => (D.holdSwap = true))
  const t = await drag(page, s.now, s.start + (s.end - s.start) * 0.5)
  await page.keyboard.press("=")
  await expect(phase(page)).toHaveText(/^Building( \d+%)?$/)
  expect(await dock(page, (D) => D.branches.length)).toBe(1)
  await dock(page, (D) => (D.holdSwap = false))
  await expect.poll(() => dock(page, (D) => D.branches.length === 2 && !D.building)).toBe(true)
  const r = await dock(page, (D) => ({ forkAt: D.branches[1].forkAt, active: D.activeId, t1End: JSON.parse(D.branches[0].json).end }))
  expect(Math.abs(r.forkAt - t)).toBeLessThan(40)
  expect(r.active).toBe(2)
  expect(r.t1End).toBeGreaterThanOrEqual(s.end - 1) // Timeline 1 keeps its whole recording
  const st = await h.state()
  expect(st.playing).toBe(false)
  expect(st.future).toBe(false)
  expect(h.dockErrors).toEqual([])
})

test("F34: pressing the track again never stacks builds (playhead clicks, a tap, retargets, one frame at a time)", async ({ page }) => {
  const h = await openDock(page, DOCK_URL)
  await recordSome(h, ["#toggle", "#toggle", "#toggle", "#toggle"])
  await h.pause()
  const s = await h.state()
  const span = s.end - s.start
  await drag(page, s.now, s.start + span * 0.7)
  await expect.poll(() => swapped(page)).toBe(true)
  await watch(page)
  // On the playhead, a pixel left of it, a pixel right: already there, nothing to build.
  for (const dx of [0, -1, 1]) await clickPlayhead(page, dx)
  await expect.poll(() => swapped(page)).toBe(true)
  expect(await page.evaluate(() => window.__watch.added)).toBe(0)
  const calls = await dock(page, (D) => D.buildSeq)
  // A build that can't land yet: a tap on the same spot adds nothing.
  await dock(page, (D) => (D.holdSwap = true))
  const now1 = (await h.state()).now
  const t2 = await drag(page, now1, s.start + span * 0.4)
  await expect.poll(() => landed(page)).toBe(true)
  await clickPlayhead(page, 0)
  expect(await page.evaluate(() => window.__watch.added)).toBe(1)
  // A little further on: the same frame carries on there.
  const t3 = await drag(page, t2, t2 + span * 0.1)
  expect(t3).toBeGreaterThan(t2 + 20)
  expect(await dock(page, (D) => D.building && D.building.via)).toBe("retarget")
  expect(await page.evaluate(() => window.__watch.added)).toBe(1)
  await expect.poll(() => landed(page)).toBe(true)
  expect(await dock(page, (D) => Math.round(D.building.pt.state().now))).toBe(Math.round(t3))
  // Back before where it got to: replaced, never two at once.
  const t4 = await drag(page, t3, s.start + span * 0.2)
  expect(await page.evaluate(() => window.__watch.added)).toBe(2)
  await dock(page, (D) => (D.holdSwap = false))
  await expect.poll(() => swapped(page)).toBe(true)
  const w = await stopWatch(page)
  expect(Math.max(...w.samples.map((x) => x.building))).toBe(1)
  expect(Math.abs((await h.state()).now - t4)).toBeLessThan(1)
  expect(await dock(page, (D) => D.buildSeq)).toBe(calls + 2)
  expect(h.dockErrors).toEqual([])
})

test("F33: the view you scrolled to while paused stays when you go back; Play brings the recorded scroll back", async ({ page }) => {
  const h = await openDock(page, DOCK_URL + "?tall")
  await recordSome(h, ["#toggle", "#toggle"])
  await h.pause()
  await page.mouse.move(640, 300)
  await page.mouse.wheel(0, 1500)
  await expect.poll(() => visTop(page)).toBeGreaterThan(1400)
  await page.waitForTimeout(300)
  const top = await visTop(page)
  const s = await h.state()
  await watch(page)
  await drag(page, s.now, s.start + (s.end - s.start) * 0.5)
  await expect.poll(() => swapped(page)).toBe(true)
  await page.waitForTimeout(150)
  const w = await stopWatch(page)
  expect(new Set(w.samples.map((x) => x.vis)).size).toBe(2) // it did swap
  for (const x of w.samples) expect(Math.abs(x.top - top)).toBeLessThanOrEqual(2)
  await page.keyboard.press("Space")
  await expect.poll(() => visTop(page)).toBe(0)
  expect(h.dockErrors).toEqual([])
})

test("F33: going back shows the recorded scroll at that moment, and nothing moves at the swap", async ({ page }) => {
  const h = await openDock(page, DOCK_URL + "?tall")
  await recordSome(h, ["#toggle", "#toggle"])
  const before = (await h.state()).now
  await page.mouse.move(640, 300)
  await page.mouse.wheel(0, 1200) // recorded
  await page.waitForTimeout(700)
  await h.pause()
  const live = await visTop(page)
  expect(live).toBeGreaterThan(1000)
  const s = await h.state()
  await watch(page)
  const t = await drag(page, s.now, before - 300, { release: false })
  expect(await visTop(page)).toBe(0) // the preview has the scroll as it was then
  await page.mouse.up()
  await expect.poll(() => swapped(page)).toBe(true)
  await page.waitForTimeout(150)
  const w = await stopWatch(page)
  expect(new Set(w.samples.filter((x) => x.at >= w.upAt).map((x) => x.vis)).size).toBe(2)
  for (const x of w.samples.filter((x) => x.at >= w.upAt)) expect(x.top).toBe(0)
  expect(Math.abs((await h.state()).now - t)).toBeLessThan(1)
  // Forward again to the end: the recorded scroll comes back.
  await h.seek(s.end - 20)
  expect(Math.abs((await visTop(page)) - live)).toBeLessThanOrEqual(2)
  expect(h.dockErrors).toEqual([])
})

test("F32: smooth-scrolling apps land their recorded scroll (replay, and Play after looking around)", async ({ page }) => {
  const h = await openDock(page, DOCK_URL + "?tall&smooth")
  await page.waitForTimeout(300)
  await page.mouse.move(640, 300)
  await page.mouse.wheel(0, 1200) // recorded
  await page.waitForTimeout(900)
  await h.pause()
  const recorded = await visTop(page)
  expect(recorded).toBeGreaterThan(1000)
  const scrolls = () => h.rt(() => __retake.history().events.filter((e) => e.type === "scroll").length)
  const n = await scrolls()
  // Look around while paused, then Play: back where the recording is, at once, and not recorded again.
  await page.mouse.wheel(0, 700)
  await expect.poll(() => visTop(page)).toBeGreaterThan(recorded + 300)
  await page.waitForTimeout(400)
  await page.keyboard.press("Space")
  await expect.poll(() => visTop(page), { timeout: 2000 }).toBe(recorded)
  await page.waitForTimeout(400)
  await h.pause()
  expect(await scrolls()).toBe(n)
  // A rebuilt frame lands on the recorded scroll.
  const s = await h.state()
  await h.seek(s.end - 100)
  expect(await visTop(page)).toBe(recorded)
  expect(h.dockErrors).toEqual([])
})

test("F36: frames being built are invisible, and a build that focuses a field doesn't take Space from the dock", async ({ page }) => {
  const h = await openDock(page, DOCK_URL)
  await recordSome(h, ["#toggle"])
  await h.click("#q")
  await page.keyboard.type("hey")
  await page.waitForTimeout(400)
  await h.pause()
  const s = await h.state()
  await dock(page, (D) => (D.holdSwap = true))
  await drag(page, s.now, s.end - 120)
  await expect.poll(() => landed(page)).toBe(true)
  expect(await page.evaluate(() => getComputedStyle(document.querySelector("#wb-stage iframe.building")).opacity)).toBe("0")
  // The replay focused #q in the hidden frame, which takes the window's focus with it.
  await expect.poll(() => page.evaluate(() => document.activeElement === document.querySelector("#wb-stage iframe.building"))).toBe(true)
  await page.keyboard.press("Space")
  await expect(phase(page)).toHaveText(/^Building( \d+%)?$/)
  await page.keyboard.press("Space")
  await expect(phase(page)).toHaveText("Paused")
  // Nothing was typed into the field.
  expect(await dock(page, (D) => D.building.frame.contentDocument.querySelector("#q").value)).toBe("hey")
  await dock(page, (D) => (D.holdSwap = false))
  await expect.poll(() => swapped(page)).toBe(true)
  expect(h.dockErrors).toEqual([])
})

test("F36: a frame built behind that takes the window's focus gives it back to a note being written", async ({ page }) => {
  const h = await openDock(page, DOCK_URL)
  await recordSome(h, ["#toggle"])
  const before = (await h.state()).now
  await h.click("#q")
  await page.keyboard.type("abc")
  await page.waitForTimeout(400)
  await h.pause()
  const s = await h.state()
  await dock(page, (D) => (D.holdSwap = true))
  await drag(page, s.now, before - 50) // before the click on #q
  await expect.poll(() => landed(page)).toBe(true)
  // A note on the moment on show (⌘-click the card).
  await page.keyboard.down("Meta")
  const b = await h.box("#card")
  await page.mouse.move(b.x + b.w / 2, b.y + b.h / 2)
  await page.mouse.click(b.x + b.w / 2, b.y + b.h / 2)
  await page.keyboard.up("Meta")
  const ta = page.locator("#wb-note textarea")
  await expect(ta).toBeFocused()
  // The build goes on past the click on #q: its replay focuses that field in the hidden frame.
  await dock(page, (D, t) => D.building.pt.retarget(t), s.end - 100)
  await expect.poll(() => landed(page)).toBe(true)
  await expect(ta).toBeFocused()
  await page.keyboard.type("xyz")
  await expect(ta).toHaveValue("xyz")
  expect(await dock(page, (D) => D.building.frame.contentDocument.querySelector("#q").value)).toBe("abc")
  expect(h.dockErrors).toEqual([])
})

test("H5: a frame being built that reloads itself is built again, never swapped in", async ({ page }) => {
  const h = await openDock(page, DOCK_URL)
  await recordSome(h, ["#toggle", "#toggle", "#toggle"])
  await h.pause()
  const s = await h.state()
  const events = (await h.rt(() => __retake.history().events.length))
  await dock(page, (D) => (D.holdSwap = true))
  const t = await drag(page, s.now, s.start + (s.end - s.start) * 0.5)
  await expect.poll(() => landed(page)).toBe(true)
  const first = await dock(page, (D) => ((window.__first = D.building.frame), D.building.id))
  await dock(page, (D) => D.building.frame.contentWindow.location.reload())
  await expect.poll(() => dock(page, (D) => !!D.building && D.building.frame !== window.__first)).toBe(true)
  await expect.poll(() => landed(page)).toBe(true)
  expect(await dock(page, (D) => D.building.id)).toBe(first)
  await dock(page, (D) => (D.holdSwap = false))
  await expect.poll(() => swapped(page)).toBe(true)
  const st = await h.state()
  expect(Math.abs(st.now - t)).toBeLessThan(1)
  expect(await h.rt(() => __retake.history().events.length)).toBe(events)
  expect(await h.rt(() => (__retake.history().segments || []).length)).toBe(0)
  expect(h.dockErrors).toEqual([])
})

test("going to a moment while a switch to another timeline is still being built goes there on that timeline", async ({ page }) => {
  const h = await openDock(page, DOCK_URL)
  await recordSome(h, ["#toggle", "#toggle", "#toggle"])
  await h.pause()
  const s = await h.state()
  const clicks = () => h.rt(() => __retake.history().events.filter((e) => e.type === "click").length)
  expect(await clicks()).toBe(3)
  // Timeline 2 from the middle (fewer clicks), recorded on a little.
  await dock(page, (D, t) => window.__retakeDock.newTimelineAt(t), s.start + (s.end - s.start) * 0.5)
  await expect.poll(() => dock(page, (D) => D.activeId === 2 && !D.building)).toBe(true)
  await h.settle()
  await h.record()
  await page.waitForTimeout(600)
  await h.pause()
  expect(await clicks()).toBeLessThan(3)
  // Back to Timeline 1 (held behind), and while that builds, another moment on it.
  await dock(page, (D) => (D.holdSwap = true))
  await dock(page, (D, t) => window.__retakeDock.switchTo(1, t), s.start + (s.end - s.start) * 0.8)
  await expect.poll(() => dock(page, (D) => D.activeId === 1 && !!D.building)).toBe(true)
  const t2 = s.start + (s.end - s.start) * 0.3
  await dock(page, (D, t) => window.__retakeDock.goTo(t), t2)
  await dock(page, (D) => (D.holdSwap = false))
  await expect.poll(() => swapped(page)).toBe(true)
  expect(Math.abs((await h.state()).now - t2)).toBeLessThan(1)
  expect(await clicks()).toBe(3) // Timeline 1's recording, not the one that was on show
  expect(await dock(page, (D) => [D.activeId, D.frameBranch])).toEqual([1, 1])
  expect(h.dockErrors).toEqual([])
})

test("F35: a frame built behind doesn't leave its storage to the frame you go on with", async ({ page }) => {
  const h = await openDock(page, DOCK_URL + "?store")
  await recordSome(h, ["#toggle", "#toggle", "#toggle"])
  await h.pause()
  expect(await h.rt(() => localStorage.getItem("count"))).toBe("3")
  const s = await h.state()
  await dock(page, (D) => (window.__f0 = D.frame))
  await dock(page, (D) => (D.holdSwap = true))
  await drag(page, s.now, s.start + (s.end - s.start) * 0.4)
  await expect.poll(() => landed(page)).toBe(true)
  // The build put the storage back to the start and replayed some toggles.
  expect(await page.evaluate(() => localStorage.getItem("count"))).not.toBe("3")
  // Back to the end (the frame on screen is there: the build is dropped), and Play.
  await drag(page, s.start + (s.end - s.start) * 0.4, s.end + 50)
  await expect.poll(() => swapped(page)).toBe(true)
  expect(await dock(page, (D) => D.frame === window.__f0)).toBe(true) // never replayed
  await page.keyboard.press("Space")
  await expect(phase(page)).toHaveText("Live")
  expect(await h.rt(() => localStorage.getItem("count"))).toBe("3")
  expect(h.dockErrors).toEqual([])
})

test("a paused app doesn't hear the window resize; Play delivers one", async ({ page }) => {
  const h = await openDock(page, DOCK_URL)
  await recordSome(h, ["#toggle"])
  await h.pause()
  const r0 = await h.rt(() => window.__resizes)
  await page.setViewportSize({ width: 1100, height: 760 })
  await page.waitForTimeout(400)
  expect(await h.rt(() => window.__resizes)).toBe(r0)
  await page.keyboard.press("Space")
  await expect(phase(page)).toHaveText("Live")
  await expect.poll(() => h.rt(() => window.__resizes)).toBe(r0 + 1)
  await page.waitForTimeout(300)
  expect(await h.rt(() => window.__resizes)).toBe(r0 + 1)
  expect(h.dockErrors).toEqual([])
})

test("F38: after the app reloads itself (a Vite full reload), going back lands where the reloaded page was scrolled", async ({ page }) => {
  const h = await openDock(page, DOCK_URL + "?tall")
  await page.waitForTimeout(300)
  await page.mouse.move(640, 300)
  await page.mouse.wheel(0, 1500) // recorded
  await expect.poll(() => visTop(page)).toBeGreaterThan(1400)
  await page.waitForTimeout(400)
  const top = await visTop(page)
  // The frame reloads itself, as after an edit Vite can't swap in: the browser puts its scroll back.
  await dock(page, (D) => ((window.__pt0 = D.PT), D.frame.contentWindow.location.reload()))
  await expect
    .poll(() =>
      dock(page, (D) => {
        try {
          return D.PT !== window.__pt0 && D.PT.state().playing && (D.PT.history().segments || []).length === 1
        } catch {
          return false
        }
      }),
    )
    .toBe(true)
  await expect.poll(() => visTop(page)).toBe(top)
  // That's how the reloaded page starts: it's in the recording.
  const seg = await h.rt(() => __retake.history().segments[0].t)
  const tops = await h.rt((seg) => __retake.history().events.filter((e) => e.type === "scroll" && e.t >= seg).map((e) => e.top), seg)
  expect(tops[tops.length - 1]).toBe(top)
  await page.waitForTimeout(800)
  await h.pause()
  const s = await h.state()
  await watch(page)
  const t = await drag(page, s.now, seg + 300)
  await expect.poll(() => swapped(page)).toBe(true)
  await page.waitForTimeout(150)
  const w = await stopWatch(page)
  expect(new Set(w.samples.map((x) => x.vis)).size).toBe(2) // it did swap
  for (const x of w.samples) expect(x.top).toBe(top)
  expect(Math.abs((await h.state()).now - t)).toBeLessThan(1)
  expect(h.dockErrors).toEqual([])
})

test("F39: the preview shows a transition as it was then, not the start of a later one on the same property", async ({ page }) => {
  const h = await openDock(page, DOCK_URL)
  await page.waitForTimeout(300)
  await h.click("#toggle")
  await page.waitForTimeout(1200)
  await h.click("#toggle") // the card's opacity and transform transition again, later
  await page.waitForTimeout(900)
  await h.pause()
  const click = await h.rt(() => __retake.history().events.find((e) => e.type === "click").t)
  const s = await h.state()
  await dock(page, (D) => (D.holdSwap = true))
  await drag(page, s.now, click + 120)
  await expect.poll(() => landed(page)).toBe(true)
  const look = (which) =>
    dock(
      page,
      (D, which) => {
        const f = which === "build" ? D.building.frame : D.frame
        const cs = f.contentWindow.getComputedStyle(f.contentDocument.querySelector("#card"))
        return { opacity: Number(cs.opacity).toFixed(3), transform: cs.transform }
      },
      which,
    )
  const real = await look("build")
  expect(Number(real.opacity)).toBeGreaterThan(0.3) // fading out, not the later fade-in's start (0.2)
  expect(await look("visible")).toEqual(real)
  await dock(page, (D) => (D.holdSwap = false))
  await expect.poll(() => swapped(page)).toBe(true)
  expect(await look("visible")).toEqual(real)
  expect(h.dockErrors).toEqual([])
})

test("F40: ⌥P in a frame being built (its replay took the window's focus) is the dock's Play: it waits for the moment, then plays from it", async ({ page }) => {
  const h = await openDock(page, DOCK_URL)
  await recordSome(h, ["#toggle"])
  await h.click("#q")
  await page.keyboard.type("hey")
  await page.waitForTimeout(400)
  await h.pause()
  const s = await h.state()
  await dock(page, (D) => (D.holdSwap = true))
  const t = await drag(page, s.now, s.end - 120)
  await expect.poll(() => landed(page)).toBe(true)
  await expect.poll(() => page.evaluate(() => document.activeElement === document.querySelector("#wb-stage iframe.building"))).toBe(true)
  await watch(page)
  await page.keyboard.press("Alt+KeyP")
  await expect(phase(page)).toHaveText(/^Building( \d+%)?$/)
  await page.waitForTimeout(300)
  // The frame behind never ran by itself (out of sight, recording past the end).
  const b = await dock(page, (D) => {
    const s = D.building.pt.state()
    return { play: D.building.play, playing: s.playing, now: s.now, end: s.end }
  })
  expect(b).toEqual({ play: true, playing: false, now: t, end: s.end })
  await dock(page, (D) => (D.holdSwap = false))
  await expect.poll(() => swapped(page)).toBe(true)
  await expect(phase(page)).toHaveText(/^(Playing|Live)$/)
  await page.waitForTimeout(200)
  const w = await stopWatch(page)
  const old = w.samples[0].vis
  expect(w.samples.find((x) => x.vis !== old).now).toBe(t)
  expect(h.dockErrors).toEqual([])
})

test("F41: Start fresh doesn't carry the scroll you looked at into the new recording", async ({ page }) => {
  const h = await openDock(page, DOCK_URL + "?tall")
  await recordSome(h, ["#toggle"])
  await h.pause()
  await page.mouse.move(640, 300)
  await page.mouse.wheel(0, 1500) // looking around while paused (not recorded)
  await expect.poll(() => visTop(page)).toBeGreaterThan(1400)
  await page.waitForTimeout(300)
  await dock(page, (D) => (window.__f0 = D.frame))
  await page.locator('button[data-a="fresh"]').click()
  await expect.poll(() => dock(page, (D) => D.frame !== window.__f0 && !D.building && D.PT.state().playing)).toBe(true)
  // A live page from its first moment, as it loaded: nothing it didn't record.
  expect(await visTop(page)).toBe(0)
  expect(await h.rt(() => __retake.viewScroll().length)).toBe(0)
  await page.waitForTimeout(600)
  await h.pause()
  const s = await h.state()
  await h.seek(s.start + 300) // rebuilt from the recording
  expect(await visTop(page)).toBe(0)
  expect(h.dockErrors).toEqual([])
})

test("F42: an app using IndexedDB, back at the end after a build behind changed it, doesn't wait (Paused, rebuilt out of sight)", async ({ page }) => {
  const h = await openDock(page, DOCK_URL + "?idb")
  await recordSome(h, ["#toggle", "#toggle", "#toggle"])
  await h.pause()
  const s = await h.state()
  await dock(page, (D) => (D.holdSwap = true))
  const t1 = await drag(page, s.now, s.start + (s.end - s.start) * 0.4)
  await expect.poll(() => landed(page)).toBe(true)
  expect((await h.state()).storageOk).toBe(false) // the build changed the app's IndexedDB under the frame on show
  await watch(page)
  await drag(page, t1, s.end + 50) // back to the end, which the frame on show stands at
  await page.waitForTimeout(400)
  await expect(phase(page)).toHaveText("Paused")
  await dock(page, (D) => (D.holdSwap = false))
  await expect.poll(() => swapped(page)).toBe(true)
  const w = await stopWatch(page)
  for (const x of w.samples.filter((x) => x.at >= w.upAt)) expect(["Scrubbing", "Paused"]).toContain(x.phase)
  const st = await h.state()
  expect(Math.abs(st.now - s.end)).toBeLessThan(1)
  expect(st.storageOk).toBe(true)
  expect(h.dockErrors).toEqual([])
})

test("F43: a page that's slow to load is waited for, not started again, and plays once it's in", async ({ page }) => {
  const h = await openDock(page, DOCK_URL)
  await recordSome(h, ["#toggle", "#toggle"])
  await h.pause()
  await dock(page, (D) => (D.buildWatchdogMs = 300))
  // From now on the app's script takes a while to arrive (each frame built loads it again).
  await page.route(/\/main\.js/, async (route) => {
    await new Promise((r) => setTimeout(r, 1500))
    await route.continue().catch(() => {})
  })
  const s = await h.state()
  await watch(page)
  const t = await drag(page, s.now, s.start + (s.end - s.start) * 0.4)
  await page.keyboard.press("Space")
  await expect(phase(page)).toHaveText(/^Building( \d+%)?$/)
  await expect.poll(() => swapped(page), { timeout: 15000 }).toBe(true)
  await expect(phase(page)).toHaveText(/^(Playing|Live)$/)
  const w = await stopWatch(page)
  expect(w.added).toBe(1) // never started again
  const old = w.samples[0].vis
  expect(w.samples.find((x) => x.vis !== old).now).toBe(t)
  await expect(page.locator(".hint")).toHaveText("")
  expect(h.dockErrors).toEqual([])
})

test("F43: a page that loads without starting (an error page) is tried twice more, then given up with a message; the preview stays", async ({ page }) => {
  const h = await openDock(page, DOCK_URL)
  await recordSome(h, ["#toggle", "#toggle"])
  await h.pause()
  await dock(page, (D) => (D.buildWatchdogMs = 300))
  await page.route(/__wb=app/, (route) => route.fulfill({ status: 500, contentType: "text/html", body: "<!doctype html><title>Error</title><p>Internal server error</p>" }))
  const s = await h.state()
  await watch(page)
  const t = await drag(page, s.now, s.start + (s.end - s.start) * 0.4)
  await expect(page.locator(".hint")).toHaveText("Couldn't build that moment", { timeout: 10000 })
  const w = await stopWatch(page)
  expect(w.added).toBe(3)
  expect(await dock(page, (D) => !D.building && document.querySelectorAll("#wb-stage iframe").length === 1)).toBe(true)
  const st = await h.state()
  expect(st.previewing).toBe(true)
  expect(st.previewAt).toBe(t)
  expect(h.dockErrors).toEqual([])
})

test("F44: an SVG's own animations (SMIL) are on the clock: still while paused, at t in the preview, the same once built", async ({ page }) => {
  const h = await openDock(page, DOCK_URL + "?smil")
  await recordSome(h, ["#toggle", "#toggle"])
  await h.pause()
  const smil = (which) =>
    dock(
      page,
      (D, which) => {
        const f = which === "build" ? D.building.frame : D.frame
        return f.contentDocument.querySelector("#smil").getCurrentTime() * 1000
      },
      which,
    )
  const s = await h.state()
  const c0 = await smil("visible")
  expect(Math.abs(c0 - (s.now - s.docStart))).toBeLessThan(1) // the page's time, from its start
  await page.waitForTimeout(400)
  expect(await smil("visible")).toBe(c0) // paused means paused
  await dock(page, (D) => (D.holdSwap = true))
  const t = await drag(page, s.now, s.start + (s.end - s.start) * 0.5)
  await expect.poll(() => landed(page)).toBe(true)
  const shown = await smil("visible")
  expect(Math.abs(shown - (t - s.docStart))).toBeLessThan(1)
  expect(Math.abs((await smil("build")) - shown)).toBeLessThan(1)
  await dock(page, (D) => (D.holdSwap = false))
  await expect.poll(() => swapped(page)).toBe(true)
  expect(Math.abs((await smil("visible")) - shown)).toBeLessThan(1) // nothing starts again at the swap
  expect(h.dockErrors).toEqual([])
})

test("F45: stepping exactly onto a click's frame shows the page before it, in the preview as in the real moment", async ({ page }) => {
  const h = await openDock(page, DOCK_URL)
  await recordSome(h, ["#toggle"])
  await h.pause()
  const { click, frames } = await h.rt(() => ({ click: __retake.history().events.find((e) => e.type === "click").t, frames: __retake.history().frames }))
  expect(frames).toContain(click) // input is recorded at a frame boundary: where the arrow keys stop
  await dock(page, (D) => (D.holdSwap = true))
  await dock(page, (D, t) => window.__retakeDock.goTo(t), click)
  await expect.poll(() => landed(page)).toBe(true)
  const look = (which) =>
    dock(
      page,
      (D, which) => {
        const f = which === "build" ? D.building.frame : D.frame
        const d = f.contentDocument
        return { count: d.querySelector("#count").textContent, card: d.querySelector("#card").className }
      },
      which,
    )
  const real = await look("build")
  expect(real).toEqual({ count: "0", card: "card primary-card" }) // a rebuild to that moment stops short of the click
  expect(await look("visible")).toEqual(real)
  // Just after it, both show the click's effect.
  await dock(page, (D) => (D.holdSwap = false))
  await expect.poll(() => swapped(page)).toBe(true)
  await dock(page, (D) => (D.holdSwap = true))
  const s = await h.state()
  await dock(page, (D, t) => window.__retakeDock.goTo(t), s.end)
  await expect
    .poll(() =>
      dock(page, (D, end) => {
        const s = D.PT.state()
        return !D.building && !s.seeking && s.target == null && s.now === end
      }, s.end),
    )
    .toBe(true)
  await dock(page, (D, t) => window.__retakeDock.goTo(t), click + 1)
  await expect.poll(() => landed(page)).toBe(true)
  expect(await look("build")).toEqual({ count: "1", card: "card primary-card off" })
  expect(await look("visible")).toEqual(await look("build"))
  expect(h.dockErrors).toEqual([])
})

test("F37: the preview shows a canvas as it was at that moment", async ({ page }) => {
  test.fail(true, "F37: the live preview doesn't restore canvas pixels (they stay at the live end until the swap)")
  const h = await openDock(page, DOCK_URL + "?canvas")
  await page.waitForTimeout(400)
  const before = (await h.state()).now
  await recordSome(h, ["#toggle"])
  await h.pause()
  const px = () => h.rt(() => [...document.querySelector("#cv").getContext("2d").getImageData(5, 5, 1, 1).data].slice(0, 3).join(","))
  expect(await px()).toBe("220,40,40")
  await dock(page, (D, t) => D.PT.preview(t), before - 100)
  expect(await px()).toBe("40,200,80")
})
