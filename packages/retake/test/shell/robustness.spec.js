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
    const D = window.__waybackDock.state
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
  const read = () => page.evaluate(() => window.__waybackDock.state.last && window.__waybackDock.state.last.now)
  const a = await read()
  await page.waitForTimeout(600)
  const b = await read()
  expect(b).toBeGreaterThan(a)
  expect(await page.evaluate(() => window.__waybackDock.state.activeId)).toBe(1)
})

test("F9: deleting a timeline mid-switch leaves the branches alone", async ({ page }) => {
  const h = await openDock(page, DOCK_URL)
  await recordSome(h, ["#toggle", "#toggle"])
  await h.pause()
  const s = await h.state()
  await h.seek(s.start + (s.end - s.start) / 2)
  await expect
    .poll(async () => {
      await h.rt(() => __wayback.forkHere()).catch(() => {})
      return page.evaluate(() => window.__waybackDock.branches().map((b) => b.id))
    })
    .toEqual([1, 2])
  await h.settle()
  const res = await page.evaluate(async () => {
    window.__waybackDock.state.switching = true
    const r = await window.__waybackDock.deleteTimeline(2)
    window.__waybackDock.state.switching = false
    return r
  })
  expect(res).toBe(false)
  const after = await page.evaluate(() => ({ ids: window.__waybackDock.branches().map((b) => b.id), active: window.__waybackDock.state.activeId }))
  expect(after).toEqual({ ids: [1, 2], active: 2 })
  expect(h.errors).toEqual([])
  expect(h.dockErrors).toEqual([])
})
