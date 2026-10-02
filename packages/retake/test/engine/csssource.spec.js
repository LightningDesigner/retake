// cssSourceFor() and pseudo-element clips (for the dock's layer picker).
import { test, expect } from "@playwright/test"
import { openDock } from "./helpers.js"
import { PORTS } from "./servers.js"

test("a ::after shimmer: clipsFor finds it with pseudoElement, cssSourceFor points at the rule and @keyframes", async ({ page }) => {
  const h = await openDock(page, `http://localhost:${PORTS.probe}/`)
  await page.waitForTimeout(600)
  await h.pause()
  const clips = await h.rt(() => __retake.clipsFor("#skel"))
  const shimmer = clips.find((c) => c.label === "shimmer")
  expect(shimmer).toMatchObject({ kind: "css-animation", pseudoElement: "::after", iterations: "infinite" })
  const src = await h.rt((c) => __retake.cssSourceFor(c), shimmer)
  expect(src.file).toMatch(/skeleton\.css$/)
  expect(src.line).toBe(10) // .skel::after {
  expect(src.selector).toBe(".skel::after")
  expect(src.keyframes).toMatchObject({ name: "shimmer", line: 18 })
  expect(src.keyframes.file).toMatch(/skeleton\.css$/)
  // also from a live Animation object
  const viaAnim = await h.rt(() => {
    const a = document.getAnimations().find((x) => x.animationName === "shimmer")
    return __retake.cssSourceFor(a).then((r) => r && r.line)
  })
  expect(viaAnim).toBe(10)
})

test("a transition's source is the rule that declares it", async ({ page }) => {
  const h = await openDock(page, `http://localhost:${PORTS.probe}/`)
  await page.waitForTimeout(300)
  await h.click("#go") // #box transform transition, declared inline in index.html's <style>
  await page.waitForTimeout(100)
  await h.pause()
  const tr = (await h.rt(() => __retake.clipsFor("#box"))).find((c) => c.kind === "transition")
  const src = await h.rt((c) => __retake.cssSourceFor(c), tr)
  expect(src.selector).toBe("#box")
  expect(src.line).toBeGreaterThan(0)
})
