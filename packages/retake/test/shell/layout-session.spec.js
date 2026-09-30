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

test("the app fills the window; a glass notch floats over its bottom edge; resizing the dock never resizes the app", async ({ page }) => {
  const h = await openDock(page, DOCK_URL)
  const frame0 = await page.locator("#wb-stage iframe.live").boundingBox()
  expect(frame0).toMatchObject({ x: 0, y: 0, width: 1280, height: 800 })
  const dock = await page.locator("#wb-dock").boundingBox()
  expect(dock.y + dock.height).toBeCloseTo(800, 0)
  expect(dock.x).toBeCloseTo(16, 0)
  expect(dock.x + dock.width).toBeCloseTo(1280 - 16, 0)
  const look = await page.evaluate(() => {
    const cs = getComputedStyle(document.querySelector("#wb-dock"))
    return { tl: cs.borderTopLeftRadius, bl: cs.borderBottomLeftRadius, blur: cs.backdropFilter || cs.webkitBackdropFilter, body: getComputedStyle(document.body).backgroundColor, pos: cs.position }
  })
  expect(look).toMatchObject({ tl: "18px", bl: "0px", pos: "fixed" })
  expect(look.blur).toContain("blur(28px)")
  expect(look.body).toBe("rgba(0, 0, 0, 0)")
  // Drag the handle up 100px: the notch grows, the app doesn't change.
  const div = await page.locator(".divider span").boundingBox()
  await page.mouse.move(div.x + div.width / 2, div.y + div.height / 2)
  await page.mouse.down()
  await page.mouse.move(div.x + div.width / 2, div.y + div.height / 2 - 100, { steps: 5 })
  await page.mouse.up()
  await page.waitForTimeout(100)
  expect((await page.locator("#wb-dock").boundingBox()).height).toBeCloseTo(dock.height + 100, -1)
  expect(await page.locator("#wb-stage iframe.live").boundingBox()).toEqual(frame0)
  // "Don't cover app": the app ends above the notch.
  await page.locator('[data-a="more"]').click()
  await page.locator('[data-a="reserve"]').click()
  const d2 = await page.locator("#wb-dock").boundingBox()
  const f2 = await page.locator("#wb-stage iframe.live").boundingBox()
  expect(f2.y + f2.height).toBeCloseTo(d2.y, 0)
  // Remembered across a reload, like the dock's height.
  await page.reload()
  await h.settle()
  expect((await page.locator("#wb-dock").boundingBox()).height).toBeCloseTo(dock.height + 100, -1)
  expect(await page.evaluate(() => document.body.classList.contains("reserve"))).toBe(true)
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
  await expect.poll(() => fake.store.session && fake.store.session.branches.map((b) => b.name)).toEqual(["Main", "Try B"])
  expect(fake.store.session.activeId).toBe(2)
  expect(fake.store.session.notes[0]).toMatchObject({ id: "n1", text: "hello", selector: "#card", status: "pending" })
  expect(fake.puts("session").every((p) => p.token !== undefined)).toBe(true)
  await expect.poll(() => Object.keys(fake.store.recordings).sort()).toEqual(["1", "2"])
  const savedEnd = JSON.parse(fake.store.recordings["2"]).end

  await page.reload()
  // The timelines and notes come back (the reload itself opens live, see
  // reload.spec.js).
  await expect.poll(() => D(page, (d) => d.branches.slice(0, 2).map((b) => b.name)).catch(() => null)).toEqual(["Main", "Try B"])
  expect(await D(page, (d) => d.notes.map((n) => n.text))).toEqual(["hello"])
  expect(await D(page, (d) => d.branches[1].end)).toBeGreaterThanOrEqual(savedEnd - 1)
  // Selecting the saved timeline brings its recording back, at its end.
  await D(page, () => window.__waybackDock.switchTo(2, 1e9))
  await expect.poll(async () => (await h.state().catch(() => ({ end: 0 }))).end, { timeout: 15000 }).toBeGreaterThanOrEqual(savedEnd - 1)
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

test("Start fresh clears at once, with 5 seconds to Undo; the server is only told after that", async ({ page }) => {
  const fake = await fakeServer(page)
  const h = await openDock(page, DOCK_URL)
  await recordSome(h, ["#toggle"])
  await forkMid(h)
  await expect.poll(() => fake.store.session && fake.store.session.branches.length).toBe(2)
  const puts = fake.puts("session").length
  await page.locator('[data-a="fresh"]').click()
  expect(await D(page, (d) => d.branches.map((b) => b.id))).toEqual([1])
  await expect(page.locator("#wb-toast")).toBeVisible()
  await expect(page.locator("#wb-toast")).toContainText("Session cleared")
  await page.waitForTimeout(800)
  expect(fake.puts("session").length).toBe(puts)
  await page.locator('[data-a="undo"]').click()
  await expect(page.locator("#wb-toast")).toBeHidden()
  expect(await D(page, (d) => d.branches.map((b) => b.id))).toEqual([1, 2])
  expect(await D(page, (d) => d.activeId)).toBe(2)
  await h.settle()
  expect(fake.store.session.branches.length).toBe(2)

  // Again, and this time let it go: after 5s the server has the fresh session.
  await page.locator('[data-a="fresh"]').click()
  await expect(page.locator("#wb-toast")).toBeHidden({ timeout: 7000 })
  await expect.poll(() => fake.store.session.branches.length).toBe(1)
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

test("a reload keeps the saved timeline whole, and opens the app live", async ({ page }) => {
  const fake = await fakeServer(page)
  const h = await openDock(page, DOCK_URL)
  await recordSome(h, ["#toggle", "#toggle"])
  await h.pause()
  await expect.poll(() => fake.store.recordings["1"] && JSON.parse(fake.store.recordings["1"]).end, { timeout: 8000 }).toBeGreaterThan(500)
  const savedEnd = JSON.parse(fake.store.recordings["1"]).end
  await page.reload()
  await expect.poll(() => D(page, (d) => !!d.PT && d.last && d.last.booted).catch(() => false)).toBe(true)
  expect(await D(page, (d) => d.branches[0].end)).toBeGreaterThanOrEqual(savedEnd - 1)
  expect(await D(page, (d) => d.last.playing)).toBe(true)
  // The saved recording on the server is untouched by the new visit.
  await page.waitForTimeout(1000)
  expect(JSON.parse(fake.store.recordings["1"]).end).toBeGreaterThanOrEqual(savedEnd - 1)
  expect(h.dockErrors).toEqual([])
})
