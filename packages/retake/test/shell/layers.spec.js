// The ⌘ layer picker: pseudo-element animations (a shimmer) can be picked,
// noted, and looked at on their own.
import { test, expect } from "@playwright/test"
import { openDock, DOCK_URL, dock, recordAndRewind, shot } from "./helpers.js"

test("⌘ over a skeleton lists its layers incl. the ::after shimmer; wheel cycles; a click notes the shimmer", async ({ page }) => {
  const h = await openDock(page, DOCK_URL)
  await recordAndRewind(h, ["#toggle"], 0.7)
  const b = await h.box("#skel")
  await page.mouse.move(b.x + 120, b.y + 14)
  await page.keyboard.down("Meta")
  await page.mouse.move(b.x + 122, b.y + 14)
  await expect(page.locator("#wb-layers")).toBeVisible()
  const labels = await page.locator("#wb-layers .layer").allTextContents()
  expect(labels.some((l) => /^::after · shimmer · 1\.2s loop$/.test(l))).toBe(true)
  expect(labels.some((l) => l.startsWith("div#skel"))).toBe(true)
  // Wheel to the shimmer.
  for (let i = 0; i < labels.length; i++) {
    if ((await page.locator("#wb-layers .layer.on").textContent()).startsWith("::after")) break
    await page.mouse.wheel(0, 40)
    await page.waitForTimeout(50)
  }
  await expect(page.locator("#wb-layers .layer.on")).toHaveText(/::after · shimmer/)
  await expect(page.locator("#wb-hl")).toHaveClass(/pseudo/)
  await expect.poll(() => page.evaluate(() => document.querySelector("#wb-hl").dataset.label)).toBe("div#skel::after")
  await shot(page, "dock-layers-chip.png")
  // The lens follows the pick: only the shimmer's activity.
  await expect.poll(() => dock(page, (D) => D.lens && D.lens.clips.map((c) => c.pseudoElement))).toEqual(expect.arrayContaining(["::after"]))
  expect(await dock(page, (D) => D.lens.clips.every((c) => c.pseudoElement === "::after"))).toBe(true)
  await page.mouse.click(b.x + 122, b.y + 14)
  await page.keyboard.up("Meta")
  const ta = page.locator("#wb-note textarea")
  await expect(ta).toBeVisible()
  await ta.fill("Slower shimmer")
  await ta.press("Enter")
  const n = await dock(page, (D) => D.notes[D.notes.length - 1])
  expect(n.el.pseudo).toMatchObject({ pseudoElement: "::after", keyframes: "shimmer", duration: 1200, iterations: "infinite" })
  expect(n.el.label).toBe("<div#skel>::after")
  const p = await page.evaluate(() => { const d = window.__retakeDock; return d.prompt(d.state.notes[d.state.notes.length - 1]) })
  expect(p).toContain("Animation: The ::after shimmer animation (keyframes `shimmer`, 1.2s, infinite) on .skel")
  // The CSS source line, when the runtime can find it.
  const hasCss = await h.rt(() => typeof __retake.cssSourceFor === "function")
  if (hasCss) {
    await expect.poll(() => dock(page, (D) => D.notes[D.notes.length - 1].el.cssSource && D.notes[D.notes.length - 1].el.cssSource.line)).toBeGreaterThan(0)
  }
  expect(h.dockErrors).toEqual([])
})
