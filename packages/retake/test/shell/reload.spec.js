// Typing a new address or reloading: the page asked for opens live, straight
// away; the saved timelines stay, and going back brings the old page back.
import { test, expect } from "@playwright/test"
import { openDock, DOCK_URL, dock, recordSome } from "./helpers.js"
import { fakeServer } from "./fake-server.js"

const framePath = (page) => page.evaluate(() => { try { return new URL(document.querySelector("#wb-stage iframe.live").contentWindow.location.href).pathname } catch { return null } })

test("a new URL in the address bar opens that page live, no rebuild; the old timeline is kept and brings the old page back", async ({ page }) => {
  const fake = await fakeServer(page)
  const h = await openDock(page, DOCK_URL)
  await recordSome(h, ["#toggle", "#toggle"])
  await h.pause()
  await expect.poll(() => fake.store.recordings["1"] && JSON.parse(fake.store.recordings["1"]).events.length, { timeout: 8000 }).toBeGreaterThan(0)
  const savedEnd = JSON.parse(fake.store.recordings["1"]).end

  // Watch every phase the readout shows from the very first paint.
  await page.addInitScript(() => {
    window.__phases = []
    new MutationObserver(() => {
      const el = document.querySelector(".readout .phase")
      if (el && window.__phases[window.__phases.length - 1] !== el.textContent) window.__phases.push(el.textContent)
    }).observe(document, { subtree: true, childList: true, characterData: true })
  })
  await page.goto(DOCK_URL + "other.html")
  await expect.poll(() => framePath(page)).toBe("/other.html")
  await expect.poll(() => dock(page, (D) => !!D.PT && D.last && D.last.booted)).toBe(true)
  await page.waitForTimeout(800)
  // Live, at the page asked for, never rebuilt.
  expect(await framePath(page)).toBe("/other.html")
  expect(await page.evaluate(() => window.__phases.filter((p) => /Building|Loading/.test(p)))).toEqual([])
  expect(await page.evaluate(() => document.querySelectorAll("#wb-stage iframe:not(.checkpoint)").length)).toBe(1)
  expect(await dock(page, (D) => D.last.playing)).toBe(true)
  // The old timeline is still there with its whole recording.
  const branches = await dock(page, (D) => D.branches.map((b) => ({ id: b.id, name: b.name, end: b.end })))
  expect(branches.find((b) => b.id === 1).end).toBeGreaterThanOrEqual(savedEnd - 1)
  const features = await page.evaluate(() => (window.__retakeConfig && window.__retakeConfig.features) || [])
  if (features.includes("continue")) {
    // Continued on the same timeline, with a marker where the page changed.
    expect(branches.length).toBe(1)
    const tl = await dock(page, (D) => D.PT.timeline().markers.filter((m) => m.kind === "reload"))
    expect(tl.map((m) => m.label)).toContain("→ /other.html")
    await dock(page, (D, t) => D.PT.seek(t), savedEnd - 100)
  } else {
    // This visit is a timeline of its own; the old one is one click away.
    expect(branches.length).toBe(2)
    expect(branches[1].name).toBe("→ /other.html")
    expect(await dock(page, (D) => D.activeId)).toBe(2)
    await dock(page, () => window.__retakeDock.switchTo(1, 1e9))
  }
  await expect.poll(() => framePath(page), { timeout: 15000 }).toBe("/")
  // And the address bar follows the app.
  await expect.poll(() => new URL(page.url()).pathname).toBe("/")
  expect(h.dockErrors).toEqual([])
})

test("with no saved session, the page opens live at once", async ({ page }) => {
  await page.route("**/__retake/session", (r) => r.fulfill({ status: 404, body: "" }))
  const h = await openDock(page, DOCK_URL + "other.html", { fake: false })
  expect(await framePath(page)).toBe("/other.html")
  expect(await dock(page, (D) => D.branches.length)).toBe(1)
  expect(h.dockErrors).toEqual([])
})
