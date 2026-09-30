// Timelines as a tree (like a clean git graph): each under its parent, forks
// drop one row along a short S-curve, nothing crosses. Screenshots for review.
import { test, expect } from "@playwright/test"
import { openDock, DOCK_URL, dock, recordSome, shot } from "./helpers.js"

const fork = async (h, page, parentId, t, record = 0) => {
  const n = await dock(page, (D) => D.branches.length)
  if ((await dock(page, (D) => D.activeId)) !== parentId) {
    await dock(page, (D, id) => window.__waybackDock.switchTo(id, 1e9), parentId)
    await expect.poll(() => dock(page, (D, id) => D.activeId === id && !D.building, parentId)).toBe(true)
    await h.settle()
  }
  await dock(page, (D, t) => window.__waybackDock.newTimelineAt(t), t)
  await expect.poll(() => dock(page, (D) => D.branches.length)).toBe(n + 1)
  await h.settle()
  if (record) {
    await h.record()
    await page.waitForTimeout(record)
    await h.pause()
    await page.waitForTimeout(100)
  }
  return dock(page, (D) => D.activeId)
}

test("tree: one lane", async ({ page }) => {
  const h = await openDock(page, DOCK_URL)
  await recordSome(h, ["#toggle", "#spinner"])
  await h.pause()
  await page.waitForTimeout(300)
  expect(await dock(page, (D) => D.branches[0].name)).toBe("Main")
  await shot(page, "dock-tree-1-lane.png")
})

test("tree: 5 lanes with three siblings from one fork and a grandchild; nothing crosses", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  const h = await openDock(page, DOCK_URL)
  await dock(page, (D) => (D.height = 280))
  await recordSome(h, ["#toggle", "#spinner", "#toggle", "#wave"])
  await h.pause()
  const s = await h.state()
  const t = s.start + (s.end - s.start) * 0.35
  const a = await fork(h, page, 1, t, 600)
  await fork(h, page, 1, t, 400)
  await fork(h, page, 1, t, 300)
  const aState = await dock(page, (D, id) => D.branches.find((b) => b.id === id), a)
  await fork(h, page, a, aState.forkAt + 300, 200)
  await dock(page, () => window.__waybackDock.switchTo(1, 1e9))
  await expect.poll(() => dock(page, (D) => D.activeId === 1 && !D.building)).toBe(true)
  await h.settle()
  await page.waitForTimeout(400)
  const names = await dock(page, (D) => D.branches.map((b) => b.name))
  expect(names).toEqual(["Main", "Take 2", "Take 3", "Take 4", "Take 5"])
  // Geometry: every child sits below its parent; the rows between them are
  // empty at the fork moment (they start at or after it).
  const geo = await dock(page, (D) => ({
    order: D.rowOrder,
    lanes: D.branches.map((b) => ({ id: b.id, parentId: b.parentId, forkAt: b.forkAt, start: b.parentId ? b.forkAt : 0 })),
  }))
  const row = (id) => geo.order.indexOf(id)
  for (const b of geo.lanes.filter((x) => x.parentId)) {
    expect(row(b.id)).toBeGreaterThan(row(b.parentId))
    for (const other of geo.lanes) {
      const r = row(other.id)
      if (r > row(b.parentId) && r < row(b.id)) expect(other.start).toBeGreaterThanOrEqual(b.forkAt)
    }
  }
  await shot(page, "dock-tree-5-lanes.png")
  expect(h.dockErrors).toEqual([])
})

test("tree: a new, empty branch reads as ready (stub + hollow end)", async ({ page }) => {
  const h = await openDock(page, DOCK_URL)
  await recordSome(h, ["#toggle", "#toggle"])
  await h.pause()
  const s = await h.state()
  await fork(h, page, 1, s.start + (s.end - s.start) * 0.5)
  await page.waitForTimeout(400)
  const lane = await dock(page, (D) => D.scene.lanes.find((l) => l.id === 2))
  expect(lane.empty).toBe(true)
  expect(lane.x1 - lane.x0).toBeGreaterThanOrEqual(40) // curve (20) + stub (24)
  await shot(page, "dock-tree-new-branch.png")
})

test("tree: a rewound active lane shows its recorded future faded", async ({ page }) => {
  const h = await openDock(page, DOCK_URL)
  await recordSome(h, ["#toggle", "#spinner", "#toggle"])
  await h.pause()
  const s = await h.state()
  await h.seek(s.start + (s.end - s.start) * 0.4)
  await page.waitForTimeout(400)
  const sc = await dock(page, (D) => ({ ph: D.scene.playhead, lane: D.scene.lanes.find((l) => l.active) }))
  expect(sc.lane.x1).toBeGreaterThan(sc.ph + 50)
  await shot(page, "dock-tree-rewound.png")
})
