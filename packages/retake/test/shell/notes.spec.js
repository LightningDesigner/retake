// M5: notes (F23, F24). Comment on the past; each note knows its moment, the
// clip it's in, the element and where it lives in the code.
import { test, expect } from "@playwright/test"
import { openDock, DOCK_URL, dock, recordSome, shot } from "./helpers.js"
import { fakeServer } from "./fake-server.js"
import { SHELL_PORTS } from "./servers.js"

const REACT_URL = `http://localhost:${SHELL_PORTS.reactNotes}/`

// Rewind to `ms` after the first #toggle-like click (mid-transition).
async function intoFirstClick(h, ms) {
  const tl = await h.rt(() => __wayback.timeline())
  const click = tl.markers.find((m) => m.kind === "click")
  await h.seek(click.t + ms)
  await h.page.waitForTimeout(250)
  return click
}

async function noteOn(h, sel, text, how = "meta") {
  const { page } = h
  if (how === "meta") await page.keyboard.down("Meta")
  else await page.locator('[data-tool="comment"]').click()
  await expect(page.locator("#wb-shield")).toBeHidden()
  const b = await h.box(sel)
  await page.mouse.move(b.x + b.w / 2, b.y + b.h / 2)
  await page.mouse.click(b.x + b.w / 2, b.y + b.h / 2)
  if (how === "meta") await page.keyboard.up("Meta")
  const ta = page.locator("#wb-note textarea")
  await expect(ta).toBeVisible()
  await ta.fill(text)
  await ta.press("Enter")
  await expect(page.locator("#wb-note")).toBeHidden()
  return dock(page, (D) => D.notes[D.notes.length - 1])
}

test("⌘-click in the past: the note keeps its moment, clip + offset, element, and copies as a prompt", async ({ page }) => {
  const h = await openDock(page, DOCK_URL)
  await recordSome(h, ["#toggle"])
  await h.pause()
  const click = await intoFirstClick(h, 140)
  const n = await noteOn(h, "#card", "Make this slide slower")
  expect(n.branchId).toBe(1)
  expect(n.t).toBeGreaterThan(click.t + 100)
  expect(n.el.selector).toBe("#card")
  expect(n.el.classes).toEqual(["card", "primary-card", "off"])
  expect(n.el.styles).toHaveProperty("border-radius", "8px")
  expect(n.clip).toBeTruthy()
  expect(n.clip.offset).toBeGreaterThan(100)
  expect(n.clip.offset).toBeLessThan(200)
  expect(n.clip.duration).toBeGreaterThanOrEqual(300)

  // A pin on the app and a bubble on the timeline.
  await expect(page.locator(".canvas-pin")).toHaveCount(1)
  await expect.poll(() => dock(page, (D) => D.scene.notes.length)).toBe(1)

  const p = await page.evaluate(() => window.__waybackDock.prompt(window.__waybackDock.state.notes[0]))
  expect(p).toContain("## Make this slide slower")
  expect(p).toContain("Selector: #card")
  expect(p).toContain("Classes: card primary-card off")
  expect(p).toMatch(/Computed: .*border-radius: 8px/)
  expect(p).toMatch(/Moment: 00:00\.\d\d into the recording, \d+ms into a \d+ms /)
  expect(p).toContain('Timeline: "Timeline 1"')

  // Open it from the pin: the card shows the note and its clip.
  await page.locator(".canvas-pin").click()
  await expect(page.locator("#wb-note")).toContainText("Make this slide slower")
  await expect(page.locator("#wb-note .note-clip")).toContainText(/\d+(ms|\.\ds) into /)
  await expect(page.locator("#wb-note")).toBeVisible()
  await page.waitForTimeout(250)
  const cb = await page.locator("#wb-note").boundingBox()
  expect(cb.y + cb.height).toBeLessThan(800)
  await shot(page, "notes.png")
  expect(h.dockErrors).toEqual([])
})

test("F23: selectors are escaped for ids like :r1: and 1st", async ({ page }) => {
  const h = await openDock(page, DOCK_URL)
  await recordSome(h, ["#toggle"])
  await h.pause()
  await intoFirstClick(h, 50)
  const a = await noteOn(h, "[id=':r1:']", "useId box", "tool")
  expect(a.el.selector).toBe("#\\:r1\\:")
  const b = await noteOn(h, "[id='1st']", "digit id", "tool")
  expect(b.el.selector).toBe("#\\31 st")
  // Both resolve in the app.
  expect(await h.rt((sels) => sels.map((s) => !!document.querySelector(s)), [a.el.selector, b.el.selector])).toEqual([true, true])
  // So their pins sit on the elements, not on stale rects.
  await expect(page.locator(".canvas-pin")).toHaveCount(2)
})

test("F23: React components through memo/forwardRef, with source file:line", async ({ page }) => {
  const h = await openDock(page, REACT_URL)
  await recordSome(h, ["#fancy"])
  await h.pause()
  await intoFirstClick(h, 120)
  const n = await noteOn(h, "#fancy", "Less saturated")
  expect(n.el.components[0]).toBe("FancyButton")
  expect(n.el.components).toContain("App")
  expect(n.el.source).toBeTruthy()
  expect(n.el.source.file).toMatch(/\/src\/main\.jsx$/)
  expect(n.el.source.line).toBeGreaterThan(3)
  expect(n.el.source.line).toBeLessThan(12)
  const p = await page.evaluate(() => window.__waybackDock.prompt(window.__waybackDock.state.notes[0]))
  expect(p).toContain("Component: FancyButton")
  expect(p).toMatch(/Source: \/src\/main\.jsx:\d+/)
  expect(p).toContain("Classes: btn primary")
  // The useId label gets a valid selector too.
  const f = await noteOn(h, "label.field", "Field")
  expect(await h.rt((s) => !!document.querySelector(s), f.el.selector)).toBe(true)
  expect(f.el.components[0]).toBe("Field")
  expect(h.dockErrors).toEqual([])
})

test("agent replies show inline; the list shows this timeline's notes", async ({ page }) => {
  const store = {
    session: {
      branches: [{ id: 1, parentId: null, forkAt: 0, name: "Timeline 1", codeVersion: null, end: 0 }],
      activeId: 1,
      markers: [],
      notes: [{ id: "n7", branchId: 1, t: 30, clip: null, selector: "#card", component: null, source: null, classes: ["card"], rect: { x: 24, y: 100, w: 160, h: 60 }, text: "Rounder corners", status: "pending", replies: [] }],
    },
    recordings: {},
  }
  await fakeServer(page, { store, events: [{ type: "note-updated", data: { id: "n7", status: "acknowledged", replies: [{ from: "agent", text: "Changed radius to 16px in main.css", at: 1 }] } }] })
  const h = await openDock(page, DOCK_URL)
  await expect.poll(() => dock(page, (D) => D.notes[0] && D.notes[0].status)).toBe("acknowledged")
  await page.locator('[data-a="notes"]').click()
  await expect(page.locator("#wb-list .list-row")).toHaveCount(1)
  await expect(page.locator("#wb-list")).toContainText("Rounder corners")
  await expect(page.locator("#wb-list")).toContainText(/acknowledged/i)
  await page.locator("#wb-list .list-row").click()
  await expect(page.locator("#wb-note .reply.agent")).toContainText("Changed radius to 16px")
  await expect(page.locator("#wb-note .status")).toHaveText(/acknowledged/i)
  expect(h.dockErrors).toEqual([])
})

test("a note on an icon lands on its button, not the svg path inside it", async ({ page }) => {
  const h = await openDock(page, DOCK_URL)
  await recordSome(h, ["#toggle"])
  await h.pause()
  await intoFirstClick(h, 50)
  const n = await noteOn(h, "#like path", "Bigger heart", "tool")
  expect(n.el.selector).toBe("#like")
  expect(n.el.label).toBe("<button#like>")
})

test("source lines are the original lines (source-mapped), components skip library internals, long transitions are summarised", async ({ page }) => {
  const fs = await import("node:fs")
  const path = await import("node:path")
  const file = fs.readFileSync(path.resolve("test/shell/fixtures/react-notes/src/Shifted.tsx"), "utf8").split("\n")
  const buttonLine = file.findIndex((l) => l.includes('id="shifted"')) // 0-based index of the id line = 1-based line of <button
  const h = await openDock(page, REACT_URL)
  await recordSome(h, ["#fancy"])
  await h.pause()
  await intoFirstClick(h, 120)
  await noteOn(h, "#shifted", "Rounder")
  await expect.poll(() => dock(page, (D) => D.notes[D.notes.length - 1].el.source && D.notes[D.notes.length - 1].el.source.mapped)).toBe(true)
  const n = await dock(page, (D) => D.notes[D.notes.length - 1])
  expect(n.el.source.file).toMatch(/\/src\/Shifted\.tsx$/)
  expect([buttonLine, buttonLine + 1]).toContain(n.el.source.line)
  // ...which the served file has somewhere else, so the mapping mattered.
  const served = (await (await page.request.get(REACT_URL + "src/Shifted.tsx")).text()).split("\n")
  const servedLine = served.findIndex((l) => /id:\s*"shifted"/.test(l)) + 1
  expect(servedLine).toBeGreaterThan(0)
  expect(Math.abs(servedLine - n.el.source.line)).toBeGreaterThan(50)
  expect(n.el.components[0]).toBe("Shifted")
  expect(n.el.components.join(" ")).not.toMatch(/PopChild|PresenceChild|AnimatePresence/)
  expect(n.el.styles.transition.length).toBeLessThan(80)
  expect(n.el.styles.transition).toContain("10 properties")
  expect(n.el.styles.transition).toContain("0.15s")
  const p = await page.evaluate(() => { const d = window.__waybackDock; return d.prompt(d.state.notes[d.state.notes.length - 1]) })
  expect(p).toContain(`Source: /src/Shifted.tsx:${n.el.source.line}`)
  expect(h.dockErrors).toEqual([])
})

test("pins for another moment are dimmed, and clicking one goes to its note's moment", async ({ page }) => {
  const h = await openDock(page, DOCK_URL)
  await recordSome(h, ["#toggle", "#toggle"])
  await h.pause()
  await intoFirstClick(h, 140)
  const n = await noteOn(h, "#card", "Slower")
  await expect(page.locator(".canvas-pin")).not.toHaveClass(/away/)
  const s = await h.state()
  await h.seek(s.end - 20)
  await expect(page.locator(".canvas-pin")).toHaveClass(/away/)
  await page.locator(".canvas-pin").click()
  await expect.poll(async () => Math.abs((await h.state().catch(() => ({ now: -1e9 }))).now - n.t), { timeout: 15000 }).toBeLessThan(20)
  await expect(page.locator("#wb-note")).toContainText("Slower")
  await expect(page.locator(".canvas-pin")).not.toHaveClass(/away/)
})

// S4 (Sherpa): a note on something that isn't animating mustn't borrow a clip
// from elsewhere on the page (Sherpa's notes on a still button came out as
// "5550ms into … fm-note-rise on …svg", the floating music notes).
test("a note on a still element has no clip, even while something else animates", async ({ page }) => {
  const h = await openDock(page, DOCK_URL)
  await recordSome(h, ["#toggle"])
  await h.pause()
  await intoFirstClick(h, 140) // #card is mid-transition here
  const n = await noteOn(h, "#count", "Bigger number")
  expect(n.el.selector).toBe("#count")
  expect(n.clip).toBeNull()
  const p = await page.evaluate(() => window.__waybackDock.prompt(window.__waybackDock.state.notes[0]))
  expect(p).toMatch(/Moment: 00:00\.\d\d into the recording, nothing animating/)
  // The animating element itself still gets its clip.
  const m = await noteOn(h, "#card", "Slower")
  expect(m.clip && m.clip.selector).toBe("#card")
})
