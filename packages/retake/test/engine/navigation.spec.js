// Navigation and reloads: each full page load starts a segment of the
// recording at its URL; a rebuild loads the segment's page and replays only
// from there (S2's address-bar navigation fix relies on this).
import { test, expect } from "@playwright/test"
import { openDock, pick } from "./helpers.js"
import { PORTS } from "./servers.js"

test("an in-app navigation starts a segment; rebuilds before and after it land on the right page", async ({ page }) => {
  const h = await openDock(page, `http://localhost:${PORTS.probe}/`)
  await page.waitForTimeout(300)
  await h.click("#go")
  await page.waitForTimeout(600)
  await h.click("#nav") // location.href = "/?p=2"
  await page.waitForTimeout(1500)
  expect(await h.rt(() => new URLSearchParams(location.search).get("p"))).toBe("2")
  expect(await h.rt(() => new URLSearchParams(location.search).get("__wb"))).toBe("app") // still in the time machine
  const before = await h.state()
  expect(before.recording).toBe(true)
  await h.click("#go")
  await page.waitForTimeout(400)
  await h.pause()
  const hist = await h.rt(() => __wayback.history())
  expect(hist.segments).toHaveLength(1)
  expect(hist.segments[0].url).toContain("p=2")
  const segT = hist.segments[0].t
  const livePage2 = pick(await h.log(), "click-random")
  expect(livePage2).toHaveLength(1)
  const end = (await h.state()).now
  // Before the navigation: the first page, with its click
  await h.seek(segT - 100)
  expect(await h.rt(() => new URLSearchParams(location.search).get("p"))).toBeNull()
  expect(pick(await h.log(), "click-random")).toHaveLength(1)
  // After it: page 2, replaying only from the navigation
  await h.seek(end - 1)
  expect(await h.rt(() => new URLSearchParams(location.search).get("p"))).toBe("2")
  expect(pick(await h.log(), "click-random")).toEqual(livePage2)
})
