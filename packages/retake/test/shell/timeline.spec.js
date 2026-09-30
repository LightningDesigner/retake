// The timeline (one canvas): ruler and zoom, the three layers on the active
// lane (actions, waveform, ⌘ lens), live follow, snapping, keys, readout, a
// view-only past, and drawing only when something changed. What's drawn is
// read from the dock's own record of its last draw (D.scene).
import { test, expect } from "@playwright/test"
import { openDock, DOCK_URL, dock, recordAndRewind, recordSome, xOfTime } from "./helpers.js"

const view = (page) => dock(page, (D) => ({ from: D.view.from, to: D.view.to, fit: D.view.fit, detached: D.view.detached }))
const laneY = (page) => dock(page, (D) => D.lanes.get(D.activeId).y + document.querySelector(".lines").getBoundingClientRect().top)
const scene = (page) => dock(page, (D) => D.scene)
const timeAtX = (page, x) =>
  dock(page, (D, x) => {
    const r = document.querySelector(".lines").getBoundingClientRect()
    return D.view.from + ((x - r.left - 12) * (D.view.to - D.view.from)) / (r.width - 30)
  }, x)

test("zoom: ⌘-scroll zooms around the cursor, ticks get finer, F fits all", async ({ page }) => {
  const h = await openDock(page, DOCK_URL)
  const s = await recordAndRewind(h)
  await dock(page, () => window.__waybackDock.fitAll())
  await page.waitForTimeout(400)
  const before = (await scene(page)).labels
  const v0 = await view(page)
  const x = await xOfTime(page, s.now)
  const y = await laneY(page)
  await page.mouse.move(x, y)
  const tBefore = await timeAtX(page, x)
  await page.keyboard.down("Meta")
  for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -60)
  await page.keyboard.up("Meta")
  await page.waitForTimeout(200)
  const v1 = await view(page)
  expect(v1.fit).toBe(false)
  expect(v1.to - v1.from).toBeLessThan((v0.to - v0.from) / 3)
  // The moment under the cursor stayed under the cursor.
  expect(Math.abs((await timeAtX(page, x)) - tBefore)).toBeLessThan(2)
  const after = (await scene(page)).labels
  const decimals = (l) => (l.split(".")[1] || "").replace("s", "").length
  expect(decimals(after[0])).toBeGreaterThan(decimals(before[0]))
  // Pinch (ctrl + wheel) zooms too.
  await page.keyboard.down("Control")
  await page.mouse.wheel(0, 40)
  await page.keyboard.up("Control")
  expect((await view(page)).to - (await view(page)).from).toBeGreaterThan(v1.to - v1.from)
  await page.keyboard.press("f")
  await expect.poll(() => view(page).then((v) => v.fit)).toBe(true)
  await page.waitForTimeout(400)
  const v3 = await view(page)
  expect(Math.abs(v3.to - v3.from - (v0.to - v0.from))).toBeLessThan(5)
  expect(h.dockErrors).toEqual([])
})

test("zoomed out, time 0 stays pinned to the left edge", async ({ page }) => {
  const h = await openDock(page, DOCK_URL)
  const s = await recordAndRewind(h, ["#toggle", "#toggle"], 0.5)
  const box = await page.locator(".lines").boundingBox()
  await page.mouse.move(box.x + box.width * 0.7, box.y + 30)
  await page.keyboard.down("Meta")
  for (let i = 0; i < 8; i++) await page.mouse.wheel(0, 60)
  await page.keyboard.up("Meta")
  await page.waitForTimeout(300)
  expect((await view(page)).from).toBeGreaterThanOrEqual(s.start - 0.01)
  await page.mouse.wheel(-400, 0)
  await page.waitForTimeout(200)
  expect((await view(page)).from).toBeGreaterThanOrEqual(s.start - 0.01)
})

test("layer 1: your actions are blue marks on the active lane (a typing burst is one bar)", async ({ page }) => {
  const h = await openDock(page, DOCK_URL)
  await recordSome(h, ["#toggle", "#spinner"])
  await h.click("#q")
  await page.keyboard.type("hello", { delay: 40 })
  await page.waitForTimeout(300)
  await h.pause()
  await page.waitForTimeout(200)
  const markers = await h.rt(() => __wayback.timeline().markers)
  const sc = await scene(page)
  const shown = ["click", "key", "input", "submit", "route"]
  expect(sc.actions.length).toBe(markers.filter((m) => shown.includes(m.kind)).length)
  expect(sc.actions.filter((a) => a.kind === "click").length).toBeGreaterThanOrEqual(2)
  // Typing: one bar per burst, if the runtime tells us when the burst ended.
  const bursts = markers.filter((m) => m.kind === "input" && m.end != null && m.end > m.t)
  expect(sc.actions.filter((a) => a.kind === "typing").length).toBe(bursts.length)
  // No animation marks on the lane any more.
  expect(await page.locator(".lines rect, .lines path").count()).toBe(0)
  expect(h.dockErrors).toEqual([])
})

test("layer 2: the change waveform, when the runtime has timeline().activity", async ({ page }) => {
  const h = await openDock(page, DOCK_URL)
  await recordAndRewind(h, ["#toggle", "#toggle"], 0.9)
  const has = await h.rt(() => { const a = __wayback.timeline().activity; return !!(a && Array.isArray(a.values) && a.step > 0) })
  const sc = await scene(page)
  if (has) expect(sc.waveCols).toBeGreaterThan(10)
  else expect(sc.waveCols).toBe(0)
})

test("layer 3: ⌘ over an element shows only its animations as capsules; clicking one fits it and goes to its start", async ({ page }) => {
  const h = await openDock(page, DOCK_URL)
  await recordAndRewind(h, ["#toggle", "#spinner", "#toggle"], 0.95)
  const b = await h.box("#card")
  await page.mouse.move(b.x + 20, b.y + 20)
  await page.keyboard.down("Meta")
  await page.mouse.move(b.x + 22, b.y + 22)
  await expect.poll(() => dock(page, (D) => D.lens && D.lens.clips.length)).toBeGreaterThan(0)
  const lens = await dock(page, (D) => D.lens.clips.map((c) => c.selector))
  expect(lens.every((sel) => sel === "#card")).toBe(true)
  await expect.poll(() => scene(page).then((sc) => sc.capsules.length)).toBeGreaterThan(0)
  const cap = (await scene(page)).capsules[0]
  const g = await page.locator(".lines").boundingBox()
  await page.mouse.click(g.x + (cap.x0 + cap.x1) / 2, g.y + cap.y)
  await page.keyboard.up("Meta")
  const v = await view(page)
  expect(v.from).toBeLessThanOrEqual(cap.clip.start)
  await expect.poll(async () => Math.abs((await h.state().catch(() => ({ now: -1e9 }))).now - cap.clip.start), { timeout: 15000 }).toBeLessThan(5)
  await expect.poll(() => dock(page, (D) => D.lens)).toBe(null)
  expect(h.dockErrors).toEqual([])
})

test("live follow: the playhead stays near the right edge; a manual scroll stops it, Live → resumes; paused doesn't move", async ({ page }) => {
  const h = await openDock(page, DOCK_URL)
  await dock(page, (D) => (D.view.followSpan = 1500))
  await h.record()
  await page.waitForTimeout(2500)
  const at = () =>
    dock(page, (D) => {
      const r = document.querySelector(".lines").getBoundingClientRect()
      return (D.scene.playhead - 12) / (r.width - 30)
    })
  expect(await at()).toBeGreaterThan(0.8)
  expect(await at()).toBeLessThan(0.9)
  await expect(page.locator(".live-btn")).toBeHidden()
  const box = await page.locator(".lines").boundingBox()
  await page.mouse.move(box.x + 200, box.y + 40)
  await page.mouse.wheel(-300, 0)
  await expect(page.locator(".live-btn")).toBeVisible()
  const v1 = await view(page)
  await page.waitForTimeout(400)
  expect((await view(page)).from).toBeCloseTo(v1.from, 0)
  await page.locator(".live-btn").click()
  await page.waitForTimeout(400)
  expect(await at()).toBeGreaterThan(0.8)
  await expect(page.locator(".live-btn")).toBeHidden()
  await h.pause()
  await page.waitForTimeout(100)
  const p1 = await view(page)
  await page.waitForTimeout(500)
  expect(await view(page)).toEqual(p1)
  expect(h.dockErrors).toEqual([])
})

test("drawing happens only when something changed", async ({ page }) => {
  const h = await openDock(page, DOCK_URL)
  await recordAndRewind(h, ["#toggle"], 0.5)
  await page.mouse.move(5, 5)
  await page.waitForTimeout(500)
  const d0 = await dock(page, (D) => D.draws)
  await page.waitForTimeout(600)
  expect(await dock(page, (D) => D.draws)).toBe(d0)
  expect((await scene(page)).drawMs).toBeLessThan(8)
})

test("scrubbing snaps to clip edges within 8px, alt moves freely", async ({ page }) => {
  const h = await openDock(page, DOCK_URL)
  await recordAndRewind(h, ["#toggle", "#toggle"], 0.9)
  const all = await h.rt(() => __wayback.timeline().clips)
  const c = all[all.length - 1]
  const g = await page.locator(".lines").boundingBox()
  const y = g.y + g.height - 6 // an empty part of the track
  const xEdge = await xOfTime(page, c.end)
  const xStart = await xOfTime(page, c.start - 150)
  await page.mouse.move(xStart, y)
  await page.mouse.down()
  await page.mouse.move(xEdge + 5, y, { steps: 4 })
  expect(await dock(page, (D) => D.dragT)).toBeCloseTo(c.end, 1)
  expect(await dock(page, (D) => D.snapT)).toBeCloseTo(c.end, 1)
  await page.keyboard.down("Alt")
  await page.mouse.move(xEdge + 6, y, { steps: 2 })
  expect(Math.abs((await dock(page, (D) => D.dragT)) - c.end)).toBeGreaterThan(0.5)
  expect(await dock(page, (D) => D.snapT)).toBe(null)
  await page.keyboard.up("Alt")
  await page.mouse.up()
  await h.settle()
  expect(h.dockErrors).toEqual([])
})

test("keys: arrows step a frame, shift+arrows jump edge to edge, space plays", async ({ page }) => {
  const h = await openDock(page, DOCK_URL)
  const s0 = await recordAndRewind(h, ["#toggle", "#toggle"], 0.3)
  const frames = await h.rt(() => __wayback.history().frames)
  const next = frames.find((f) => f > s0.now + 0.01)
  await page.keyboard.press("ArrowRight")
  await page.waitForTimeout(50)
  const shown = () => dock(page, (D) => (D.keyT != null ? D.keyT : D.last.previewing ? D.last.previewAt : D.last.now))
  expect(await shown()).toBeCloseTo(next, 2)
  await page.keyboard.press("ArrowLeft")
  await page.keyboard.press("ArrowLeft")
  await page.waitForTimeout(50)
  expect(await shown()).toBeLessThan(s0.now)
  const cur = await shown()
  await page.keyboard.press("Shift+ArrowRight")
  await page.waitForTimeout(50)
  const t = await shown()
  const tl = await h.rt(() => __wayback.timeline())
  const candidates = [...tl.clips.flatMap((c) => [c.start + 1, c.end]), ...tl.markers.map((m) => m.t + 1)].filter((x) => x > cur + 0.5)
  expect(t).toBeCloseTo(Math.min(...candidates), 1)
  await h.settle()
  await expect(page.locator(".readout .t")).toHaveText(/^\d\d:\d\d\.\d\d$/)
  await expect(page.locator(".readout .phase")).toHaveText("Paused")
  await page.keyboard.press("Space")
  await expect(page.locator(".readout .phase")).toHaveText(/Playing|Live|Loading/)
  expect(h.dockErrors).toEqual([])
})

test("paused is view-only, and no hint text sits in the dock", async ({ page }) => {
  const h = await openDock(page, DOCK_URL)
  await recordAndRewind(h, ["#toggle", "#toggle"], 0.5)
  await expect(page.locator(".hint")).toHaveText("")
  await expect(page.locator(".hint")).not.toHaveClass(/show/)
  const before = await h.rt(() => document.querySelector("#count").textContent)
  await h.click("#toggle").catch(() => {})
  await page.waitForTimeout(200)
  expect(await h.rt(() => document.querySelector("#count").textContent)).toBe(before)
  expect(h.dockErrors).toEqual([])
})

test("a slow rebuild shows its progress in the readout while the preview stays up", async ({ page }) => {
  const h = await openDock(page, DOCK_URL)
  await recordAndRewind(h, ["#toggle", "#toggle", "#toggle"], 0.9)
  const s = await h.state()
  await page.evaluate(() => {
    window.__phases = []
    const el = document.querySelector(".readout .phase")
    new MutationObserver(() => window.__phases.push(el.textContent)).observe(el, { childList: true, characterData: true, subtree: true })
  })
  await h.seek(s.start + (s.end - s.start) * 0.2)
  expect((await page.evaluate(() => window.__phases)).some((p) => /^Building( \d+%)?$/.test(p))).toBe(true)
  await expect(page.locator(".readout .phase")).toHaveText("Paused")
})

test("the readout follows a forward seek straight away", async ({ page }) => {
  const h = await openDock(page, DOCK_URL)
  const s = await recordAndRewind(h, ["#toggle", "#toggle"], 0.3)
  const t = s.now + 51
  await dock(page, (D, t) => D.PT.seek(t), t)
  await expect.poll(() => h.state().then((x) => x.now)).toBeGreaterThanOrEqual(t - 0.5)
  const st = await h.state()
  const v = Math.max(0, st.now - st.start) / 1000
  await expect(page.locator(".readout .t")).toHaveText(`${String(Math.floor(v / 60)).padStart(2, "0")}:${(v % 60).toFixed(2).padStart(5, "0")}`, { timeout: 300 })
})
