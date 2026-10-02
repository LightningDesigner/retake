// M1: the dock keeps working when things go wrong (F9, F29, F30 shell side).
import { test, expect } from "@playwright/test"
import { openDock, DOCK_URL, recordSome, shellScript, shellCss } from "./helpers.js"

test("F29: shell.css has balanced braces and no nested duplicate @media", () => {
  const css = shellCss()
  let depth = 0
  for (const c of css) {
    if (c === "{") depth++
    if (c === "}") depth--
    expect(depth).toBeGreaterThanOrEqual(0)
  }
  expect(depth).toBe(0)
  expect(css).not.toMatch(/@media[^{]*\{\s*@media/)
})

test("F30: dead code is gone and the shell parses", () => {
  const js = shellScript()
  expect(() => new Function(js)).not.toThrow()
  expect(js).not.toMatch(/toggleNotesPanel/)
  expect(js).not.toMatch(/\bstash\(/)
  expect(js).not.toMatch(/setRate/)
  expect(js.match(/const KEY\b/g) || []).toHaveLength(1)
})

test("F9: a render exception doesn't freeze the dock", async ({ page }) => {
  const h = await openDock(page, DOCK_URL)
  await recordSome(h, ["#toggle"])
  // Point the dock at a timeline that doesn't exist, and make one frame throw.
  await page.evaluate(() => {
    const D = window.__retakeDock.state
    D.activeId = 999
    const b = D.branches[0]
    let thrown = false
    Object.defineProperty(b, "end", {
      configurable: true,
      get() {
        if (!thrown) {
          thrown = true
          throw new Error("boom")
        }
        return this._end || 0
      },
      set(v) {
        this._end = v
      },
    })
  })
  const read = () => page.evaluate(() => window.__retakeDock.state.last && window.__retakeDock.state.last.now)
  const a = await read()
  await page.waitForTimeout(600)
  const b = await read()
  expect(b).toBeGreaterThan(a)
  expect(await page.evaluate(() => window.__retakeDock.state.activeId)).toBe(1)
})

test("F9: deleting a timeline mid-switch leaves the branches alone", async ({ page }) => {
  const h = await openDock(page, DOCK_URL)
  await recordSome(h, ["#toggle", "#toggle"])
  await h.pause()
  const s = await h.state()
  await h.seek(s.start + (s.end - s.start) / 2)
  await expect
    .poll(async () => {
      await h.rt(() => __retake.forkHere()).catch(() => {})
      return page.evaluate(() => window.__retakeDock.branches().map((b) => b.id))
    })
    .toEqual([1, 2])
  await h.settle()
  const res = await page.evaluate(async () => {
    window.__retakeDock.state.switching = true
    const r = await window.__retakeDock.deleteTimeline(2)
    window.__retakeDock.state.switching = false
    return r
  })
  expect(res).toBe(false)
  const after = await page.evaluate(() => ({ ids: window.__retakeDock.branches().map((b) => b.id), active: window.__retakeDock.state.activeId }))
  expect(after).toEqual({ ids: [1, 2], active: 2 })
  expect(h.errors).toEqual([])
  expect(h.dockErrors).toEqual([])
})

test("the timeline mock is never part of the dock", () => {
  expect(shellScript()).not.toMatch(/MOCK/)
})

// S4 (Sherpa): pausing at the live edge took focus off the app's field and
// play never gave it back, so the next keys went nowhere (Sherpa's idea box
// lost its Enter). Pause → play must leave focus and caret where they were.
test("pause then play keeps the app's focused field and caret", async ({ page }) => {
  const h = await openDock(page, DOCK_URL)
  await page.waitForTimeout(400)
  await h.click("#idea")
  await page.keyboard.type("abc")
  const play = page.locator('#wb-dock [data-a="play"]')
  await play.click() // pause
  await page.waitForTimeout(300)
  await play.click() // play
  await page.waitForTimeout(300)
  await page.keyboard.type("d")
  const r = await h.rt(() => ({ v: document.querySelector("#idea").value, active: document.activeElement && document.activeElement.id }))
  expect(r.active).toBe("idea")
  expect(r.v).toBe("abcd")
})
