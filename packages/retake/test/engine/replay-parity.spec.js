// Fast replay must not change what a replay does. While rebuilding, the
// runtime settles in a few microtask turns when the app has nothing queued
// (instead of a task round trip per frame); the dock's kill switch
// (__retakeShell.fastReplay = false) turns that off. Either way, and in a
// frame built in idle slices (a checkpoint's background mode), the app must
// observe exactly the same thing at the same moments.
import { test, expect } from "@playwright/test"
import { openDock } from "./helpers.js"
import { PORTS } from "./servers.js"

// A full replay of `json` to t in a fresh frame; what the app shows there.
async function rebuildAt(h, json, t, { fast = true, background = false } = {}) {
  await h.page.evaluate(({ fast, background }) => {
    const sh = window.__retakeShell
    sh.fastReplay = fast
    if (!background) return
    const attach = sh.attach
    sh.attach = function (pt) {
      const r = attach.apply(this, arguments)
      try {
        pt.setBackground(true)
      } catch {}
      sh.attach = attach
      return r
    }
  }, { fast, background })
  await h.rt(([j, t]) => __retake.load(j, t), [json, t])
  await h.page.waitForTimeout(100)
  await h.settle()
  await h.page.evaluate(() => (window.__retakeShell.fastReplay = true))
  return h.rt(() => {
    const html = document.body.innerHTML.replace(/ data-rt-hover=""/g, "")
    let hash = 0
    for (let i = 0; i < html.length; i++) hash = (hash * 31 + html.charCodeAt(i)) | 0
    return {
      now: __retake.state().now,
      dom: hash,
      log: window.__probe ? JSON.stringify(window.__probe.log) : null,
      sample: window.__sample ? JSON.stringify(window.__sample()) : null,
      fastSettles: __retake.debug().fastSettles,
    }
  })
}

async function compareAt(h, fracs) {
  const s = await h.state()
  const json = await h.rt(() => JSON.stringify(__retake.history()))
  const frames = await h.rt(() => __retake.history().frames)
  let fastUsed = 0
  for (const f of fracs) {
    // A recorded frame boundary (between frames a replay rests at the earlier one).
    const t = frames.filter((x) => x <= s.start + (s.end - s.start) * f).pop()
    const slow = await rebuildAt(h, json, t, { fast: false })
    const fast = await rebuildAt(h, json, t)
    expect(slow.fastSettles).toBe(0)
    fastUsed += fast.fastSettles
    expect({ ...fast, fastSettles: 0 }, `at ${Math.round(t)}`).toEqual({ ...slow, fastSettles: 0 })
  }
  return { json, fastUsed }
}

test("probe: fast replay and the kill switch give the same app, at three moments; so does a background build", async ({ page }) => {
  const h = await openDock(page, `http://localhost:${PORTS.probe}/`)
  await page.waitForTimeout(600)
  await h.click("#go")
  await page.waitForTimeout(1200)
  await h.click("#q")
  await page.keyboard.type("hi")
  await page.keyboard.press("Enter")
  await h.click("#cb")
  const p = await h.box("#pad")
  await page.mouse.move(p.x + 5, p.y + 20)
  await page.mouse.move(p.x + 150, p.y + 20, { steps: 10 })
  await page.mouse.click(p.x + 100, p.y + 40)
  await h.click("#sse")
  await page.waitForTimeout(1400)
  await h.pause()
  const { json, fastUsed } = await compareAt(h, [0.3, 0.6, 0.95])
  expect(fastUsed).toBeGreaterThan(0) // the fast path was taken
  // Built in idle slices (how a checkpoint is built) vs at full speed.
  const s = await h.state()
  const frames = await h.rt(() => __retake.history().frames)
  const t = frames.filter((x) => x <= s.start + (s.end - s.start) * 0.8).pop()
  const fg = await rebuildAt(h, json, t)
  const bg = await rebuildAt(h, json, t, { background: true })
  expect({ ...bg, fastSettles: 0 }).toEqual({ ...fg, fastSettles: 0 })
  expect(h.errors).toEqual([])
})

test("react + motion libraries: fast replay and the kill switch give the same app, at three moments", async ({ page }) => {
  const h = await openDock(page, `http://localhost:${PORTS.react}/`)
  await page.waitForTimeout(300)
  await h.click("#nav-anim")
  await page.waitForTimeout(500)
  await h.click("#go")
  await page.waitForTimeout(700)
  await h.click("#go")
  await page.waitForTimeout(900)
  await h.pause()
  const { fastUsed } = await compareAt(h, [0.45, 0.7, 0.9])
  expect(fastUsed).toBeGreaterThan(0)
  expect(h.errors).toEqual([])
})
