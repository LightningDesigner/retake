// Real animation libraries: pause mid-animation, record on, rewind to the same
// moment, and the replayed frame must match what was on screen.
import { test, expect } from "@playwright/test"
import { openDock } from "./helpers.js"
import { PORTS } from "./servers.js"

test("Framer Motion, GSAP, React Spring and Lottie replay frame-exact", async ({ page }) => {
  const h = await openDock(page, `http://localhost:${PORTS.react}/`)
  await h.record()
  await page.waitForTimeout(400)
  await h.click("#nav-anim")
  await page.waitForTimeout(700)
  await h.click("#go")
  await page.waitForTimeout(350)
  await h.pause()
  await page.waitForTimeout(150)
  const T = (await h.state()).now
  const liveSample = await h.rt(() => __sample())
  expect(liveSample.path).toBe("/anim")
  expect(liveSample.lottie).toBeGreaterThan(0)
  await h.record(); await page.waitForTimeout(1200); await h.pause()
  await h.seek(T)
  expect(await h.rt(() => __sample())).toEqual(liveSample)
  expect(h.errors).toEqual([])
})

test("F11 browser Back inside a React Router app replays", async ({ page }) => {
  const h = await openDock(page, `http://localhost:${PORTS.react}/`)
  await h.record(); await page.waitForTimeout(300)
  await h.click("#nav-anim"); await page.waitForTimeout(300)
  await h.click("#nav-about"); await page.waitForTimeout(400)
  await page.goBack(); await page.waitForTimeout(500)
  await h.pause()
  const T = (await h.state()).now
  const livePath = (await h.rt(() => __sample())).path
  expect(livePath).toBe("/anim")
  await h.record(); await page.waitForTimeout(300); await h.pause()
  await h.seek(T)
  expect((await h.rt(() => __sample())).path).toBe(livePath)
})

test("React elements in a rebuilt frame keep their debug stack (notes read source lines from it)", async ({ page }) => {
  const h = await openDock(page, `http://localhost:${PORTS.react}/`)
  await h.record(); await page.waitForTimeout(300)
  await h.click("#nav-anim"); await page.waitForTimeout(600)
  await h.pause()
  await h.seek((await h.state()).now - 100)
  const stack = await h.rt(() => {
    const el = document.getElementById("go")
    const key = Object.keys(el).find((k) => k.startsWith("__reactFiber$"))
    const s = el[key]._debugStack
    return s && (s.stack || String(s))
  })
  expect(stack).toContain("main.tsx")
})
