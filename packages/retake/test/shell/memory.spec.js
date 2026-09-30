// The dock lets go of frames it has swapped out (heap growth per rebuild).
import { test, expect } from "@playwright/test"
import { openDock, DOCK_URL, recordSome, dock } from "./helpers.js"

test("old frames are garbage once swapped out", async ({ page }) => {
  const h = await openDock(page, DOCK_URL)
  await recordSome(h, ["#toggle", "#toggle", "#spinner"])
  await dock(page, () => (window.__oldWindows = []))
  const s = await h.state()
  for (let i = 0; i < 4; i++) {
    // Seek through the dock page only, so no test handle holds a frame.
    await dock(page, (D) => window.__oldWindows.push(new WeakRef(D.frame.contentWindow)))
    await dock(page, (D, t) => D.PT.seek(t), s.start + (s.end - s.start) * (0.8 - i * 0.15))
    await expect.poll(() => dock(page, (D) => !D.building && document.querySelectorAll("#wb-stage iframe").length === 1 && !D.last.seeking)).toBe(true)
    await page.waitForTimeout(200)
  }
  // Hover the timeline and open things that cache frame objects, then GC.
  await page.mouse.move(600, 740)
  await page.waitForTimeout(300)
  const cdp = await page.context().newCDPSession(page)
  for (let i = 0; i < 3; i++) {
    await cdp.send("HeapProfiler.collectGarbage")
    await page.waitForTimeout(200)
  }
  const alive = await page.evaluate(() => window.__oldWindows.map((r, i) => (r.deref() ? i : -1)).filter((i) => i >= 0))
  // Chromium can keep the very first frame's window: the first TransitionEvent
  // the runtime makes caches its constructor in a Blink template map held by
  // an eternal handle (seen in a heap snapshot). That's one window, once; what
  // must never happen is frames keeping each other alive, so every later one
  // has to be gone.
  expect(alive.filter((i) => i > 0)).toEqual([])
})
