// The animation model a note carries: script-driven motion recorded as clips
// (GSAP, Motion's x, react-spring write inline styles every frame), where
// element.animate() was called, and the "exact edit" (src/note-text.js
// splitKeyframes): the keyframes with a note's range edges put in must give
// the same motion as the original everywhere, in a real browser.
import { test, expect } from "@playwright/test"
import { openDock } from "./helpers.js"
import { PORTS } from "./servers.js"
import { pointOf, splitKeyframes } from "../../src/note-text.js"

test("script-driven motion (GSAP, Motion's x, react-spring) is recorded as js clips with first and last values", async ({ page }) => {
  const h = await openDock(page, `http://localhost:${PORTS.react}/`)
  await h.record()
  await page.waitForTimeout(300)
  await h.click("#nav-anim")
  await page.waitForTimeout(500)
  await h.click("#go")
  await page.waitForTimeout(1600)
  await h.pause()
  const clips = (await h.rt(() => __retake.timeline())).clips.filter((c) => c.kind === "js")
  const on = (id) => clips.find((c) => c.selector.endsWith(`#${id}`) || c.selector === `#${id}`)
  const gsap = on("g")
  expect(gsap).toBeTruthy()
  expect(gsap.property).toContain("transform")
  expect(gsap.to.transform).toMatch(/300px/)
  expect(gsap.end - gsap.start).toBeGreaterThan(850)
  expect(gsap.end - gsap.start).toBeLessThan(1150)
  expect(on("m")).toBeTruthy() // Motion's x
  expect(on("s")).toBeTruthy() // react-spring
  // One style change (a class or a state) is not motion.
  expect(clips.every((c) => c.end - c.start > 30)).toBe(true)
  expect(h.errors).toEqual([])
})

test("an element.animate() clip keeps where it was called (its stack, for the note's `defined`)", async ({ page }) => {
  const h = await openDock(page, `http://localhost:${PORTS.react}/`)
  await h.record()
  await page.waitForTimeout(300)
  await h.click("#nav-anim")
  await page.waitForTimeout(500)
  await h.click("#go")
  await page.waitForTimeout(600)
  await h.pause()
  const waapi = (await h.rt(() => __retake.timeline())).clips.filter((c) => c.kind === "waapi")
  expect(waapi.length).toBeGreaterThan(0)
  for (const c of waapi) {
    expect(Array.isArray(c.stack)).toBe(true)
    expect(c.stack[0]).toMatchObject({ url: expect.stringMatching(/^http/), line: expect.any(Number), col: expect.any(Number) })
  }
})

// The edit plan, checked in Chromium: the original animation and the plan
// (effect easing linear, edges as keyframes, sub-curves per piece) sampled
// every 20ms must agree.
const CASES = [
  {
    name: "element.animate() with one easing on the whole effect (offsets after it)",
    keyframes: [
      { offset: 0, easing: "linear", values: { transform: "translateX(0px)" } },
      { offset: 0.3, easing: "linear", values: { transform: "translateX(300px)" } },
      { offset: 0.6, easing: "linear", values: { transform: "translateX(300px) rotate(0deg)" } },
      { offset: 1, easing: "linear", values: { transform: "translateX(0px) rotate(90deg)" } },
    ],
    timing: { duration: 2000, delay: 0, easing: "ease-in-out", iterations: 1, direction: "normal", fill: "both" },
    range: [200, 400],
  },
  {
    name: "CSS keyframes with an easing per keyframe, a range across a keyframe",
    keyframes: [
      { offset: 0, easing: "ease-out", values: { opacity: "0", transform: "translateY(40px)" } },
      { offset: 0.4, easing: "ease-in-out", values: { opacity: "1", transform: "translateY(-6px)" } },
      { offset: 0.7, easing: "linear", values: { opacity: "1", transform: "translateY(2px)" } },
      { offset: 1, easing: "ease", values: { opacity: "1", transform: "translateY(0px)" } },
    ],
    timing: { duration: 1200, delay: 0, easing: "linear", iterations: 1, direction: "normal", fill: "both" },
    range: [300, 700],
  },
  {
    name: "an easing on the effect and on the keyframes (written as linear() stops)",
    keyframes: [
      { offset: 0, easing: "ease-in", values: { opacity: "0" } },
      { offset: 0.5, easing: "ease-out", values: { opacity: "1" } },
      { offset: 1, easing: "linear", values: { opacity: "0.2" } },
    ],
    timing: { duration: 1000, delay: 0, easing: "ease-out", iterations: 1, direction: "normal", fill: "both" },
    range: [250, 650],
  },
]

for (const c of CASES) {
  test(`exact edit keeps the motion: ${c.name}`, async ({ page }) => {
    await page.setContent(`<div id="a" style="width:40px;height:40px;background:red"></div><div id="b" style="width:40px;height:40px;background:blue"></div>`)
    const frames = (kf) => kf.map((k) => ({ offset: k.offset, easing: k.easing || "linear", ...k.values }))
    // The edges' values, read off the original (what the dock samples).
    const edgeValues = await page.evaluate(
      ([kf, timing, Ts]) => {
        const a = document.getElementById("a").animate(kf, { ...timing })
        a.pause()
        return Ts.map((t) => {
          a.currentTime = t
          const cs = getComputedStyle(document.getElementById("a"))
          return { transform: cs.transform, opacity: cs.opacity }
        })
      },
      [frames(c.keyframes), c.timing, c.range],
    )
    const props = Object.keys(c.keyframes[0].values)
    const pick = (v) => Object.fromEntries(props.map((p) => [p, v[p]]))
    const anim = { kind: "waapi", keyframes: c.keyframes, timing: { ...c.timing, start: 0, activeStart: 0 } }
    anim.from = { ...pointOf(anim, c.range[0]), values: pick(edgeValues[0]) }
    anim.to = { ...pointOf(anim, c.range[1]), values: pick(edgeValues[1]) }
    const stops = splitKeyframes(anim)
    expect(stops).toBeTruthy()
    const marked = stops.filter((s) => s.mark).map((s) => s.offset)
    expect(marked).toHaveLength(2)
    marked.forEach((o, i) => expect(o).toBeCloseTo(c.range[i] / c.timing.duration, 3))
    const plan = stops.map((s) => ({ offset: s.offset, easing: s.easing || "linear", ...s.values }))
    const diff = await page.evaluate(
      ([kf, plan, timing]) => {
        const a = document.getElementById("a").animate(kf, { ...timing })
        const b = document.getElementById("b").animate(plan, { ...timing, easing: "linear" })
        a.pause()
        b.pause()
        let worstPx = 0
        let worstOpacity = 0
        for (let t = 0; t <= timing.duration; t += 20) {
          a.currentTime = b.currentTime = t
          const ca = getComputedStyle(document.getElementById("a"))
          const cb = getComputedStyle(document.getElementById("b"))
          const ma = new DOMMatrix(ca.transform === "none" ? undefined : ca.transform)
          const mb = new DOMMatrix(cb.transform === "none" ? undefined : cb.transform)
          worstPx = Math.max(worstPx, Math.abs(ma.e - mb.e), Math.abs(ma.f - mb.f), Math.abs(ma.b - mb.b) * 100)
          worstOpacity = Math.max(worstOpacity, Math.abs(Number(ca.opacity) - Number(cb.opacity)))
        }
        return { worstPx, worstOpacity }
      },
      [frames(c.keyframes), plan, c.timing],
    )
    expect(diff.worstPx).toBeLessThan(0.6)
    expect(diff.worstOpacity).toBeLessThan(0.01)
  })
}

// A CSS transition's exact edit: its timing function as linear() stops with
// the note's range edges as stops of their own must move exactly as before.
test("exact edit keeps the motion: a CSS transition written as linear() stops", async ({ page }) => {
  const { editPlan } = await import("../../src/note-text.js")
  const a = { kind: "css-transition", name: "transform transition", timing: { duration: 400, delay: 0, easing: "ease-out", iterations: 1, start: 0, activeStart: 0 }, keyframes: [{ offset: 0, values: { transform: "translateY(24px)" } }, { offset: 1, values: { transform: "none" } }] }
  a.from = { ...pointOf(a, 300), values: { transform: "matrix(1, 0, 0, 1, 0, 2.2)" } }
  a.to = { ...pointOf(a, 400), values: { transform: "none" } }
  const text = editPlan(a).join("\n")
  const fn = /(linear\(0 [^)]*\))/.exec(text)[1]
  expect(text).toMatch(/0\.906\d* 75%/)
  await page.setContent(`<div id="a" style="width:40px;height:40px"></div><div id="b" style="width:40px;height:40px"></div>`)
  const worst = await page.evaluate((fn) => {
    const kf = [{ transform: "translateY(24px)" }, { transform: "none" }]
    const x = document.getElementById("a").animate(kf, { duration: 400, easing: "ease-out" })
    const y = document.getElementById("b").animate(kf, { duration: 400, easing: fn })
    x.pause()
    y.pause()
    let w = 0
    for (let t = 0; t <= 400; t += 10) {
      x.currentTime = y.currentTime = t
      w = Math.max(w, Math.abs(new DOMMatrix(getComputedStyle(document.getElementById("a")).transform).f - new DOMMatrix(getComputedStyle(document.getElementById("b")).transform).f))
    }
    return w
  }, fn)
  expect(worst).toBeLessThan(0.15)
})

// Motion keyframes with a plateau (x: [0, 120, 120, 240], times): one js clip
// across the hold (nothing is written while x stays at 120), and the note's
// animation read off the motion element's props: every keyframe, times and the
// ease of each segment, so the exact edit is in Motion's own terms.
test("Motion keyframes: one clip across the hold, and the note has its keyframes, times and eases", async ({ page }) => {
  const h = await openDock(page, `http://localhost:${PORTS.react}/`)
  await h.record()
  await page.waitForTimeout(300)
  await h.click("#nav-anim")
  await page.waitForTimeout(500)
  await h.click("#go")
  await page.waitForTimeout(1700)
  await h.pause()
  await page.waitForTimeout(300)
  const clips = (await h.rt(() => __retake.timeline())).clips.filter((c) => c.kind === "js" && /#mk$/.test(c.selector))
  expect(clips).toHaveLength(1)
  const c = clips[0]
  expect(c.end - c.start).toBeGreaterThan(1100)
  expect(c.end - c.start).toBeLessThan(1260)
  expect(c.holds && c.holds.length).toBe(1)
  // A note in the hold, on the element's row.
  await h.seek(c.start + 500)
  const b = await h.box("#mk")
  await page.keyboard.down("Meta")
  await page.mouse.move(b.x + b.w / 2 - 2, b.y + b.h / 2)
  await page.mouse.click(b.x + b.w / 2, b.y + b.h / 2)
  await page.keyboard.up("Meta")
  await page.locator("#wb-note textarea").waitFor({ state: "visible" })
  await page.locator("#wb-note textarea").fill("bob up here")
  await page.locator("#wb-note textarea").press("Enter")
  const n = await page.evaluate(() => JSON.parse(JSON.stringify(window.__retakeDock.state.notes.at(-1), (k, v) => (k === "el" ? undefined : v))))
  const a = n.anims[0]
  expect(a.motionKeyframes).toBe(true)
  expect(a.keyframes.map((k) => k.offset)).toEqual([0, 0.3, 0.6, 1])
  expect(a.keyframes.map((k) => k.values.x)).toEqual(["0", "120", "120", "240"])
  expect(a.keyframes[0].easing).toBe("cubic-bezier(0.42, 0, 0.58, 1)")
  expect(a.timing).toMatchObject({ duration: 1200, easing: "linear" })
  expect(Number(a.at.values.x)).toBeCloseTo(120, 0)
  const text = await page.evaluate(() => window.__retakeDock.prompt(window.__retakeDock.state.notes.at(-1)))
  expect(text).toContain("Motion keyframes (x keyframes)")
  expect(text).toContain("Exact edit (Motion)")
  expect(text).toMatch(/times: \[0, 0\.3, 0\.\d+, 0\.6, 1\]/)
})
