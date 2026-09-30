// M3: the timeline. Ruler, zoom, clips, markers, snapping, keys, readout, and
// a view-only past.
import { test, expect } from "@playwright/test"
import { openDock, DOCK_URL, dock, recordAndRewind, xOfTime, shot } from "./helpers.js"

// Runs against the runtime's real timeline API (engine-timeline.done). The
// labelled mock in src/shell/mock/ stays for specs that want fixed data.

const view = (page) => dock(page, (D) => ({ from: D.view.from, to: D.view.to, follow: D.view.follow }))
const laneY = (page) => dock(page, (D) => D.lanes.get(D.activeId).y + document.querySelector(".lines").getBoundingClientRect().top)
const tickInfo = (page) =>
  page.evaluate(() => {
    const labels = [...document.querySelectorAll(".lines .tlabel")].map((t) => t.textContent)
    return { ticks: document.querySelectorAll(".lines .tick").length, labels }
  })

test("zoom: ⌘-scroll zooms around the cursor, ticks get finer, F fits all", async ({ page }) => {
  const h = await openDock(page, DOCK_URL)
  const s = await recordAndRewind(h)
  const before = await tickInfo(page)
  const v0 = await view(page)
  const x = await xOfTime(page, s.now)
  const y = await laneY(page)
  await page.mouse.move(x, y)
  const tBefore = await dock(page, (D, x) => D.view.from + ((x - document.querySelector(".lines").getBoundingClientRect().left - 12) * (D.view.to - D.view.from)) / (document.querySelector(".lines").getBoundingClientRect().width - 30), x)
  await page.keyboard.down("Meta")
  for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -60)
  await page.keyboard.up("Meta")
  await page.waitForTimeout(200)
  const v1 = await view(page)
  expect(v1.follow).toBe(false)
  expect(v1.to - v1.from).toBeLessThan((v0.to - v0.from) / 3)
  // The moment under the cursor stayed under the cursor.
  const tAfter = await dock(page, (D, x) => D.view.from + ((x - document.querySelector(".lines").getBoundingClientRect().left - 12) * (D.view.to - D.view.from)) / (document.querySelector(".lines").getBoundingClientRect().width - 30), x)
  expect(Math.abs(tAfter - tBefore)).toBeLessThan(2)
  const after = await tickInfo(page)
  const decimals = (l) => (l.split(".")[1] || "").replace("s", "").length
  expect(decimals(after.labels[0])).toBeGreaterThan(decimals(before.labels[0]))

  // Pinch (ctrl + wheel) zooms too.
  await page.keyboard.down("Control")
  await page.mouse.wheel(0, 40)
  await page.keyboard.up("Control")
  const v2 = await view(page)
  expect(v2.to - v2.from).toBeGreaterThan(v1.to - v1.from)

  await page.keyboard.press("f")
  await expect.poll(() => view(page).then((v) => v.follow)).toBe(true)
  await page.waitForTimeout(400)
  const v3 = await view(page)
  expect(Math.abs(v3.to - v3.from - (v0.to - v0.from))).toBeLessThan(5)
  expect(h.dockErrors).toEqual([])
})

test("animation blocks: overlapping clips merge into one block on the lane, hover lists them, double-click fits", async ({ page }) => {
  const h = await openDock(page, DOCK_URL)
  await recordAndRewind(h, ["#toggle", "#toggle"])
  const clips = await h.rt(() => __wayback.timeline().clips)
  // Two toggles, ~400ms apart, each starting a 600ms transition: they overlap.
  expect(clips.length).toBeGreaterThanOrEqual(2)
  // No stacked grey bars any more: blocks on the lane.
  await expect(page.locator(".lines rect.clip")).toHaveCount(0)
  const bands = await dock(page, (D) => D.bands.map((b) => ({ a: b.a, b: b.b, n: b.clips.length })))
  expect(bands.length).toBeGreaterThanOrEqual(1)
  expect(bands.length).toBeLessThan(clips.length)
  const big = bands.reduce((x, y) => (y.n > x.n ? y : x))
  expect(big.n).toBeGreaterThanOrEqual(2)
  // The block sits on the active lane.
  const laneYv = await laneY(page)
  const i = bands.indexOf(big)
  const box = await page.locator(`.lines [data-band="${i}"]`).boundingBox()
  expect(Math.abs(box.y + box.height / 2 - laneYv)).toBeLessThan(2)
  await page.mouse.move(box.x + Math.min(box.width / 2, 30), laneYv)
  await expect(page.locator(".tip")).toBeVisible()
  await expect(page.locator(".tip")).toContainText(/\d+ animations/)
  await expect(page.locator(".tip .row")).toHaveCount(Math.min(big.n, 5))
  await expect(page.locator(".tip")).toContainText(/\d+ms|\ds/)
  await expect(page.locator(".lines rect.band.hot")).toHaveCount(1)

  await page.mouse.dblclick(box.x + Math.min(box.width / 2, 30), laneYv)
  await expect.poll(() => view(page).then((v) => v.to - v.from)).toBeLessThan((big.b - big.a) * 1.6)
  const v = await view(page)
  expect(v.from).toBeLessThanOrEqual(big.a)
  expect(v.to).toBeGreaterThanOrEqual(big.b)
  // A double-click fits; it doesn't make a timeline.
  await page.waitForTimeout(400)
  expect(await dock(page, (D) => D.branches.length)).toBe(1)
  expect(h.dockErrors).toEqual([])
})

test("user interactions are blue dots on the lane", async ({ page }) => {
  const h = await openDock(page, DOCK_URL)
  await recordAndRewind(h, ["#toggle", "#spinner"], 0.95)
  const clicks = (await h.rt(() => __wayback.timeline().markers)).filter((m) => m.kind === "click")
  await expect(page.locator(".lines circle.mk-dot")).toHaveCount(clicks.length)
  const fill = await page.evaluate(() => getComputedStyle(document.querySelector(".lines circle.mk-dot")).fill)
  expect(fill).toBe("rgb(96, 165, 250)")
  const cy = await page.evaluate(() => Number(document.querySelector(".lines circle.mk-dot").getAttribute("cy")))
  expect(cy).toBe(await dock(page, (D) => D.lanes.get(D.activeId).y))
})

test("zoomed out, time 0 stays pinned to the left edge", async ({ page }) => {
  const h = await openDock(page, DOCK_URL)
  const s = await recordAndRewind(h, ["#toggle", "#toggle"], 0.5)
  const y = await laneY(page)
  const box = await page.locator(".lines").boundingBox()
  await page.mouse.move(box.x + box.width * 0.7, y - 30)
  await page.keyboard.down("Meta")
  for (let i = 0; i < 8; i++) await page.mouse.wheel(0, 60)
  await page.keyboard.up("Meta")
  await page.waitForTimeout(300)
  const v = await view(page)
  expect(v.from).toBeGreaterThanOrEqual(s.start - 0.01)
  expect(v.from).toBeLessThan(s.start + 1)
  // And a pan left can't go before it either.
  await page.mouse.wheel(-400, 0)
  await page.waitForTimeout(200)
  expect((await view(page)).from).toBeGreaterThanOrEqual(s.start - 0.01)
  await shot(page, "dock-v2-zoomed-out.png")
})

test("markers: a tick per click with a tooltip", async ({ page }) => {
  const h = await openDock(page, DOCK_URL)
  await recordAndRewind(h, ["#toggle", "#spinner"], 0.95)
  const markers = await h.rt(() => __wayback.timeline().markers)
  expect(markers.filter((m) => m.kind === "click")).toHaveLength(2)
  await expect(page.locator(".lines [data-mark]")).toHaveCount(markers.length)
  const box = await page.locator('.lines [data-mark="0"]').boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await expect(page.locator(".tip")).toContainText(/click/i)
})

test("scrubbing snaps to clip edges within 8px, alt moves freely", async ({ page }) => {
  const h = await openDock(page, DOCK_URL)
  await recordAndRewind(h, ["#toggle", "#toggle"], 0.9)
  const all = await h.rt(() => __wayback.timeline().clips)
  const c = all[all.length - 1] // the last 600ms one: nothing else ends near it
  const y = await laneY(page)
  const xEdge = await xOfTime(page, c.end)
  const xStart = await xOfTime(page, c.start - 150)
  await page.mouse.move(xStart, y)
  await page.mouse.down()
  await page.mouse.move(xEdge + 5, y, { steps: 4 })
  expect(await dock(page, (D) => D.dragT)).toBeCloseTo(c.end, 1)
  await expect(page.locator(".lines .snap")).toHaveCount(1)
  await page.keyboard.down("Alt")
  await page.mouse.move(xEdge + 6, y, { steps: 2 })
  const free = await dock(page, (D) => D.dragT)
  expect(Math.abs(free - c.end)).toBeGreaterThan(0.5)
  await expect(page.locator(".lines .snap")).toHaveCount(0)
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

  // shift+→ lands on the next clip edge or marker.
  const edges = await dock(page, () => null)
  const cur = await shown()
  await page.keyboard.press("Shift+ArrowRight")
  await page.waitForTimeout(50)
  const t = await shown()
  const tl = await h.rt(() => __wayback.timeline())
  const candidates = [...tl.clips.flatMap((c) => [c.start + 1, c.end]), ...tl.markers.map((m) => m.t + 1)].filter((x) => x > cur + 0.5)
  expect(t).toBeCloseTo(Math.min(...candidates), 1)
  await h.settle()

  await expect(page.locator(".readout")).toHaveText(/^\d\d:\d\d\.\d\dPaused$/)
  await expect(page.locator(".readout .t")).toHaveText(/^\d\d:\d\d\.\d\d$/)
  await page.keyboard.press("Space")
  await expect(page.locator(".readout .phase")).toHaveText(/Playing|Live|Loading/)
  expect(edges).toBe(null)
  expect(h.dockErrors).toEqual([])
})

test("the past is view-only, with a quiet hint", async ({ page }) => {
  const h = await openDock(page, DOCK_URL)
  await recordAndRewind(h, ["#toggle", "#toggle"], 0.5)
  await expect(page.locator(".hint")).toHaveText("Paused · + to branch")
  await expect(page.locator(".hint")).toHaveClass(/show/)
  await expect(page.locator("#wb-shield")).toBeVisible()
  const before = await h.rt(() => document.querySelector("#count").textContent)
  await h.click("#toggle").catch(() => {})
  await page.waitForTimeout(200)
  expect(await h.rt(() => document.querySelector("#count").textContent)).toBe(before)
  expect(h.dockErrors).toEqual([])
})

test("a slow rebuild shows its progress in the readout while the preview stays up", async ({ page }) => {
  const h = await openDock(page, DOCK_URL)
  await recordAndRewind(h, ["#toggle", "#toggle", "#toggle"], 0.9)
  const seen = []
  page.on("console", () => {})
  const s = await h.state()
  await page.evaluate(() => {
    window.__phases = []
    const el = document.querySelector(".readout .phase")
    new MutationObserver(() => window.__phases.push(el.textContent)).observe(el, { childList: true, characterData: true, subtree: true })
  })
  await h.seek(s.start + (s.end - s.start) * 0.2)
  const phases = await page.evaluate(() => window.__phases)
  seen.push(...phases)
  expect(seen.some((p) => /^Building( \d+%)?$/.test(p))).toBe(true)
  await expect(page.locator(".readout .phase")).toHaveText("Paused")
})

test("P10: the readout follows a forward seek straight away", async ({ page }) => {
  const h = await openDock(page, DOCK_URL)
  const s = await recordAndRewind(h, ["#toggle", "#toggle"], 0.3)
  const t = s.now + 51
  await dock(page, (D, t) => D.PT.seek(t), t)
  await expect.poll(() => h.state().then((x) => x.now)).toBeGreaterThanOrEqual(t - 0.5)
  const want = (ms) => {
    const v = Math.max(0, ms) / 1000
    return `${String(Math.floor(v / 60)).padStart(2, "0")}:${(v % 60).toFixed(2).padStart(5, "0")}Paused`
  }
  const st = await h.state()
  await expect(page.locator(".readout")).toHaveText(want(st.now - st.start), { timeout: 300 })
})
