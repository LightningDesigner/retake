// Timelines are "Timeline 1", "Timeline 2"... by default; a user's own name
// wins; sessions saved with the old defaults ("Main", "Take N") show the new
// ones, in the dock and through `retake mcp`.
import { test, expect } from "@playwright/test"
import { openDock, DOCK_URL, dock, recordSome } from "./helpers.js"
import { fakeServer } from "./fake-server.js"
import { createTools } from "../../src/server/mcp.js"

const lanes = (page) => page.locator("[data-lane] span").allTextContents()

test("new timelines are Timeline 1, Timeline 2, ... on the lanes and in the lane menu", async ({ page }) => {
  const h = await openDock(page, DOCK_URL)
  await recordSome(h, ["#toggle", "#toggle"])
  await h.pause()
  const s = await h.state()
  await dock(page, (D, t) => window.__retakeDock.newTimelineAt(t), s.start + (s.end - s.start) / 2)
  await expect.poll(() => dock(page, (D) => D.branches.map((b) => b.name))).toEqual(["Timeline 1", "Timeline 2"])
  await h.settle()
  await expect.poll(() => lanes(page)).toEqual(["Timeline 1", "Timeline 2"])
  expect(await page.locator("#wb-dock").textContent()).not.toMatch(/\bMain\b|Take \d/)
  await page.locator('[data-lane="2"]').click({ button: "right" })
  await expect(page.locator("#wb-menu .danger")).toHaveText("Delete Timeline 2")
  await page.keyboard.press("Escape")
  // Renamed by the user: that name stays.
  await dock(page, (D) => (D.branches[1].name = "Try B"))
  await expect.poll(() => lanes(page)).toEqual(["Timeline 1", "Try B"])
  expect(h.dockErrors).toEqual([])
})

test("a session saved with the old default names shows the new ones; names the user chose stay", async ({ page }) => {
  const fake = await fakeServer(page, {
    store: {
      session: {
        branches: [
          { id: 1, parentId: null, forkAt: 0, name: "Main", end: 0 },
          { id: 2, parentId: 1, forkAt: 0, name: "Take 2", end: 0 },
          { id: 3, parentId: 1, forkAt: 0, name: "Main", end: 0 },
          { id: 4, parentId: 1, forkAt: 0, name: "Take 9", end: 0 },
        ],
        activeId: 1,
        markers: [],
        notes: [],
      },
      recordings: {},
    },
  })
  const h = await openDock(page, DOCK_URL)
  const want = ["Timeline 1", "Timeline 2", "Main", "Take 9"]
  await expect.poll(() => dock(page, (D) => D.branches.slice(0, 4).map((b) => b.name))).toEqual(want)
  await expect.poll(() => lanes(page).then((l) => l.slice(0, 4))).toEqual(want)
  // The next save carries the new names.
  await dock(page, (D) => D.markers.push({ id: 1, t: 0, branchId: 1 }))
  await expect.poll(() => fake.store.session.branches.slice(0, 4).map((b) => b.name)).toEqual(want)
  expect(h.dockErrors).toEqual([])
})

test("retake mcp names old default timelines the new way too", async () => {
  const session = {
    branches: [
      { id: 1, parentId: null, forkAt: 0, name: "Main" },
      { id: 2, parentId: 1, forkAt: 1500, name: "Take 2" },
      { id: 3, parentId: 2, forkAt: 2000, name: "Checkout fix" },
    ],
    activeId: 2,
    notes: [{ id: "n1", branchId: 2, t: 2300, selector: "#go", text: "Make this blue", status: "pending", replies: [] }],
  }
  const tools = createTools({ session: async () => session, note: async () => session.notes[0] })
  const t = await tools.handlers.get_active_timeline({})
  expect(t.active.name).toBe("Timeline 2")
  expect(t.active.parent).toBe("Timeline 1")
  expect(t.timelines.map((b) => b.name)).toEqual(["Timeline 1", "Timeline 2", "Checkout fix"])
  expect((await tools.handlers.list_notes({})).notes[0].timeline).toBe("Timeline 2")
})
