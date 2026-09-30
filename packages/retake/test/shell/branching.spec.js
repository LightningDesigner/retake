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

test("+ in the past grows a new, live lane out of that moment", async ({ page }) => {
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
  // Live from there: recording, and the app takes input again.
  await expect.poll(() => h.state().then((s) => s.playing && !s.future)).toBe(true)
  await expect(page.locator("#wb-shield")).toBeHidden()
  await page.waitForTimeout(300)
  expect(await page.locator(".lines path.lane.active").first().getAttribute("stroke-dasharray")).toBe(null)
  // Active is white, the other grey.
  const strokes = await page.evaluate(() => ({
    active: getComputedStyle(document.querySelector(".lines path.lane.active:not(.ahead)")).stroke,
    other: getComputedStyle(document.querySelector(".lines path.lane:not(.active):not(.hit)")).stroke,
  }))
  expect(strokes.active).toBe("rgb(255, 255, 255)")
  expect(strokes.other).not.toBe("rgb(255, 255, 255)")
  expect(a.id).toBe(1)
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
