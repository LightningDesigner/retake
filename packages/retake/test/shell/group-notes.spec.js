// Notes on many animations at once, and which animation a note is about.
// - Primary clip: an element with a looping spin and 40 instant (0ms)
//   animations on it: the note is about the spin; the instant ones collapse
//   into one "Also running" line with their count.
// - Repeats: one @keyframes started three times on the element is one entry
//   with its runs, not three.
// - Exact edit: labelled for point/range changes; broad requests ("slower",
//   "start earlier") get a one-line hint instead of pasting it.
// - Group notes: a container whose children each run their own animation
//   (an equalizer's five bars): "Whole group" on its row makes one note with
//   every child's animation, its local time and its own exact edit, plus a
//   shortcut when several share one @keyframes. Port 3358.
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { test, expect } from "@playwright/test"
import { createServer } from "vite"
import { retake } from "../../src/plugin.js"
import { dock, openDock, shot } from "./helpers.js"
import { metaClick } from "./anim-fixture.js"

const PORT = 3358
const URL = `http://localhost:${PORT}/`
const here = path.dirname(fileURLToPath(import.meta.url))
let server
test.beforeAll(async () => {
  const root = path.join(here, "fixtures/group-app")
  server = await createServer({
    root,
    configFile: path.join(root, "vite.config.js"),
    logLevel: "silent",
    cacheDir: path.join(os.tmpdir(), `retake-group-app-vite-${PORT}`),
    plugins: [retake({ banner: false })],
    server: { port: PORT, strictPort: true, host: "localhost" },
  })
  await server.listen()
})
test.afterAll(async () => {
  await server?.close()
})

const lastNote = (page) => dock(page, (D) => JSON.parse(JSON.stringify(D.notes[D.notes.length - 1], (k, v) => (k === "el" ? undefined : v))))
const promptOfLast = (page) => page.evaluate(() => window.__retakeDock.prompt(window.__retakeDock.state.notes.at(-1)))

async function record(page, steps) {
  const h = await openDock(page, URL)
  await h.record()
  await page.waitForTimeout(300)
  for (const [sel, wait] of steps) {
    await h.click(sel)
    await page.waitForTimeout(wait)
  }
  await h.pause()
  await page.waitForTimeout(300)
  const tl = await h.rt(() => __retake.timeline())
  return { h, tl }
}

async function save(page, text) {
  await page.waitForTimeout(200)
  const ta = page.locator("#wb-note textarea")
  await ta.fill(text)
  await ta.press("Enter")
  await expect(page.locator("#wb-note")).toBeHidden()
}

test("primary clip: the looping spin, not one of 40 instant (0ms) animations; they collapse to one line", async ({ page }) => {
  const { h, tl } = await record(page, [["#go", 600], ["#jitter", 700]])
  const spin = tl.clips.find((c) => c.label === "spin")
  const instant = tl.clips.filter((c) => /disc/.test(c.selector || "") && c.kind === "waapi")
  expect(spin).toBeTruthy()
  expect(instant.length).toBeGreaterThanOrEqual(40)
  // At the moment the instant ones ran: each of them "runs" then.
  await h.seek(instant[0].start)
  await metaClick(h, "#disc")
  await save(page, "make it slower")
  const n = await lastNote(page)
  expect(n.anims[0].name).toBe("spin")
  expect(n.anims[0].primary).toBe(true)
  // The instant ones are one entry with their runs, not two more of them.
  const others = n.anims.slice(1)
  expect(others.length).toBeLessThanOrEqual(1)
  if (others.length) expect(others[0].runs.length).toBeGreaterThanOrEqual(40)
  const text = await promptOfLast(page)
  expect(text).toContain("Animation: @keyframes spin on this element")
  expect(text).toMatch(/Also running: .*×4\d \(instant: 0ms each/)
  // A broad request: the hint says what to change, and the exact edit is labelled.
  expect(text).toMatch(/Intent: "slower" reads as a change to the whole animation's timing/)
  expect(text).toContain("lengthen its duration (4000ms now)")
  expect(h.dockErrors).toEqual([])
})

test("one @keyframes started three times on an element: one entry with its runs", async ({ page }) => {
  const { h, tl } = await record(page, [["#again", 1400]])
  const runs = tl.clips.filter((c) => c.label === "pulse")
  expect(runs).toHaveLength(3)
  // A range of recording time over all three runs (Shift+drag), then the element.
  const from = runs[0].start + 50
  const to = runs[2].start + 300
  const pt = (t) =>
    dock(page, (D, t) => {
      const r = document.querySelector(".lines").getBoundingClientRect()
      return { x: r.left + 12 + ((t - D.view.from) / (D.view.to - D.view.from)) * (r.width - 30), y: r.top + D.lanes.get(D.activeId).y }
    }, t)
  const a = await pt(from)
  const b = await pt(to)
  await page.keyboard.down("Shift")
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  await page.mouse.move(b.x, a.y, { steps: 6 })
  await page.mouse.up()
  await page.keyboard.up("Shift")
  await expect.poll(() => dock(page, (D) => !!D.range)).toBe(true)
  await page.waitForTimeout(400)
  await metaClick(h, "#pulse")
  await save(page, "start this earlier")
  const n = await lastNote(page)
  const pulses = n.anims.filter((x) => x.name === "pulse")
  expect(pulses).toHaveLength(1)
  expect(pulses[0].runs).toHaveLength(3)
  const text = await promptOfLast(page)
  expect(text).not.toContain("Also running: @keyframes pulse")
  expect(text).toMatch(/ran 3 times on this element: 00:\d\d\.\d\d, 00:\d\d\.\d\d, 00:\d\d\.\d\d/)
  expect(text).toMatch(/Intent: "earlier" reads as a change to when it starts/)
  expect(h.dockErrors).toEqual([])
})

test("group note: Whole group on the equalizer's row, one note with each bar's animation and exact edit", async ({ page }) => {
  const { h, tl } = await record(page, [["#go", 1800]])
  const bars = tl.clips.filter((c) => /^#eq > .*\.bar/.test(c.selector || ""))
  expect(bars.length).toBe(5)
  const go = Math.min(...bars.map((c) => c.start))
  await h.seek(go + 1000)
  // The container itself (its padding, right of the bars).
  await metaClick(h, "#eq", { x: 0.93, y: 0.2 })
  expect(await dock(page, (D) => D.focus.label)).toBe("<div#eq>")
  // Its row offers the whole group.
  await expect.poll(() => dock(page, (D) => D.scene.focus && D.scene.focus.groupChip && D.scene.focus.groupChip.count)).toBe(5)
  const chip = await dock(page, (D) => {
    const r = document.querySelector(".lines").getBoundingClientRect()
    const c = D.scene.focus.groupChip
    return { x: r.left + (c.x0 + c.x1) / 2, y: r.top + c.y }
  })
  await page.mouse.click(chip.x, chip.y)
  await expect.poll(() => dock(page, (D) => D.scene.focus.group && D.scene.focus.group.lanes)).toBe(5)
  // A drag on the row: a range of recording time, for every bar on its own clock.
  const pt = (t) =>
    dock(page, (D, t) => {
      const r = document.querySelector(".lines").getBoundingClientRect()
      const f = D.scene.focus
      return { x: r.left + 12 + ((t - D.view.from) / (D.view.to - D.view.from)) * (r.width - 30), y: r.top + f.y0 + f.h * 0.6 }
    }, t)
  const p0 = await pt(go + 1000)
  const p1 = await pt(go + 1200)
  await page.mouse.move(p0.x, p0.y)
  await page.mouse.down()
  await page.mouse.move(p1.x, p0.y, { steps: 6 })
  await page.mouse.up()
  await expect.poll(() => dock(page, (D) => !!(D.focus.range && D.scene.focus.band))).toBe(true)
  await expect(page.locator("#wb-note .note-at")).toContainText(/5 animations inside <div#eq>/)
  await shot(page, "group-note-row.png")
  await save(page, "make the bars bounce higher here")
  const n = await lastNote(page)
  expect(n.range).toBeTruthy()
  expect(n.group).toBeTruthy()
  expect(n.group.members).toHaveLength(5)
  const names = n.group.members.map((m) => m.anim && m.anim.name)
  expect(names.slice(0, 3)).toEqual(["eq", "eq", "eq"])
  expect(names[3]).toBe("eq4")
  expect(n.group.members[4].anim.kind).toBe("waapi")
  // Each bar's range on its own clock: bars 1-3 share the keyframes but not the delay.
  const locals = n.group.members.slice(0, 3).map((m) => Math.round(m.anim.from.local))
  expect(new Set(locals).size).toBe(3)
  expect(n.group.members.every((m) => m.anim.from && m.anim.to)).toBe(true)
  expect(JSON.stringify(n).length).toBeLessThan(40000)
  const text = await promptOfLast(page)
  expect(text).toContain("Group: 5 animated elements inside <div#eq>")
  expect(text).toMatch(/Shared: @keyframes eq runs on 3 of them/)
  expect(text).toMatch(/### 1\. <span\.bar>/)
  expect(text).toMatch(/### 5\. <span\.bar>/)
  // One exact edit per bar (also where the range crosses the end of a bar's iteration), under one label.
  expect((text.match(/^Exact edit(:| \()/gm) || []).length).toBe(5)
  expect(text).toContain('Exact edits below: for "change it only here" requests.')
  expect(text).toContain("it repeats on every iteration")
  // The marked edge stops hold today's values: kept, so nothing outside the range moves (F139).
  expect(text).toContain("keep the marked stops as they are (they hold today's values at the range edges")
  // A bar whose range crosses the end of its iteration passes the keyframes at 100%/0% (F138).
  expect(text).toMatch(/keyframes? inside the range at [^;\n]*\b(0|1)\b[^;\n]*; it crosses the end of an iteration/)
  expect(text).not.toContain("Also inside the element (not this note's subject)")
  expect(h.dockErrors).toEqual([])

  // Shown again (its pin on the app), the note brings the group back on the row.
  expect(await dock(page, (D) => !!D.focus)).toBe(false)
  await expect(page.locator(".canvas-pin")).toHaveCount(1)
  await page.locator(".canvas-pin").click()
  await expect.poll(() => dock(page, (D) => !!(D.focus && D.focus.group && D.focus.range))).toBe(true)
  expect(h.dockErrors).toEqual([])
})

// F137: an animation whose first and last keyframes are alike (a loop that
// comes back to where it started, with stops in between) was taken for an
// instant one: the group left those bars out and a note on one wasn't about it.
test("F137: bars whose loops end where they start are motion: in the group, and a note's subject", async ({ page }) => {
  const { h, tl } = await record(page, [["#go", 1800]])
  const ups = tl.clips.filter((c) => /^up-/.test(c.label))
  expect(ups).toHaveLength(3)
  expect(ups.every((c) => c.kfs === 3)).toBe(true)
  await h.seek(Math.max(...ups.map((c) => c.start)) + 1000)
  await metaClick(h, "#eq2", { x: 0.93, y: 0.2 })
  await expect.poll(() => dock(page, (D) => D.scene.focus && D.scene.focus.groupChip && D.scene.focus.groupChip.count)).toBe(3)
  await page.keyboard.press("Escape")
  await expect(page.locator("#wb-note")).toBeHidden()
  await metaClick(h, "#eq2 .bar:nth-child(1)")
  await save(page, "taller")
  const n = await lastNote(page)
  expect(n.anims[0].name).toBe("up-a")
  expect(n.anims[0].instant).toBeFalsy()
  const text = await promptOfLast(page)
  expect(text).toContain("Animation: @keyframes up-a on this element")
  expect(h.dockErrors).toEqual([])
})

// F141: the Whole group chip was drawn on the canvas only: no key, no button.
// G (⌥G while typing the note) toggles it, the hint says so, and the chip is a
// button named with its count, pressed while on.
test("F141: G toggles Whole group on a focused container, announced; the chip is a button", async ({ page }) => {
  const { h, tl } = await record(page, [["#go", 1800]])
  const bars = tl.clips.filter((c) => /^#eq > .*\.bar/.test(c.selector || ""))
  await h.seek(Math.min(...bars.map((c) => c.start)) + 1000)
  await metaClick(h, "#eq", { x: 0.93, y: 0.2 })
  const ta = page.locator("#wb-note textarea")
  await expect(ta).toBeFocused()
  const lanes = () => dock(page, (D) => (D.focus.group ? D.focus.group.members.length : 0))
  await page.keyboard.press("Alt+KeyG")
  await expect.poll(lanes).toBe(5)
  await expect(page.locator(".hint")).toContainText("Whole group on · 5 animations")
  await expect(ta).toHaveValue("")
  const chip = page.getByRole("button", { name: "Whole group, 5 animations" })
  await expect(chip).toHaveAttribute("aria-pressed", "true")
  await page.keyboard.press("Alt+KeyG")
  await expect.poll(lanes).toBe(0)
  await expect(chip).toHaveAttribute("aria-pressed", "false")
  // Out of the note: plain G; Esc leaves the group, the note stays.
  await ta.evaluate((el) => el.blur())
  await page.keyboard.press("g")
  await expect.poll(lanes).toBe(5)
  await page.keyboard.press("Escape")
  await expect.poll(lanes).toBe(0)
  await expect(page.locator("#wb-note")).toBeVisible()
  // The button: Enter presses it.
  await chip.focus()
  await page.keyboard.press("Enter")
  await expect.poll(lanes).toBe(5)
  expect(h.dockErrors).toEqual([])
})
