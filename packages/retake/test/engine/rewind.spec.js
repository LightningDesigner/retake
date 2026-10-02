// The runtime side of going back without waiting (CONTRACT.md, "Dock ↔ runtime"):
// buildAt / retarget / sameMoment, view-only scrolling during a preview and how
// it's handed to the next frame, other frames' storage events while paused, and
// a preview asked for during an in-place seek.
import { test, expect } from "@playwright/test"
import { openDock, pick } from "./helpers.js"
import { PORTS } from "./servers.js"
const URL_ = `http://localhost:${PORTS.probe}/`

// Run fn(D, arg) in the dock window (D = the dock's state).
const dock = (page, fn, arg) => page.evaluate(`(${fn})(window.__retakeDock.state, ${JSON.stringify(arg ?? null)})`)
const scrollerTop = (h) => h.rt(() => document.getElementById("scroller").scrollTop)
// The shield over a paused app lets scrolling through (S2's side); here the runtime is tested on its own.
const noShield = (page) => page.evaluate(() => { const s = document.getElementById("wb-shield"); if (s) s.style.pointerEvents = "none" })
async function wheelScroller(h, dy) {
  const b = await h.box("#scroller")
  await h.page.mouse.move(b.x + 20, b.y + 20)
  await h.page.mouse.wheel(0, dy)
  await expect.poll(() => scrollerTop(h)).toBeGreaterThan(50)
  await h.page.waitForTimeout(200)
}

test("sameMoment: yes within one frame; no across a frame boundary, an input event or a reload", async ({ page }) => {
  const h = await openDock(page, URL_)
  await page.waitForTimeout(400)
  await h.click("#go")
  await page.waitForTimeout(500)
  await h.click("#nav") // a full navigation: a new page (segment)
  await page.waitForTimeout(800)
  await h.pause()
  const r = await h.rt(() => {
    const rec = __retake.history()
    const evAt = new Set(rec.events.map((e) => e.t))
    const seg = rec.segments[0].t
    const f = rec.frames.find((x, i) => x > 100 && x < seg - 100 && !evAt.has(x) && rec.frames[i + 1] - x > 4 && !rec.events.some((e) => e.t >= x && e.t < rec.frames[i + 1]))
    const click = rec.events.find((e) => e.type === "pointerdown").t
    const m = __retake.sameMoment
    return {
      within: m(f, f + 1) && m(f + 1, f) && m(f + 0.5, f + 2),
      boundary: m(f - 1, f),
      event: m(click, click + 0.5),
      far: m(f, f + 60),
      reload: m(seg - 1, seg + 1),
      same: m(seg + 1, seg + 1),
    }
  })
  expect(r).toEqual({ within: true, boundary: false, event: false, far: false, reload: false, same: true })
})

test("buildAt builds without ending the preview and sends the page, the viewport and a signature", async ({ page }) => {
  const h = await openDock(page, URL_)
  await page.waitForTimeout(300)
  await h.click("#go")
  await page.waitForTimeout(800)
  await h.pause()
  const s = await h.state()
  await dock(page, (D) => {
    D.holdSwap = true
    const rb = window.__retakeShell.rebuild
    window.__payloads = []
    window.__retakeShell.rebuild = function (p) {
      window.__payloads.push({ target: p.target, url: p.url, viewport: p.viewport, sig: p.sig, play: p.play, rec: typeof p.rec })
      return rb.apply(this, arguments)
    }
  })
  const t = s.now - 500
  await h.rt((t) => {
    __retake.preview(t)
    __retake.buildAt(t)
  }, t)
  const st = await h.state()
  expect(st.previewing).toBe(true)
  expect(st.previewAt).toBe(t)
  const [p] = await page.evaluate(() => window.__payloads)
  expect(p).toMatchObject({ target: t, play: false, rec: "string" })
  expect(p.url).toContain("__wb=app")
  expect(p.viewport).toEqual(await h.rt(() => __retake.history().viewport))
  expect(p.sig).toMatch(/^\d+:\d+:[\d.]+:\d+:\d+$/)
  await expect.poll(() => dock(page, (D) => !!D.building && !!D.building.pt)).toBe(true)
  await dock(page, (D) => (D.holdSwap = false))
  const end = await h.settle()
  expect(end.now).toBe(t)
})

test("retarget: forward before boot, mid-seek and after landing; never back, never across a reload", async ({ page }) => {
  const h = await openDock(page, URL_)
  await page.waitForTimeout(300)
  await h.click("#go")
  await page.waitForTimeout(1500)
  await h.click("#nav")
  await page.waitForTimeout(600)
  await h.pause()
  const seg = await h.rt(() => __retake.history().segments[0].t)
  // Before boot (through the dock): a second request for a later moment of the
  // same recording, before the first frame has started, moves that frame on.
  const added = await dock(page, (D, t) => {
    window.__added = 0
    new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => n.tagName === "IFRAME" && window.__added++))).observe(document.querySelector("#wb-stage"), { childList: true })
    D.PT.buildAt(t - 600)
    D.PT.buildAt(t)
    return D.building.via
  }, seg - 300)
  expect(added).toBe("retarget")
  let st = await h.settle()
  expect(st.now).toBe(seg - 300)
  expect(await page.evaluate(() => window.__added)).toBe(1)
  // After landing (this frame was built): forward yes, back no, past the reload no.
  expect(await h.rt((t) => __retake.retarget(t), seg - 900)).toBe(false)
  expect(await h.rt((t) => __retake.retarget(t), seg + 200)).toBe(false)
  expect(await h.rt((t) => __retake.retarget(t), seg - 200)).toBe(true)
  st = await h.settle()
  expect(st.now).toBe(seg - 200)
  // Mid-seek: an in-place seek moves on to a later target (asked for by a
  // timer of the app's, 300ms into the replay).
  await h.seek(200)
  await h.rt((later) => {
    setTimeout(() => {
      window.__was = __retake.state().seeking
      window.__ok = __retake.retarget(later)
    }, 300)
  }, seg - 400)
  await h.rt((to) => __retake.seek(to), seg - 700)
  await page.waitForTimeout(100)
  st = await h.settle()
  expect(await h.rt(() => [window.__was, window.__ok])).toEqual([true, true])
  expect(st.now).toBe(seg - 400)
})

test("scrolling during a preview is allowed, view-only and not recorded", async ({ page }) => {
  const h = await openDock(page, URL_)
  await page.waitForTimeout(900)
  await h.pause()
  await noShield(page)
  const now = (await h.state()).now
  const inputs = () => h.rt(() => __retake.history().events.filter((e) => /scroll|wheel/.test(e.type)).length)
  const events = await inputs()
  await h.rt((t) => __retake.preview(t), now - 400)
  await wheelScroller(h, 200)
  const s = await h.state()
  expect(s.previewing).toBe(true)
  expect(s.now).toBe(now)
  expect(await inputs()).toBe(events)
  expect(pick(await h.log(), "scrolled")).toEqual([]) // the app didn't hear of it
  // Leaving the preview keeps the view the user scrolled to; Play puts the recording's back.
  const top = await scrollerTop(h)
  await h.rt(() => __retake.endPreview())
  expect(await scrollerTop(h)).toBe(top)
  await h.record()
  await expect.poll(() => scrollerTop(h)).toBe(0)
})

test("viewScroll / applyView: what the user looked at goes to the rebuilt frame, and Play puts the recording's scroll back", async ({ page }) => {
  const h = await openDock(page, URL_)
  await page.waitForTimeout(900)
  await h.pause()
  await noShield(page)
  await wheelScroller(h, 200)
  const looked = await scrollerTop(h)
  const list = await h.rt(() => JSON.parse(JSON.stringify(__retake.viewScroll())))
  expect(list).toHaveLength(1)
  expect(list[0].top).toBe(looked)
  // Going back: the dock carries the view into the frame it swaps in.
  const s = await h.state()
  await h.seek(s.now - 300)
  expect(await scrollerTop(h)).toBe(looked)
  expect((await h.rt(() => __retake.viewScroll())).map((v) => v.top)).toEqual([looked])
  expect(pick(await h.log(), "scrolled")).toEqual([])
  // applyView on its own.
  await h.rt((l) => __retake.applyView(l), [{ ...list[0], top: 37 }])
  expect(await scrollerTop(h)).toBe(37)
  await h.rt(() => __retake.play())
  await expect.poll(() => scrollerTop(h)).toBe(0)
})

test("a paused app doesn't hear other frames' storage events", async ({ page }) => {
  const h = await openDock(page, URL_)
  await page.waitForTimeout(500)
  await h.rt(() => {
    window.__heard = 0
    addEventListener("storage", (e) => e.key === "x-other" && window.__heard++)
  })
  await h.pause()
  await page.evaluate(() => localStorage.setItem("x-other", "1"))
  await page.waitForTimeout(300)
  expect(await h.rt(() => window.__heard)).toBe(0)
  await h.record()
  await page.waitForTimeout(100)
  await page.evaluate(() => localStorage.setItem("x-other", "2"))
  await expect.poll(() => h.rt(() => window.__heard)).toBe(1)
})

test("a preview asked for during an in-place seek waits for it to stop, then shows; endPreview gives the live page back", async ({ page }) => {
  const h = await openDock(page, URL_)
  await page.waitForTimeout(400)
  await h.click("#go")
  await page.waitForTimeout(1500)
  await h.pause()
  const s = await h.state()
  const click = await h.rt(() => __retake.history().events.find((e) => e.type === "pointerdown").t)
  const from = (await h.seek(click + 150)).now // a rebuilt frame just after the click, with recorded future
  const html = () => h.rt(() => document.body.innerHTML.replace(/ data-rt-hover=""/g, ""))
  // Asked for before the seek has even started: it doesn't start.
  await h.rt(([to, at]) => {
    __retake.seek(to)
    __retake.preview(at)
    window.__atOnce = __retake.state().previewing
  }, [s.end - 50, click - 60])
  await expect.poll(() => h.state().then((x) => x.previewing && !x.seeking && x.target == null)).toBe(true)
  let st = await h.state()
  expect(await h.rt(() => window.__atOnce)).toBe(false)
  expect([st.now, st.previewAt]).toEqual([from, click - 60])
  await h.rt(() => __retake.endPreview())
  // Asked for halfway (a timer of the app's, 300ms into the replay, asks for it).
  await h.rt((at) => {
    setTimeout(() => {
      window.__was = __retake.state().seeking
      __retake.preview(at)
      window.__atOnce = __retake.state().previewing
    }, 300)
  }, click - 60)
  await h.rt((to) => __retake.seek(to), s.end - 50)
  await expect.poll(() => h.state().then((x) => x.previewing && !x.seeking && x.target == null)).toBe(true)
  st = await h.state()
  expect(await h.rt(() => [window.__was, window.__atOnce])).toEqual([true, false])
  expect(st.previewAt).toBe(click - 60)
  expect(st.now).toBeGreaterThanOrEqual(from + 300) // the seek stopped where it was
  expect(st.now).toBeLessThan(s.end - 50)
  // The preview is that earlier moment: before the click.
  expect(await h.rt(() => document.getElementById("box").classList.contains("on"))).toBe(false)
  // Leaving it gives back the page at the moment the seek stopped, exactly as a rebuild there has it.
  await h.rt(() => __retake.endPreview())
  expect(await h.rt(() => document.getElementById("box").classList.contains("on"))).toBe(true)
  const live = await html()
  await h.rt((t) => __retake.load(JSON.stringify(__retake.history()), t), st.now)
  await page.waitForTimeout(150)
  expect((await h.settle()).now).toBe(st.now)
  expect(await html()).toBe(live)
})
