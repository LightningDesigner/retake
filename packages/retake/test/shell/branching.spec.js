// M4: branching. + on the lane in the past grows a new lane out of that moment.
import { test, expect } from "@playwright/test"
import { openDock, DOCK_URL, dock, recordAndRewind, xOfTime, shot } from "./helpers.js"

const branches = (page) => dock(page, (D) => D.branches.map((b) => ({ id: b.id, name: b.name, forkAt: b.forkAt, parentId: b.parentId })))
const laneY = (page, id) => dock(page, (D, id) => D.lanes.get(id ?? D.activeId).y + document.querySelector(".lines").getBoundingClientRect().top, id)

async function plusAt(h, t) {
  const { page } = h
  const x = await xOfTime(page, t)
  const y = await laneY(page)
  await page.mouse.move(x - 30, y)
  await page.mouse.move(x, y, { steps: 3 })
  await expect(page.locator(".plus")).toBeVisible()
  const pb = await page.locator(".plus").boundingBox()
  await page.mouse.move(pb.x + pb.width / 2, pb.y + pb.height / 2, { steps: 3 })
  return pb
}

test("+ on the active lane grows a new lane in its own colour, selected and paused at the fork", async ({ page }) => {
  const h = await openDock(page, DOCK_URL)
  const s = await recordAndRewind(h, ["#toggle", "#toggle"], 0.8)
  await expect(page.locator(".plus")).toBeHidden()
  const t = s.start + (s.end - s.start) * 0.4
  const pb = await plusAt(h, t)
  const hoverT = await dock(page, (D) => D.hoverT)
  await page.mouse.click(pb.x + pb.width / 2, pb.y + pb.height / 2)
  await expect.poll(() => branches(page).then((b) => b.length)).toBe(2)
  // Mid-growth: the new lane is drawn partway along its curve.
  const dash = await page.locator(".lines path.lane.active").first().getAttribute("stroke-dasharray")
  if (dash) expect(Number(dash.split(" ")[0])).toBeLessThan(1)
  await shot(page, "branching-mid.png")
  const [a, b] = await branches(page)
  expect(b).toMatchObject({ id: 2, parentId: 1 })
  expect(Math.abs(b.forkAt - hoverT)).toBeLessThan(40)
  expect(await dock(page, (D) => D.activeId)).toBe(2)
  // Selected and paused right at the fork: nothing plays until Play.
  await expect.poll(() => h.state().then((x) => !x.playing && !x.future && Math.abs(x.now - b.forkAt) < 5)).toBe(true)
  await page.waitForTimeout(500)
  const later = await h.state()
  expect(later.playing).toBe(false)
  expect(Math.abs(later.now - b.forkAt)).toBeLessThan(5)
  expect(await page.locator(".lines path.lane.active").first().getAttribute("stroke-dasharray")).toBe(null)
  // Each timeline its colour: the active one full, the other the same hue, faint.
  const look = await page.evaluate(() => {
    const act = document.querySelector(".lines path.lane.active:not(.ahead)")
    const other = document.querySelector(".lines path.lane:not(.active):not(.hit)")
    return { active: getComputedStyle(act).stroke, activeOp: getComputedStyle(act).opacity, other: getComputedStyle(other).stroke, otherOp: getComputedStyle(other).opacity }
  })
  expect(look.active).toBe("rgb(45, 212, 191)") // Timeline 2
  expect(look.other).toBe("rgb(167, 139, 250)") // Timeline 1
  expect(Number(look.activeOp)).toBe(1)
  expect(Number(look.otherOp)).toBeLessThan(0.5)
  await expect(page.locator('.lane-name.active[data-lane="2"]')).toBeVisible()
  expect(a.id).toBe(1)
  expect(h.dockErrors).toEqual([])
})

test("+ only ever shows on the active lane; an inactive lane says 'Click to select'", async ({ page }) => {
  const h = await openDock(page, DOCK_URL)
  const s = await recordAndRewind(h, ["#toggle", "#toggle"], 0.8)
  await dock(page, (D, t) => window.__waybackDock.newTimelineAt(t), s.start + (s.end - s.start) * 0.5)
  await expect.poll(() => dock(page, (D) => D.activeId)).toBe(2)
  await h.settle()
  const x = await xOfTime(page, s.start + (s.end - s.start) * 0.2)
  await page.mouse.move(x, await laneY(page, 1))
  await expect(page.locator(".tip")).toHaveText("Click to select")
  await expect(page.locator(".plus")).toBeHidden()
  // Clicking it selects it, paused: nothing starts playing.
  await page.mouse.click(x, await laneY(page, 1))
  await expect.poll(() => dock(page, (D) => D.activeId === 1 && !D.building)).toBe(true)
  await page.waitForTimeout(300)
  expect((await h.state()).playing).toBe(false)
  await page.mouse.move(x, await laneY(page, 1))
  await expect(page.locator(".plus")).toBeVisible()
  expect(h.dockErrors).toEqual([])
})

test("click a grey lane to switch; right-click deletes (not the first); double-click renames", async ({ page }) => {
  const h = await openDock(page, DOCK_URL)
  const s = await recordAndRewind(h, ["#toggle", "#toggle"], 0.5)
  await dock(page, (D, t) => window.__waybackDock.newTimelineAt(t), s.now)
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

test("more than four timelines: the inactive lanes fold to thin lines", async ({ page }) => {
  const h = await openDock(page, DOCK_URL)
  const s = await recordAndRewind(h, ["#toggle", "#toggle", "#toggle"], 0.9)
  for (let i = 0; i < 4; i++) {
    const n = i + 2
    await h.pause()
    await h.settle()
    await dock(page, (D, t) => window.__waybackDock.newTimelineAt(t), s.start + (s.end - s.start) * (0.15 + i * 0.15))
    await expect.poll(() => dock(page, (D) => D.branches.length)).toBe(n)
    await page.waitForTimeout(250)
    await h.pause()
    await h.settle()
    // Back to Timeline 1 for the next one.
    await dock(page, () => window.__waybackDock.switchTo(1, 1e9))
    await expect.poll(() => dock(page, (D) => D.activeId)).toBe(1)
    await h.settle()
  }
  expect(await dock(page, (D) => D.branches.length)).toBe(5)
  const thin = await dock(page, (D) => [...D.lanes.entries()].map(([id, l]) => [id, l.thin]))
  expect(thin.filter(([, t]) => t).length).toBe(4)
  expect(thin.find(([id]) => id === 1)[1]).toBe(false)
  await expect(page.locator(".lane-name.thin")).toHaveCount(4)
  // Every lane still fits in the dock.
  const h2 = await page.locator(".lines").boundingBox()
  const maxY = await dock(page, (D) => Math.max(...[...D.lanes.values()].map((l) => l.y)))
  expect(maxY).toBeLessThan(h2.height)
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
    window.__waybackDock.newTimelineAt(t)
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
  await dock(page, (D) => window.__waybackDock.switchTo(1, 1e9))
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
    window.__waybackDock.newTimelineAt(here) // ...and + is pressed where the visible frame is
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
  await dock(page, (D, t) => window.__waybackDock.newTimelineAt(t), s.start + (s.end - s.start) * 0.5)
  await expect.poll(() => dock(page, (D) => D.activeId)).toBe(2)
  // Timeline 2 runs on well past Timeline 1's end.
  await h.settle()
  await h.record()
  await page.waitForTimeout(1500)
  await h.pause()
  expect((await h.state()).end).toBeGreaterThan(t1End + 500)
  await dock(page, () => window.__waybackDock.switchTo(1, 0))
  await expect.poll(() => dock(page, (D) => D.activeId === 1 && !D.building)).toBe(true)
  await page.waitForTimeout(300)
  const end = await dock(page, (D) => D.branches[0].end)
  expect(end).toBeLessThan(t1End + 5)
  expect(h.dockErrors).toEqual([])
})
