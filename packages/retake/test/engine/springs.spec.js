// Motion springs (the real `motion` package, test/fixtures/spring copied to the
// OS temp dir and installed there, frameworks.js). A spring has no keyframes
// in time, so the note reads what the component wrote (type, stiffness,
// damping, mass, bounce, visualDuration / duration...), runs the same curve
// as Motion and gives its overshoot, swings and settle time, the value at the
// note's moment, and exact numbers for "less bouncy", "slower" and "faster".
// The curve must agree with what Motion wrote frame by frame, and with when
// it stopped. Port 3355.
import { spawn } from "node:child_process"
import { test, expect } from "@playwright/test"
import { openDock } from "./helpers.js"
import { BIN } from "./servers.js"
import { fixtureDir, startFramework } from "./frameworks.js"
import { springCurve } from "../../src/note-text.js"

const PORT = 3355
const FRAME = 1000 / 60
let fw = null
test.describe.configure({ mode: "serial" })
test.beforeAll(async () => {
  test.setTimeout(300_000)
  const dir = fixtureDir("spring")
  test.skip(!dir, "the spring fixture's dependencies couldn't be installed")
  fw = await startFramework("spring", PORT, { dir })
})
test.afterAll(async () => {
  if (fw) await fw.stop()
})

// Record a press of #go and the springs it starts; returns the js clips by element id.
async function recordSprings(page) {
  const h = await openDock(page, fw.url + "/")
  await h.record()
  await page.waitForTimeout(400)
  await h.click("#go")
  await page.waitForTimeout(2200)
  await h.pause()
  await page.waitForTimeout(300)
  const clips = (await h.rt(() => __retake.timeline())).clips.filter((c) => c.kind === "js")
  const on = (id) => clips.find((c) => new RegExp(`#${id}$`).test(c.selector || ""))
  return { h, on }
}

async function noteOn(h, sel, t, text) {
  const page = h.page
  await h.seek(t)
  const b = await h.box(sel)
  await page.keyboard.down("Meta")
  await page.mouse.move(b.x + b.w / 2 - 2, b.y + b.h / 2)
  await page.mouse.click(b.x + b.w / 2, b.y + b.h / 2)
  await page.keyboard.up("Meta")
  await page.locator("#wb-note textarea").waitFor({ state: "visible" })
  await page.locator("#wb-note textarea").fill(text)
  await page.locator("#wb-note textarea").press("Enter")
  await page.locator("#wb-note").waitFor({ state: "hidden" })
  const note = await page.evaluate(() => JSON.parse(JSON.stringify(window.__retakeDock.state.notes.at(-1), (k, v) => (k === "el" ? undefined : v))))
  const prompt = await page.evaluate(() => window.__retakeDock.prompt(window.__retakeDock.state.notes.at(-1)))
  return { note, prompt }
}

// The x (or y) Motion has on the element in the moment on show.
const shownValue = (h, sel, axis = "x") =>
  h.rt(
    ([sel, axis]) => {
      const m = new DOMMatrix(getComputedStyle(document.querySelector(sel)).transform)
      return axis === "x" ? m.e : m.f
    },
    [sel, axis],
  )

test("a physics spring (stiffness, damping): its parameters, overshoot, swings and settle time, and the value at the note's moment", async ({ page }) => {
  const { h, on } = await recordSprings(page)
  const c = on("physics")
  expect(c).toBeTruthy()
  const t = c.start + 150
  const { note, prompt } = await noteOn(h, "#physics", t, "less bouncy")
  const a = note.anims[0]
  expect(a.lib).toBe("motion")
  expect(a.spring).toBeTruthy()
  const s = a.spring
  expect(s.written).toMatchObject({ type: "spring", stiffness: 300, damping: 10 })
  expect(s.source).toBe("transition")
  expect(s.key).toBe("x")
  expect(s.from).toBe(0)
  expect(s.to).toBe(300)
  // ζ = 10 / (2√300) = 0.289: from rest it overshoots e^(-πζ/√(1-ζ²)) = 38.8% at π/ωd = 189ms.
  expect(s.dampingRatio).toBeCloseTo(0.289, 2)
  expect(s.overshoot.pct).toBeGreaterThan(37.5)
  expect(s.overshoot.pct).toBeLessThan(40)
  expect(s.overshoot.atMs).toBeGreaterThan(180)
  expect(s.overshoot.atMs).toBeLessThan(200)
  expect(s.oscillations).toBeGreaterThanOrEqual(3)
  // Motion stopped writing when the spring came to rest: the settle time is the clip's length from local 0.
  expect(Math.abs(s.settleMs - (c.end - a.timing.activeStart))).toBeLessThan(2.5 * FRAME)
  // The value at the note's moment is the one Motion had on the element then.
  expect(Math.abs(Number(a.at.values.x) - (await shownValue(h, "#physics")))).toBeLessThan(1.5)
  expect(prompt).toContain("Motion spring (x)")
  expect(prompt).toMatch(/spring: stiffness 300, damping 10/)
  expect(prompt).toMatch(/overshoots 3[89](\.\d)?% \(x 41\d(\.\d)? at 1[89]\dms\)/)
  expect(prompt).toMatch(/settles at \d+ms/)
  // "less bouncy": damping numbers that take most of the overshoot away, with the end value kept.
  const m = /Intent: "less bouncy"[^\n]*damping 10 → (\d+(?:\.\d+)?)/.exec(prompt)
  expect(m, prompt).toBeTruthy()
  const sim = springCurve({ type: "spring", stiffness: 300, damping: Number(m[1]) }, 0, 300)
  expect(sim.overshoot ? sim.overshoot.pct : 0).toBeLessThan(s.overshoot.pct / 4)
  expect(prompt).toMatch(/critically damped/)
  expect(prompt).toMatch(/keep animate's x \(300\)|end value \(x 300\) stays/)
  expect(prompt).toContain("Exact edit (Motion spring → keyframes)")
  expect(h.errors).toEqual([])
  if (process.env.SPRING_PRINT) console.log(prompt, "\n\n", JSON.stringify(a, null, 1))
})

test("the curve is the one Motion ran: values at every frame match what it wrote", async ({ page }) => {
  const { h, on } = await recordSprings(page)
  const c = on("physics")
  const { note } = await noteOn(h, "#physics", c.start + 60, "check")
  const a = note.anims[0]
  const curve = springCurve(a.spring.written, a.spring.from, a.spring.to)
  let worst = 0
  for (const local of [30, 90, 150, 190, 260, 340, 450, 600]) {
    await h.seek(a.timing.activeStart + local)
    const seen = await shownValue(h, "#physics")
    // The moment on show is the frame at or before that time.
    const lo = curve.at(local - FRAME)
    const hi = curve.at(local)
    const err = seen >= Math.min(lo, hi) - 1 && seen <= Math.max(lo, hi) + 1 ? 0 : Math.min(Math.abs(seen - lo), Math.abs(seen - hi))
    worst = Math.max(worst, err)
  }
  expect(worst).toBeLessThan(1.5)
})

test("visualDuration + bounce, duration + bounce, and Motion's default spring for x", async ({ page }) => {
  const { h, on } = await recordSprings(page)
  const cv = on("visual")
  const v = (await noteOn(h, "#visual", cv.start + 100, "faster")).note.anims[0]
  expect(v.spring.written).toMatchObject({ type: "spring", visualDuration: 0.5, bounce: 0.45 })
  expect(v.spring.key).toBe("y")
  expect(v.spring.to).toBe(120)
  expect(Math.abs(v.spring.settleMs - (cv.end - v.timing.activeStart))).toBeLessThan(2.5 * FRAME)
  const cd = on("dur")
  const { note: dn, prompt: dp } = await noteOn(h, "#dur", cd.start + 100, "slower")
  const d = dn.anims[0]
  expect(d.spring.written).toMatchObject({ type: "spring", duration: 0.8, bounce: 0.35 })
  // A duration-based spring stops at its duration.
  expect(Math.abs(d.spring.settleMs - 800)).toBeLessThan(FRAME)
  expect(Math.abs(cd.end - d.timing.activeStart - 800)).toBeLessThan(2.5 * FRAME)
  expect(dp).toMatch(/Intent: "slower"[^\n]*duration 0\.8 → 1\.2/)
  const c0 = on("default")
  const { note: n0, prompt: p0 } = await noteOn(h, "#default", c0.start + 80, "too bouncy")
  const z = n0.anims[0]
  expect(z.spring.source).toBe("default")
  expect(z.spring.written).toBeNull()
  expect(z.spring.stiffness).toBe(500)
  expect(z.spring.damping).toBe(25)
  expect(Math.abs(z.spring.settleMs - (c0.end - z.timing.activeStart))).toBeLessThan(2.5 * FRAME)
  expect(p0).toMatch(/Motion's default spring for x/)
  expect(p0).toMatch(/transition=\{\{ x: \{ type: "spring", stiffness: 500, damping: \d+/)
  // A tween is not a spring.
  const ct = on("tween")
  const tw = (await noteOn(h, "#tween", ct.start + 100, "x")).note.anims[0]
  expect(tw.spring).toBeUndefined()
  expect(h.errors).toEqual([])
})

// A drag on the open clip's row: the range on the simulated curve, with the peaks inside it.
test("a range note on a spring maps the range to the curve", async ({ page }) => {
  const { h, on } = await recordSprings(page)
  const c = on("physics")
  await h.seek(c.start + 120)
  const b = await h.box("#physics")
  await page.keyboard.down("Meta")
  await page.mouse.move(b.x + b.w / 2 - 2, b.y + b.h / 2)
  await page.mouse.click(b.x + b.w / 2, b.y + b.h / 2)
  await page.keyboard.up("Meta")
  await page.locator("#wb-note textarea").waitFor({ state: "visible" })
  await page.waitForFunction(() => window.__retakeDock.state.scene && window.__retakeDock.state.scene.focus)
  const ev = (fn, arg) => page.evaluate(`(${fn})(window.__retakeDock.state, ${JSON.stringify(arg ?? null)})`)
  const cap = await ev((D, id) => {
    const r = document.querySelector(".lines").getBoundingClientRect()
    const x = D.scene.focus.capsules.find((k) => k.clip.id === id)
    return x && { x: r.left + Math.max(x.x0 + 3, Math.min((x.x0 + x.x1) / 2, r.width - 40)), y: r.top + x.y }
  }, c.id)
  await page.mouse.click(cap.x, cap.y)
  await page.waitForFunction(() => window.__retakeDock.state.scene.focus && window.__retakeDock.state.scene.focus.open)
  await page.waitForTimeout(500)
  const as = await ev((D) => D.focus.open.model.timing.activeStart)
  const pt = (t) =>
    ev((D, t) => {
      const r = document.querySelector(".lines").getBoundingClientRect()
      const f = D.scene.focus
      return { x: r.left + 12 + ((t - D.view.from) / (D.view.to - D.view.from)) * (r.width - 30), y: r.top + f.y0 + f.h * 0.6 }
    }, t)
  const q0 = await pt(as + 100)
  const q1 = await pt(as + 300)
  await page.mouse.move(q0.x, q0.y)
  await page.mouse.down()
  await page.mouse.move((q0.x + q1.x) / 2, q0.y, { steps: 5 })
  await page.mouse.move(q1.x, q1.y, { steps: 5 })
  await page.mouse.up()
  await page.waitForTimeout(400)
  await page.locator("#wb-note textarea").fill("less bouncy here")
  await page.locator("#wb-note textarea").press("Enter")
  await page.locator("#wb-note").waitFor({ state: "hidden" })
  const note = await page.evaluate(() => JSON.parse(JSON.stringify(window.__retakeDock.state.notes.at(-1), (k, v) => (k === "el" ? undefined : v))))
  const prompt = await page.evaluate(() => window.__retakeDock.prompt(window.__retakeDock.state.notes.at(-1)))
  const a = note.anims[0]
  expect(a.spring).toBeTruthy()
  const curve = springCurve(a.spring.written, 0, 300)
  expect(Math.abs(Number(a.from.values.x) - curve.at(a.from.local))).toBeLessThan(0.6)
  expect(Math.abs(Number(a.to.values.x) - curve.at(a.to.local))).toBeLessThan(0.6)
  expect(prompt).toMatch(/Range: local \d+ms → \d+ms on the spring's curve: x [\d.]+ → [\d.]+/)
  expect(prompt).toMatch(/peak 1 at 1[89]\dms \(x 41\d/)
  // The way to change only that part: keyframes, with the range edges marked.
  expect(prompt).toContain("Exact edit (Motion spring → keyframes)")
  expect(prompt).toMatch(/marked: index \d+ = the range's start/)
})

test("MCP get_animation explains a spring note in spring terms", async ({ page }) => {
  const { h, on } = await recordSprings(page)
  const c = on("physics")
  await noteOn(h, "#physics", c.start + 150, "less bouncy")
  const child = spawn(process.execPath, [BIN, "mcp", "--url", fw.url], { stdio: ["pipe", "pipe", "pipe"] })
  let buf = ""
  const waiting = new Map()
  child.stdout.setEncoding("utf8")
  child.stdout.on("data", (d) => {
    buf += d
    let i
    while ((i = buf.indexOf("\n")) >= 0) {
      const msg = JSON.parse(buf.slice(0, i))
      buf = buf.slice(i + 1)
      waiting.get(msg.id)?.(msg)
    }
  })
  let seq = 0
  const tool = (name, args = {}) =>
    new Promise((resolve) => {
      const id = ++seq
      waiting.set(id, (m) => resolve(m.result.content[0].text))
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }) + "\n")
    })
  try {
    let list = ""
    for (let i = 0; i < 40; i++) {
      list = await tool("list_notes")
      if (/"count":\s*[1-9]/.test(list)) break
      await page.waitForTimeout(250)
    }
    const id = JSON.parse(list).notes[0].id
    const text = await tool("get_animation", { id })
    expect(text).toMatch(/spring: stiffness 300, damping 10/)
    expect(text).toMatch(/overshoots 3[89](\.\d)?%/)
    expect(text).toMatch(/local \d+ms, x [\d.]+ on the spring/)
    const note = await tool("get_note", { id })
    expect(note).toMatch(/Intent: "less bouncy"/)
  } finally {
    child.kill()
  }
})
