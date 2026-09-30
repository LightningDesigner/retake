// The dock's side of --code-branches: which version each timeline keeps.
// The server's /version and /checkout are stood in for, so each case is exact.
import { test, expect } from "@playwright/test"
import { openDock, dock, recordSome } from "./helpers.js"
import { fakeServer } from "./fake-server.js"
import { SHELL_PORTS } from "./servers.js"

const CB_URL = `http://localhost:${SHELL_PORTS.codeBranches}/`

async function fakeCode(page, disk) {
  const calls = []
  await page.route("**/__wayback/version", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify(disk) }))
  await page.route("**/__wayback/checkout*", (r) => {
    const v = new URL(r.request().url()).searchParams.get("v")
    calls.push(v)
    const res = disk.onCheckout ? disk.onCheckout(v) : {}
    disk.version = v
    disk.restored = false
    return r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, version: v, ...res }) })
  })
  return calls
}

async function twoTimelines(h, page) {
  await recordSome(h, ["#toggle", "#toggle"])
  await h.pause()
  const s = await h.state()
  await dock(page, (D, t) => window.__waybackDock.newTimelineAt(t), s.start + (s.end - s.start) * 0.5)
  await expect.poll(() => dock(page, (D) => D.activeId)).toBe(2)
  await page.waitForTimeout(300)
}

test("switching away right after an edit: the timeline left keeps the edit (checkout's `left`)", async ({ page }) => {
  const disk = { version: "A", newest: "A" }
  const calls = await fakeCode(page, disk)
  const h = await openDock(page, CB_URL)
  await expect.poll(() => dock(page, (D) => D.branches[0].version)).toBe("A")
  await twoTimelines(h, page)
  expect(await dock(page, (D) => D.branches[1].version)).toBe("A")
  // An edit on Timeline 2, adopted by the poll.
  disk.version = disk.newest = "B"
  await expect.poll(() => dock(page, (D) => D.branches[1].version)).toBe("B")
  await h.settle()
  // Another edit, and a switch before the poll sees it: checkout snapshots it.
  disk.onCheckout = () => ({ left: "C" })
  await dock(page, () => window.__waybackDock.switchTo(1, 0))
  await expect.poll(() => dock(page, (D) => D.activeId)).toBe(1)
  expect(calls).toEqual(["A"])
  expect(await dock(page, (D) => D.branches.map((b) => b.version))).toEqual(["A", "C"])
  await h.settle()
  delete disk.onCheckout
  await dock(page, () => window.__waybackDock.switchTo(2, 0))
  await expect.poll(() => calls.slice()).toEqual(["A", "C"])
})

test("without `left`, a snapshot that appeared during the checkout goes to the timeline left", async ({ page }) => {
  const disk = { version: "A", newest: "A" }
  await fakeCode(page, disk)
  const h = await openDock(page, CB_URL)
  await expect.poll(() => dock(page, (D) => D.branches[0].version)).toBe("A")
  await twoTimelines(h, page)
  disk.version = disk.newest = "B"
  await expect.poll(() => dock(page, (D) => D.branches[1].version)).toBe("B")
  await h.settle()
  disk.onCheckout = () => {
    disk.newest = "C"
    return {}
  }
  await dock(page, () => window.__waybackDock.switchTo(1, 0))
  await expect.poll(() => dock(page, (D) => D.branches.map((b) => b.version))).toEqual(["A", "C"])
})

test("code the server restored at startup isn't adopted: the active timeline's own code goes back", async ({ page }) => {
  const store = {
    session: {
      branches: [
        { id: 1, parentId: null, forkAt: 0, name: "Timeline 1", codeVersion: "A", end: 0 },
        { id: 2, parentId: 1, forkAt: 0, name: "Timeline 2", codeVersion: "B", end: 0 },
      ],
      activeId: 1,
      markers: [],
      notes: [],
    },
    recordings: {},
  }
  await fakeServer(page, { store })
  const disk = { version: "B", newest: "B", restored: true }
  const calls = await fakeCode(page, disk)
  await openDock(page, CB_URL)
  await expect.poll(() => calls.slice()).toEqual(["A"])
  await page.waitForTimeout(1200)
  expect(await dock(page, (D) => D.branches.map((b) => b.version))).toEqual(["A", "B"])
  expect(calls).toEqual(["A"])
})
