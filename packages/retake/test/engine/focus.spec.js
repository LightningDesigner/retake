// S4 (Sherpa): the frame being rebuilt doesn't hold real focus, so the browser
// blurs what the replay focused; keys recorded "to the focused element" must
// still reach it.
import { test, expect } from "@playwright/test"
import { openDock, pick } from "./helpers.js"
import { PORTS } from "./servers.js"

test("replayed keys reach the field the recording focused, even if the rebuilding frame loses focus", async ({ page }) => {
  // Sabotage: in any app frame that's rebuilding, every focus is lost right away.
  await page.addInitScript(() => {
    if (!location.search.includes("__wb=app")) return
    document.addEventListener("focusin", () => {
      try {
        if (window.__retake && window.__retake.state().seeking) queueMicrotask(() => document.querySelector(":focus")?.blur())
      } catch {}
    }, true)
  })
  const h = await openDock(page, `http://localhost:${PORTS.probe}/`)
  await page.waitForTimeout(300)
  await h.click("#q")
  await page.keyboard.type("hi")
  await page.keyboard.press("Enter")
  await page.waitForTimeout(300)
  await h.pause()
  const live = await h.log()
  expect(pick(live, "keycode").map((e) => e.v)).toEqual([72, 73, 13])
  await h.seek((await h.state()).now - 1)
  const replay = await h.log()
  expect(pick(replay, "keycode")).toEqual(pick(live, "keycode"))
  expect(pick(replay, "submit")).toEqual(pick(live, "submit"))
})

test("pause then play at the live edge gives focus back to the field you were in", async ({ page }) => {
  const h = await openDock(page, `http://localhost:${PORTS.probe}/`)
  await page.waitForTimeout(300)
  await h.click("#q")
  await page.keyboard.type("lighthouse")
  await page.waitForTimeout(200)
  await h.pause()
  await page.waitForTimeout(300) // the dock takes focus while paused
  await h.record()
  await page.waitForTimeout(300)
  expect(await h.rt(() => document.activeElement && document.activeElement.id)).toBe("q")
  await page.keyboard.press("Enter")
  await page.waitForTimeout(300)
  expect(pick(await h.log(), "submit").map((e) => e.v)).toEqual(["lighthouse"])
})
