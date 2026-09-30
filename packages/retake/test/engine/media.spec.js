// Media and image readiness events land at their recorded virtual moment, not
// whenever the file happens to load during a rebuild (S4: Sherpa's onboarding video).
import { test, expect } from "@playwright/test"
import { openDock, pick } from "./helpers.js"
import { PORTS } from "./servers.js"

test("loadeddata/load replay at the recorded moment, and UI they reveal is there for later input", async ({ page }) => {
  const h = await openDock(page, `http://localhost:${PORTS.probe}/`)
  await expect.poll(async () => pick(await h.log(), "media").length, { timeout: 5000 }).toBe(1)
  await h.click("#gated")
  await page.keyboard.type("A lighthouse")
  await page.waitForTimeout(300)
  await h.pause()
  const live = await h.log()
  expect(pick(live, "gated").pop().v).toBe("A lighthouse")
  const T = (await h.state()).now
  await h.seek(T - 10)
  const replay = await h.log()
  expect(pick(replay, "media")).toEqual(pick(live, "media"))
  expect(pick(replay, "img")).toEqual(pick(live, "img"))
  expect(await h.rt(() => document.getElementById("gated").value)).toBe("A lighthouse")
})
