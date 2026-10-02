// M4: branching. + on the lane in the past grows a new lane out of that moment.
import { test, expect } from "@playwright/test"
import { openDock, DOCK_URL, dock, recordAndRewind, xOfTime, shot } from "./helpers.js"

const branches = (page) => dock(page, (D) => D.branches.map((b) => ({ id: b.id, name: b.name, forkAt: b.forkAt, parentId: b.parentId })))
const laneY = (page, id) => dock(page, (D, id) => D.lanes.get(id ?? D.activeId).y + document.querySelector(".lines").getBoundingClientRect().top, id)

// Control-click on the track at time t (an empty part of it, under the lanes).
async function ctrlClickAt(page, t) {
  const g = await page.locator(".lines").boundingBox()
  const x = await xOfTime(page, t)
  const y = g.y + g.height - 6
  await page.mouse.move(x, y)
  await page.keyboard.down("Control")
  await page.mouse.move(x + 1, y)
  await page.mouse.move(x, y)
  await page.mouse.click(x, y)
  await page.keyboard.up("Control")
  return { x, y }
}

test("Control-click branches the active timeline at the clicked time (not the playhead), selected and paused there", async ({ page }) => {
  const h = await openDock(page, DOCK_URL)
  const s = await recordAndRewind(h, ["#toggle", "#toggle"], 0.8)
  const t = s.start + (s.end - s.start) * 0.3
  const g = await page.locator(".lines").boundingBox()
  // While Control is held over the track: a guide at the pointer, with its time.
  await page.mouse.move(await xOfTime(page, t), g.y + g.height - 6)
  await page.keyboard.down("Control")
  await page.mouse.move((await xOfTime(page, t)) + 1, g.y + g.height - 6)
  await expect.poll(() => dock(page, (D) => D.branchT)).not.toBe(null)
  expect(Math.abs((await dock(page, (D) => D.scene.guide.t)) - t)).toBeLessThan(40)
  await expect(page.locator("body")).toHaveClass(/branching/)
  await page.keyboard.up("Control")
  await expect.poll(() => dock(page, (D) => D.branchT)).toBe(null)

  await ctrlClickAt(page, t)
  await expect.poll(() => branches(page).then((b) => b.length)).toBe(2)
  await shot(page, "branching-mid.png")
  const [a, b] = await branches(page)
  expect(b).toMatchObject({ id: 2, parentId: 1 })
  expect(Math.abs(b.forkAt - t)).toBeLessThan(40)
  expect(Math.abs(b.forkAt - s.now)).toBeGreaterThan(200)
  expect(await dock(page, (D) => D.activeId)).toBe(2)
  // The playhead went to the fork, paused: nothing plays until Play.
  await expect.poll(() => h.state().then((x) => !x.playing && !x.future && Math.abs(x.now - b.forkAt) < 5)).toBe(true)
  await page.waitForTimeout(500)
  expect((await h.state()).playing).toBe(false)
  const sc = await dock(page, (D) => D.scene.lanes)
  expect(sc.find((l) => l.id === 2)).toMatchObject({ active: true })
  expect(sc.find((l) => l.id === 1)).toMatchObject({ active: false })
  expect(sc.find((l) => l.id === 1).color).not.toBe(sc.find((l) => l.id === 2).color)
  await expect(page.locator('.lane-name.active[data-lane="2"]')).toBeVisible()
  expect(a.id).toBe(1)
  expect(h.dockErrors).toEqual([])
})

test("a plain click on another lane selects it, paused; the empty track moves the playhead", async ({ page }) => {
  const h = await openDock(page, DOCK_URL)
  const s = await recordAndRewind(h, ["#toggle", "#toggle"], 0.8)
  await dock(page, (D, t) => window.__retakeDock.newTimelineAt(t), s.start + (s.end - s.start) * 0.5)
  await expect.poll(() => dock(page, (D) => D.activeId)).toBe(2)
  await h.settle()
  const x = await xOfTime(page, s.start + (s.end - s.start) * 0.2)
  await page.mouse.click(x, await laneY(page, 1))
  await expect.poll(() => dock(page, (D) => D.activeId === 1 && !D.building)).toBe(true)
  await page.waitForTimeout(300)
  expect((await h.state()).playing).toBe(false)
  // Empty track: the playhead goes there.
  const g = await page.locator(".lines").boundingBox()
  const t2 = s.start + (s.end - s.start) * 0.6
  await page.mouse.click(await xOfTime(page, t2), g.y + g.height - 6)
  await expect.poll(async () => Math.abs((await h.state().catch(() => ({ now: -1e9 }))).now - t2), { timeout: 15000 }).toBeLessThan(40)
  expect(await dock(page, (D) => D.activeId)).toBe(1)
  expect(h.dockErrors).toEqual([])
})

test("click a grey lane to switch; right-click deletes (not the first); double-click renames", async ({ page }) => {
  const h = await openDock(page, DOCK_URL)
  const s = await recordAndRewind(h, ["#toggle", "#toggle"], 0.5)
  await dock(page, (D, t) => window.__retakeDock.newTimelineAt(t), s.now)
  await expect.poll(() => dock(page, (D) => D.activeId)).toBe(2)
  await page.waitForTimeout(400)
  await h.pause()
  await h.settle()

  // Switch to Timeline 1 by clicking its grey lane.
  const y1 = await laneY(page, 1)
  const x = await xOfTime(page, s.start + (s.end - s.start) * 0.2)
  await page.mouse.click(x, y1)
  await expect.poll(() => dock(page, (D) => D.activeId)).toBe(1)
  await h.settle()

  // Right-click the first: it can't be deleted.
  await page.mouse.click(x, await laneY(page, 1), { button: "right" })
  await expect(page.locator("#wb-menu")).toBeVisible()
  await expect(page.locator("#wb-menu")).toContainText("can't be deleted")
  await page.keyboard.press("Escape")
  await page.mouse.click(5, 5)

  // Rename Timeline 2 from the gutter.
  await page.locator('.lane-name[data-lane="2"]').dblclick()
  const input = page.locator(".lane-name input")
  await expect(input).toBeVisible()
  await input.fill("Bigger card")
  await input.press("Enter")
  await expect(page.locator('.lane-name[data-lane="2"]')).toHaveText("Bigger card")

  // Right-click Timeline 2 in the gutter and delete it.
  await page.locator('.lane-name[data-lane="2"]').click({ button: "right" })
  await page.locator("[data-delete-timeline]").click()
  await expect.poll(() => branches(page).then((b) => b.map((x) => x.id))).toEqual([1])
  expect(h.dockErrors).toEqual([])
})

test("a short dock: lanes close up and the names become colour dots (name on hover)", async ({ page }) => {
  const h = await openDock(page, DOCK_URL)
  const s = await recordAndRewind(h, ["#toggle", "#toggle", "#toggle"], 0.9)
  for (let i = 0; i < 3; i++) {
    await dock(page, () => window.__retakeDock.switchTo(1, 1e9))
    await expect.poll(() => dock(page, (D) => D.activeId === 1 && !D.building)).toBe(true)
    await h.settle()
    await dock(page, (D, t) => window.__retakeDock.newTimelineAt(t), s.start + (s.end - s.start) * (0.2 + i * 0.2))
    await expect.poll(() => dock(page, (D) => D.branches.length)).toBe(i + 2)
    await h.settle()
  }
  await dock(page, (D) => (D.height = 110))
  await page.waitForTimeout(300)
  expect(await dock(page, (D) => D.compact)).toBe(true)
  await expect(page.locator(".gutter")).toHaveClass(/dots/)
  const ys = await dock(page, (D) => [...D.lanes.values()].map((l) => l.y))
  for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBeGreaterThanOrEqual(10)
  const g = await page.locator(".lines").boundingBox()
  expect(Math.max(...ys)).toBeLessThan(g.height)
  expect(await page.locator('.lane-name[data-lane="2"]').getAttribute("title")).toBe(await dock(page, (D) => D.branches[1].name))
  await expect(page.locator('.lane-name[data-lane="2"] span')).toBeHidden()
  expect(h.dockErrors).toEqual([])
})

test("+ while a rewind is still building waits for it: Timeline 1 keeps its whole future", async ({ page }) => {
  const h = await openDock(page, DOCK_URL)
  const { recordSome } = await import("./helpers.js")
  await recordSome(h, ["#toggle", "#toggle", "#toggle"])
  await h.pause()
  const s = await h.state()
  const t = s.start + (s.end - s.start) * 0.4
  // seek, then + at that moment straight away, before the rebuild lands.
  await dock(page, (D, t) => {
    D.PT.seek(t)
    window.__retakeDock.newTimelineAt(t)
  }, t)
  await expect.poll(() => dock(page, (D) => D.branches.length)).toBe(2)
  await expect.poll(() => dock(page, (D) => !D.building && D.activeId === 2)).toBe(true)
  await page.waitForTimeout(300)
  const r = await dock(page, (D) => ({
    t1End: JSON.parse(D.branches[0].json).end,
    t1Events: JSON.parse(D.branches[0].json).events.length,
    fork: D.branches[1].forkAt,
    future: D.last.future,
  }))
  expect(r.t1End).toBeGreaterThanOrEqual(s.end - 1)
  expect(Math.abs(r.fork - t)).toBeLessThan(40)
  expect(r.future).toBe(false)
  // And going back to Timeline 1 shows its whole recording.
  await dock(page, (D) => window.__retakeDock.switchTo(1, 1e9))
  await expect.poll(() => h.state().then((x) => x.end).catch(() => 0)).toBeGreaterThanOrEqual(s.end - 1)
  expect(h.dockErrors).toEqual([])
})

test("+ at the visible moment while another moment is building doesn't let the stale build land on the new timeline", async ({ page }) => {
  const h = await openDock(page, DOCK_URL)
  const { recordSome } = await import("./helpers.js")
  await recordSome(h, ["#toggle", "#toggle", "#toggle"])
  await h.pause()
  const s = await h.state()
  await h.seek(s.start + (s.end - s.start) * 0.6)
  const here = (await h.state()).now
  await dock(page, (D, [t2, here]) => {
    D.PT.seek(t2) // a rebuild starts...
    window.__retakeDock.newTimelineAt(here) // ...and + is pressed where the visible frame is
  }, [s.start + (s.end - s.start) * 0.2, here])
  await expect.poll(() => dock(page, (D) => D.branches.length)).toBe(2)
  await expect.poll(() => dock(page, (D) => !D.building && D.activeId === 2)).toBe(true)
  await page.waitForTimeout(400)
  const r = await dock(page, (D) => ({ t1End: JSON.parse(D.branches[0].json).end, fork: D.branches[1].forkAt, now: D.last.now, future: D.last.future, frames: document.querySelectorAll("#wb-stage iframe").length }))
  expect(r.t1End).toBeGreaterThanOrEqual(s.end - 1)
  // The new timeline's frame is the forked one: no recorded future.
  expect(r.future).toBe(false)
  expect(r.frames).toBe(1)
  expect(h.dockErrors).toEqual([])
})

test("switching back to a shorter timeline keeps its own end (not the frame it's leaving)", async ({ page }) => {
  const h = await openDock(page, DOCK_URL)
  const { recordSome } = await import("./helpers.js")
  await recordSome(h, ["#toggle"])
  await h.pause()
  const s = await h.state()
  const t1End = s.end
  await dock(page, (D, t) => window.__retakeDock.newTimelineAt(t), s.start + (s.end - s.start) * 0.5)
  await expect.poll(() => dock(page, (D) => D.activeId)).toBe(2)
  // Timeline 2 runs on well past Timeline 1's end.
  await h.settle()
  await h.record()
  await page.waitForTimeout(1500)
  await h.pause()
  expect((await h.state()).end).toBeGreaterThan(t1End + 500)
  await dock(page, () => window.__retakeDock.switchTo(1, 0))
  await expect.poll(() => dock(page, (D) => D.activeId === 1 && !D.building)).toBe(true)
  await page.waitForTimeout(300)
  const end = await dock(page, (D) => D.branches[0].end)
  expect(end).toBeLessThan(t1End + 5)
  expect(h.dockErrors).toEqual([])
})
