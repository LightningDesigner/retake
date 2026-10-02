// Checkpoints: a rewind that lands at or after a hidden paused frame seeks
// forward from it (PT.adopt) instead of replaying from the start, and shows
// exactly what a full replay shows.
import { test, expect } from "@playwright/test"
import { openDock, DOCK_URL, recordSome, dock } from "./helpers.js"

const snapshot = (h) =>
  h.rt(() => {
    const c = document.querySelector("#card")
    const cs = getComputedStyle(c)
    return { count: document.querySelector("#count").textContent, cls: c.className, transform: cs.transform, opacity: cs.opacity, now: __retake.state().now }
  })

async function rewindTo(h, t) {
  const { page } = h
  await dock(page, (D, t) => D.PT.seek(t), t)
  await expect.poll(() => dock(page, (D) => !D.building && D.last && !D.last.seeking)).toBe(true)
  await page.waitForTimeout(150)
}

test("a rewind after a checkpoint seeks forward from it and matches a full replay", async ({ page }) => {
  const h = await openDock(page, DOCK_URL)
  await recordSome(h, ["#toggle", "#spinner", "#toggle", "#toggle"])
  await h.pause()
  const s = await h.state()
  await dock(page, (D) => (D.cpMinMs = 0))
  const t1 = s.end - 100
  const t2 = s.end - 480 // mid-transition of the last toggle
  await rewindTo(h, t1)
  expect(await dock(page, (D) => D.lastRebuild.via)).toBe("replay")
  // Quiet in the past: a checkpoint gets built behind.
  await expect.poll(() => page.evaluate(() => window.__retakeDock.checkpoint()), { timeout: 15000 }).toMatchObject({ ready: true })
  const cp = await page.evaluate(() => window.__retakeDock.checkpoint())
  expect(cp.at).toBeLessThanOrEqual(t2)
  await page.evaluate(() => {
    window.__added = 0
    new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => n.tagName === "IFRAME" && window.__added++))).observe(document.querySelector("#wb-stage"), { childList: true })
  })
  await rewindTo(h, t2)
  expect(await dock(page, (D) => D.lastRebuild.via)).toBe("checkpoint")
  expect(await page.evaluate(() => window.__added)).toBe(0)
  const viaCheckpoint = await snapshot(h)

  // The same moment by a full replay.
  await dock(page, (D) => {
    D.cpMinMs = 1e9
    D.heavy = false
    if (D.cp) D.cp.frame.remove()
    D.cp = null
  })
  await rewindTo(h, t1)
  await rewindTo(h, t2)
  expect(await dock(page, (D) => D.lastRebuild.via)).toBe("replay")
  const viaReplay = await snapshot(h)
  expect(viaCheckpoint).toEqual(viaReplay)
  expect(h.dockErrors).toEqual([])
})

test("a checkpoint isn't used across timelines, and a fork drops it", async ({ page }) => {
  const h = await openDock(page, DOCK_URL)
  await recordSome(h, ["#toggle", "#toggle"])
  await h.pause()
  const s = await h.state()
  await dock(page, (D) => (D.cpMinMs = 0))
  await rewindTo(h, s.end - 100)
  await expect.poll(() => page.evaluate(() => window.__retakeDock.checkpoint()), { timeout: 15000 }).toMatchObject({ ready: true })
  await dock(page, (D, t) => window.__retakeDock.newTimelineAt(t), s.end - 200)
  await expect.poll(() => dock(page, (D) => D.activeId)).toBe(2)
  await expect.poll(() => page.evaluate(() => window.__retakeDock.checkpoint())).toBe(null)
  expect(await page.evaluate(() => document.querySelectorAll("#wb-stage iframe.checkpoint").length)).toBe(0)
  expect(h.dockErrors).toEqual([])
})

test("no checkpoint for an app that keeps state in IndexedDB (another frame's replay would change it under the one on show)", async ({ page }) => {
  const h = await openDock(page, DOCK_URL + "?idb")
  await recordSome(h, ["#toggle", "#toggle"])
  await h.pause()
  const s = await h.state()
  await dock(page, (D) => (D.cpMinMs = 0))
  await rewindTo(h, s.end - 100)
  expect((await h.state()).idb).toBe(true)
  expect(await dock(page, (D) => D.heavy)).toBe(true)
  await page.waitForTimeout(1500)
  expect(await page.evaluate(() => window.__retakeDock.checkpoint())).toBe(null)
  expect(await page.evaluate(() => document.querySelectorAll("#wb-stage iframe.checkpoint").length)).toBe(0)
  expect(h.dockErrors).toEqual([])
})
