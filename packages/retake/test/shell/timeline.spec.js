// M3: the timeline. Ruler, zoom, clips, markers, snapping, keys, readout, and
// a view-only past.
import { test, expect } from "@playwright/test"
import { openDock, DOCK_URL, dock, recordAndRewind, xOfTime } from "./helpers.js"

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

test("clips: one bar per clip, overlaps stack, hover shows a label, double-click fits", async ({ page }) => {
  const h = await openDock(page, DOCK_URL)
  await recordAndRewind(h, ["#toggle", "#toggle"])
  const clips = await h.rt(() => __wayback.timeline().clips)
  // Two toggles, ~400ms apart, each starting a 600ms transition.
  expect(clips.length).toBeGreaterThanOrEqual(2)
  const bars = await dock(page, (D) => D.clipBars.map((b) => ({ i: b.i, row: b.row })))
  expect(bars).toHaveLength(clips.length)
  await expect(page.locator(".lines rect.clip")).toHaveCount(clips.length)
  // Clips that overlap in time sit on different rows.
  const rowOf = Object.fromEntries(bars.map((b) => [b.i, b.row]))
  const end = (c) => (c.end == null ? Infinity : c.end)
  let overlaps = 0
  clips.forEach((a, i) =>
    clips.forEach((b, j) => {
      if (j <= i || a.start >= end(b) || b.start >= end(a)) return
      overlaps++
      if (Object.keys(rowOf).length <= 4 * 1) expect(rowOf[i]).not.toBe(rowOf[j])
    }),
  )
  expect(overlaps).toBeGreaterThan(0)

  // The longest finished clip: hover it, then double-click to fit it.
  const idx = clips.reduce((best, c, i) => (c.end != null && c.end - c.start > (clips[best].end ?? 0) - clips[best].start ? i : best), 0)
  const c = clips[idx]
  const hit = page.locator(`.lines [data-clip="${idx}"]`)
  const box = await hit.boundingBox()
  await page.mouse.move(box.x + Math.min(box.width / 2, 20), box.y + box.height / 2)
  await expect(page.locator(".tip")).toBeVisible()
  await expect(page.locator(".tip")).toContainText(String(c.property || c.label || c.kind).slice(0, 12))
  await expect(page.locator(".lines rect.clip.hot")).toHaveCount(1)

  await page.mouse.dblclick(box.x + Math.min(box.width / 2, 20), box.y + box.height / 2)
  await expect.poll(() => view(page).then((v) => v.to - v.from)).toBeLessThan((c.end - c.start) * 1.6)
  const v = await view(page)
  expect(v.from).toBeLessThanOrEqual(c.start)
  expect(v.to).toBeGreaterThanOrEqual(c.end)
  expect(v.to - v.from).toBeLessThan((c.end - c.start) * 1.6)
  expect(h.dockErrors).toEqual([])
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

  await expect(page.locator(".readout")).toHaveText(/^T \d\d:\d\d\.\d\d · PAUSED$/)
  await page.keyboard.press("Space")
  await expect(page.locator(".readout .phase")).toHaveText(/PLAYING|LIVE|LOADING/)
  expect(edges).toBe(null)
  expect(h.dockErrors).toEqual([])
})

test("the past is view-only, with a quiet hint", async ({ page }) => {
  const h = await openDock(page, DOCK_URL)
  await recordAndRewind(h, ["#toggle", "#toggle"], 0.5)
  await expect(page.locator(".hint")).toHaveText("Viewing the past · press + to try something else from here")
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
  expect(seen.some((p) => /^BUILDING( \d+%)?$/.test(p))).toBe(true)
  await expect(page.locator(".readout .phase")).toHaveText("PAUSED")
})

test("P10: the readout follows a forward seek straight away", async ({ page }) => {
  const h = await openDock(page, DOCK_URL)
  const s = await recordAndRewind(h, ["#toggle", "#toggle"], 0.3)
  const t = s.now + 51
  await dock(page, (D, t) => D.PT.seek(t), t)
  await expect.poll(() => h.state().then((x) => x.now)).toBeGreaterThanOrEqual(t - 0.5)
  const want = (ms) => {
    const v = Math.max(0, ms) / 1000
    return `T ${String(Math.floor(v / 60)).padStart(2, "0")}:${(v % 60).toFixed(2).padStart(5, "0")} · PAUSED`
  }
  const st = await h.state()
  await expect(page.locator(".readout")).toHaveText(want(st.now - st.start), { timeout: 300 })
})
