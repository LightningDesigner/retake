// M2: the dock sits under the app, resizes with a divider, and keeps the
// session on the server (F10, F18).
import { test, expect } from "@playwright/test"
import { openDock, DOCK_URL, recordSome } from "./helpers.js"
import { fakeServer } from "./fake-server.js"

const D = (page, fn, arg) => page.evaluate(`(${fn})(window.__waybackDock.state, ${JSON.stringify(arg)})`)

async function forkMid(h) {
  await h.pause()
  const s = await h.state()
  await h.seek(s.start + (s.end - s.start) / 2)
  await expect
    .poll(async () => {
      await h.rt(() => __wayback.forkHere()).catch(() => {})
      return D(h.page, (d) => d.branches.length)
    })
    .toBe(2)
  await h.settle()
}

test("the dock sits below the app, never over it, and the divider resizes both", async ({ page }) => {
  const h = await openDock(page, DOCK_URL)
  const box = async () => {
    const stage = await page.locator("#wb-stage").boundingBox()
    const dock = await page.locator("#wb-dock").boundingBox()
    return { stage, dock }
  }
  let { stage, dock } = await box()
  expect(stage.y + stage.height).toBeLessThanOrEqual(dock.y + 0.5)
  expect(dock.y + dock.height).toBeCloseTo(800, 0)
  const div = await page.locator(".divider").boundingBox()
  await page.mouse.move(div.x + 200, div.y + div.height / 2)
  await page.mouse.down()
  await page.mouse.move(div.x + 200, div.y - 100, { steps: 5 })
  await page.mouse.up()
  await page.waitForTimeout(100)
  const after = await box()
  expect(after.dock.height).toBeCloseTo(dock.height + 100, -1)
  expect(after.stage.height).toBeCloseTo(stage.height - 100, -1)
  const frame = await page.locator("#wb-stage iframe.live").boundingBox()
  expect(frame.height).toBeCloseTo(after.stage.height, 0)
  await page.reload()
  await h.settle()
  expect((await page.locator("#wb-dock").boundingBox()).height).toBeCloseTo(after.dock.height, 0)
  expect(h.dockErrors).toEqual([])
})

test("without a session API the dock keeps everything in memory", async ({ page }) => {
  await page.route("**/__wayback/session", (r) => r.fulfill({ status: 404, body: "" }))
  const h = await openDock(page, DOCK_URL, { fake: false })
  await recordSome(h, ["#toggle"])
  await forkMid(h)
  expect(await D(page, (d) => d.branches.map((b) => b.id))).toEqual([1, 2])
  expect(h.errors).toEqual([])
  expect(h.dockErrors).toEqual([])
})

test("F10: timelines, notes and recordings are saved and come back after a reload", async ({ page }) => {
  const fake = await fakeServer(page)
  const h = await openDock(page, DOCK_URL)
  await recordSome(h, ["#toggle", "#toggle"])
  await forkMid(h)
  await D(page, (d) => {
    d.branches[1].name = "Try B"
    d.notes.push({ id: "n1", t: d.branches[1].forkAt, branchId: 2, text: "hello", status: "pending", replies: [],
      el: { label: "<div#card>", text: "", selector: "#card", components: [], rect: { x: 0, y: 0, w: 10, h: 10 }, page: "/" } })
  })
  await expect.poll(() => fake.store.session && fake.store.session.branches.map((b) => b.name)).toEqual(["Timeline 1", "Try B"])
  expect(fake.store.session.activeId).toBe(2)
  expect(fake.store.session.notes[0]).toMatchObject({ id: "n1", text: "hello", selector: "#card", status: "pending" })
  expect(fake.puts("session").every((p) => p.token !== undefined)).toBe(true)
  await expect.poll(() => Object.keys(fake.store.recordings).sort()).toEqual(["1", "2"])
  const savedEnd = JSON.parse(fake.store.recordings["2"]).end

  await page.reload()
  await expect.poll(() => D(page, (d) => d.branches.map((b) => b.name)).catch(() => null)).toEqual(["Timeline 1", "Try B"])
  expect(await D(page, (d) => d.activeId)).toBe(2)
  expect(await D(page, (d) => d.notes.map((n) => n.text))).toEqual(["hello"])
  // The active timeline's recording is loaded back into the frame, at its end.
  await expect.poll(async () => (await h.state().catch(() => ({ end: 0 }))).end).toBeGreaterThanOrEqual(savedEnd - 1)
  await expect.poll(async () => (await h.state().catch(() => ({ now: 0 }))).now, { timeout: 15000 }).toBeGreaterThanOrEqual(savedEnd - 50)
  expect(await D(page, (d) => d.branches[1].end)).toBeGreaterThanOrEqual(savedEnd - 1)
  expect(h.dockErrors).toEqual([])
})

test("saves are debounced: a burst of changes is one PUT", async ({ page }) => {
  const fake = await fakeServer(page)
  const h = await openDock(page, DOCK_URL)
  await recordSome(h, ["#toggle"])
  await h.pause()
  await page.waitForTimeout(800)
  const before = fake.puts("session").length
  await D(page, async (d) => {
    for (let i = 0; i < 5; i++) {
      d.branches[0].name = "Name " + i
      await new Promise((r) => setTimeout(r, 60))
    }
  })
  await page.waitForTimeout(900)
  const after = fake.puts("session")
  expect(after.length - before).toBe(1)
  expect(JSON.parse(after[after.length - 1].body).branches[0].name).toBe("Name 4")
})

test("agent replies arrive over SSE and show on the note", async ({ page }) => {
  const store = {
    session: { branches: [{ id: 1, parentId: null, forkAt: 0, name: "Timeline 1", codeVersion: null, end: 0 }], activeId: 1, markers: [],
      notes: [{ id: "n9", branchId: 1, t: 10, clip: null, selector: "#card", component: null, source: null, classes: [], rect: { x: 0, y: 0, w: 1, h: 1 }, text: "make it blue", status: "pending", replies: [] }] },
    recordings: {},
  }
  await fakeServer(page, { store, events: [{ type: "note-updated", data: { id: "n9", status: "acknowledged", replies: [{ from: "agent", text: "On it", at: 1 }] } }] })
  const h = await openDock(page, DOCK_URL)
  await expect.poll(() => D(page, (d) => d.notes[0] && d.notes[0].status)).toBe("acknowledged")
  expect(await D(page, (d) => d.notes[0].replies.map((r) => r.text))).toEqual(["On it"])
  expect(h.dockErrors).toEqual([])
})

test("Start fresh clears timelines and notes, after a confirming second click", async ({ page }) => {
  const fake = await fakeServer(page)
  const h = await openDock(page, DOCK_URL)
  await recordSome(h, ["#toggle"])
  await forkMid(h)
  const fresh = page.locator('[data-a="fresh"]')
  await fresh.click()
  expect(await D(page, (d) => d.branches.length)).toBe(2)
  await expect(fresh).toHaveText(/clear/i)
  await fresh.click()
  await expect.poll(() => D(page, (d) => d.branches.map((b) => b.id))).toEqual([1])
  await expect.poll(() => fake.store.session && fake.store.session.branches.length).toBe(1)
  await h.settle()
  expect(h.dockErrors).toEqual([])
})

test("F18: a rebuilding frame is pinned to the recorded viewport", async ({ page }) => {
  const h = await openDock(page, DOCK_URL)
  await recordSome(h, ["#toggle"])
  await h.pause()
  await page.evaluate(() => {
    window.__sizes = []
    new MutationObserver((ms) => {
      for (const m of ms) for (const n of m.addedNodes) if (n.tagName === "IFRAME") window.__sizes.push([n.style.width, n.style.height])
    }).observe(document.querySelector("#wb-stage"), { childList: true })
  })
  await h.rt(() => {
    __wayback.timeline = () => ({ now: 0, end: 0, viewport: { w: 640, h: 360 }, markers: [], clips: [] })
  })
  // The recording's own viewport wins over timeline()'s.
  const vp = (await h.rt(() => __wayback.history().viewport)) || { w: 640, h: 360 }
  const s = await h.state()
  await h.seek(s.start + 50)
  expect(await page.evaluate(() => window.__sizes)).toContainEqual([vp.w + "px", vp.h + "px"])
  // Once swapped in, the frame fills the stage again.
  const stage = await page.locator("#wb-stage").boundingBox()
  expect((await page.locator("#wb-stage iframe.live").boundingBox()).width).toBeCloseTo(stage.width, 0)
})

test("the dock never takes focus away from a frame being rebuilt (replayed keys keep their target)", async ({ page }) => {
  const h = await openDock(page, DOCK_URL)
  await h.click("#idea")
  await page.keyboard.type("A lighthouse")
  await page.keyboard.press("Enter")
  await page.waitForTimeout(300)
  expect(await h.rt(() => document.querySelector("#sent").textContent)).toBe("sent: A lighthouse")
  await page.waitForTimeout(300)
  await h.pause()
  const s = await h.state()
  await page.evaluate(() => {
    window.__blurred = []
    const orig = HTMLIFrameElement.prototype.blur
    HTMLIFrameElement.prototype.blur = function () {
      window.__blurred.push(this.className)
      return orig.call(this)
    }
  })
  // Rebuild a moment before the end and then after the Enter: the replay
  // has to type into the textarea and press Enter there.
  // (Going back from the end rebuilds from the start, replaying the typing.)
  // While a moment builds, give the hidden frame focus (as a replayed
  // focus() on a textarea would) and see if the dock takes it away.
  await page.evaluate(() => {
    window.__stole = null
    const watch = () => {
      const f = document.querySelector("#wb-stage iframe.building")
      if (!f) return requestAnimationFrame(watch)
      f.focus()
      setTimeout(() => (window.__stole = document.activeElement !== f && document.querySelector("#wb-stage iframe.building") === f), 120)
    }
    watch()
  })
  await h.rt((t) => __wayback.seek(t), s.end - 50)
  await expect.poll(() => page.evaluate(() => window.__stole)).not.toBe(null)
  expect(await page.evaluate(() => window.__stole)).toBe(false)
  await h.settle()
  expect(await h.rt(() => document.querySelector("#sent").textContent)).toBe("sent: A lighthouse")
  expect(await page.evaluate(() => window.__blurred.filter((c) => c.includes("building")))).toEqual([])
  expect(h.dockErrors).toEqual([])
})

test("reopening a one-timeline session lands where it was (its end), not at 0", async ({ page }) => {
  const fake = await fakeServer(page)
  const h = await openDock(page, DOCK_URL)
  await recordSome(h, ["#toggle", "#toggle"])
  await h.pause()
  await expect.poll(() => fake.store.recordings["1"] && JSON.parse(fake.store.recordings["1"]).end, { timeout: 8000 }).toBeGreaterThan(500)
  const savedEnd = JSON.parse(fake.store.recordings["1"]).end
  await page.reload()
  await expect.poll(async () => (await h.state().catch(() => ({ now: 0 }))).now, { timeout: 15000 }).toBeGreaterThanOrEqual(savedEnd - 50)
  expect(await D(page, (d) => d.branches[0].end)).toBeGreaterThanOrEqual(savedEnd - 1)
  expect(h.dockErrors).toEqual([])
})
