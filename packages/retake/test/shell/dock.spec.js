// 0.5.0: the dock folds down to an icon, notes show only when paused, the top
// row fits a phone, and a dock with no Retake server behind it asks it nothing.
import { test, expect } from "@playwright/test"
import { openDock, DOCK_URL, dock, recordSome, shot } from "./helpers.js"
import { shellHtml } from "../../src/plugin.js"

const SHOW = 'button[aria-label="Show timeline"]'

// Drag the divider's handle to (near) a y on the page.
async function dragDivider(page, toY) {
  const div = await page.locator(".divider span").boundingBox()
  await page.mouse.move(div.x + div.width / 2, div.y + div.height / 2)
  await page.mouse.down()
  await page.mouse.move(div.x + div.width / 2, toY, { steps: 8 })
  await page.mouse.up()
}

// What's on top at a point of the window: the app's frame, or a part of the dock.
const topAt = (page, x, y) =>
  page.evaluate(([x, y]) => {
    const el = document.elementFromPoint(x, y)
    return el ? (el.tagName === "IFRAME" ? "app" : el.closest("#wb-dock") ? "dock" : el.id || el.tagName) : null
  }, [x, y])

test("dragging the divider to the bottom folds the timeline into an icon; it keeps recording, and the icon brings it back", async ({ page }) => {
  const h = await openDock(page, DOCK_URL)
  await page.evaluate(() => localStorage.removeItem("retake:collapsed"))
  await expect(page.locator(SHOW)).toBeHidden()
  expect(await topAt(page, 640, 760)).toBe("dock")
  // Past the minimum height but not far: it springs back to the minimum.
  await dragDivider(page, 800 - 60)
  await page.waitForTimeout(100)
  await expect(page.locator(SHOW)).toBeHidden()
  // All the way down: an icon in the bottom-right corner, and the app has the whole window.
  await dragDivider(page, 799)
  const icon = page.locator(SHOW)
  await expect(icon).toBeVisible()
  await expect(page.locator("#wb-dock")).toBeHidden()
  const b = await icon.boundingBox()
  expect(b.width).toBeGreaterThanOrEqual(40)
  expect(b.width).toBeLessThanOrEqual(56)
  expect(b.x + b.width).toBeGreaterThan(1280 - 40)
  expect(b.x + b.width).toBeLessThanOrEqual(1280 - 8)
  expect(b.y + b.height).toBeGreaterThan(800 - 40)
  expect(b.y + b.height).toBeLessThanOrEqual(800 - 8)
  expect(await topAt(page, 640, 760)).toBe("app")
  expect(await topAt(page, 640, 798)).toBe("app")
  expect(await page.locator("#wb-stage iframe.live").boundingBox()).toMatchObject({ x: 0, y: 0, width: 1280, height: 800 })
  await shot(page, "collapsed.png")

  // Still recording: the app is live and time moves on.
  const t0 = (await h.state()).now
  await h.click("#toggle")
  await page.waitForTimeout(400)
  const s = await h.state()
  expect(s.playing).toBe(true)
  expect(s.now).toBeGreaterThan(t0 + 300)
  expect((await h.rt(() => __retake.timeline().markers)).some((m) => m.kind === "click")).toBe(true)

  // Remembered across a reload.
  await page.reload()
  await h.settle()
  await expect(page.locator(SHOW)).toBeVisible()
  await expect(page.locator("#wb-dock")).toBeHidden()

  // A real button: Enter on it brings the dock back at its default height.
  await page.locator(SHOW).focus()
  await page.keyboard.press("Enter")
  await expect(page.locator("#wb-dock")).toBeVisible()
  await expect(page.locator(SHOW)).toBeHidden()
  await expect.poll(async () => Math.round((await page.locator("#wb-dock").boundingBox()).height)).toBe(200)
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("retake:collapsed")))).toBe(false)

  // ⌥T folds and unfolds it too; a click on the icon works like Enter.
  await page.keyboard.press("Alt+KeyT")
  await expect(page.locator(SHOW)).toBeVisible()
  await page.locator(SHOW).click()
  await expect(page.locator("#wb-dock")).toBeVisible()
  expect(h.dockErrors).toEqual([])
})

test("note pins on the app show only while paused; the count stays", async ({ page }) => {
  const h = await openDock(page, DOCK_URL)
  await recordSome(h, ["#toggle"])
  await h.pause()
  await h.settle()
  await dock(page, (D) => {
    D.notes.push({ id: "p1", t: D.last.now, branchId: D.activeId, text: "tighter", status: "pending", replies: [],
      el: { label: "<div#card>", text: "", selector: "#card", components: [], rect: { x: 40, y: 40, w: 100, h: 60 }, at: { dx: 0.5, dy: 0.5 }, page: "/" } })
  })
  const pin = page.locator(".canvas-pin")
  await expect(pin).toBeVisible()
  await expect(page.locator(".notes-count .n")).toHaveText("1")
  // Open its bubble, then play: pin and bubble go, the count stays.
  await pin.click()
  await expect(page.locator("#wb-note")).toBeVisible()
  await h.rt(() => __retake.play())
  await expect(pin).toBeHidden()
  await expect(page.locator("#wb-note")).toBeHidden()
  await expect(page.locator(".notes-count .n")).toHaveText("1")
  await expect(page.locator(".notes-count")).toHaveClass(/has/)
  await page.waitForTimeout(300)
  await expect(pin).toBeHidden()
  // Paused again: the note is back.
  await h.pause()
  await expect(pin).toBeVisible()
  expect(h.dockErrors).toEqual([])
})

for (const width of [360, 375, 390]) {
  test(`phone width ${width}px: the dock's top row fits, Start fresh included`, async ({ page }) => {
    await page.setViewportSize({ width, height: 720 })
    const h = await openDock(page, DOCK_URL)
    await recordSome(h, ["#toggle"])
    const d = await page.locator("#wb-dock").boundingBox()
    for (const sel of ['[data-a="play"]', ".readout .t", '[data-tool="hand"]', '[data-tool="comment"]', ".notes-count", '[data-a="fresh"]']) {
      const b = await page.locator(sel).boundingBox()
      expect(b, sel).toBeTruthy()
      expect(b.x, sel).toBeGreaterThanOrEqual(d.x)
      expect(b.x + b.width, sel).toBeLessThanOrEqual(d.x + d.width)
      expect(b.y + b.height, sel).toBeLessThanOrEqual(d.y + 64)
    }
    // Big enough for a finger (40px), the divider's strip included.
    for (const sel of ['[data-a="play"]', '[data-tool="hand"]', '[data-tool="comment"]', '[data-a="fresh"]']) {
      const b = await page.locator(sel).boundingBox()
      expect(Math.min(b.width, b.height), sel).toBeGreaterThanOrEqual(40)
    }
    expect((await page.locator(".divider").boundingBox()).height).toBeGreaterThanOrEqual(32)
    // Nothing scrolled out of sight in the row, and Start fresh is named and usable.
    expect(await page.evaluate(() => { const r = document.querySelector(".head .right"); return r.scrollWidth <= r.clientWidth + 1 })).toBe(true)
    await expect(page.getByRole("button", { name: "Start fresh" })).toBeVisible()
    const f = await page.locator('[data-a="fresh"]').boundingBox()
    expect(await topAt(page, f.x + f.width / 2, f.y + f.height / 2)).toBe("dock")
    await shot(page, `phone-${width}.png`)
    expect(h.dockErrors).toEqual([])
  })
}

test("server: false: the dock never asks for /__retake/ (no session fetch, no 404 in the console)", async ({ page }) => {
  const asked = []
  const consoleErrors = []
  page.on("request", (r) => new URL(r.url()).pathname.startsWith("/__retake/") && asked.push(r.method() + " " + new URL(r.url()).pathname))
  page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()))
  // The dock page as a static host would serve it.
  await page.route(DOCK_URL, (r) => r.fulfill({ status: 200, contentType: "text/html", body: shellHtml({ server: false }) }))
  expect(shellHtml({ server: false })).toContain('"server":false')
  expect(shellHtml()).not.toContain('"server"')
  const h = await openDock(page, DOCK_URL, { fake: false })
  await recordSome(h, ["#toggle"])
  await h.pause()
  await page.waitForTimeout(1200)
  expect(asked).toEqual([])
  expect(consoleErrors).toEqual([])
  // Everything still works in memory.
  expect(await dock(page, (D) => D.branches.length)).toBe(1)
  expect(h.dockErrors).toEqual([])
})

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test("a touch drag on the divider folds the dock, and the app takes taps afterwards (F79)", async ({ page }) => {
    const h = await openDock(page, DOCK_URL)
    await page.evaluate(() => localStorage.removeItem("retake:collapsed"))
    await recordSome(h, ["#toggle"])
    const clicks = () => h.rt(() => __retake.timeline().markers.filter((m) => m.kind === "click").length)
    const before = await clicks()
    // A finger on the handle, dragged to the bottom edge, the way a browser sends it.
    const cdp = await page.context().newCDPSession(page)
    const div = await page.locator(".divider span").boundingBox()
    const x = Math.round(div.x + div.width / 2)
    let y = Math.round(div.y + div.height / 2)
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] })
    for (let i = 1; i <= 16; i++) {
      y = Math.round(div.y + ((843 - div.y) * i) / 16)
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y }] })
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
    await expect(page.locator(SHOW)).toBeVisible()
    await expect(page.locator("#wb-dock")).toBeHidden()
    expect(await page.evaluate(() => document.body.classList.contains("dragging"))).toBe(false)
    // The app still answers a tap.
    const b = await h.box("#toggle")
    await page.touchscreen.tap(b.x + b.w / 2, b.y + b.h / 2)
    await expect.poll(clicks).toBe(before + 1)
    // The round button brings it back.
    await page.locator(SHOW).tap()
    await expect(page.locator("#wb-dock")).toBeVisible()
    expect(h.dockErrors).toEqual([])
  })
})

test("⌥T while typing a note types, it doesn't fold the dock or drop the draft (F80)", async ({ page }) => {
  const h = await openDock(page, DOCK_URL)
  await recordSome(h, ["#toggle"])
  await h.pause()
  await page.locator('[data-tool="comment"]').click()
  const b = await h.box("#card")
  await page.mouse.click(b.x + b.w / 2, b.y + b.h / 2)
  const ta = page.locator("#wb-note textarea")
  await expect(ta).toBeVisible()
  // The composer focuses its field a task after it opens: type once it has the focus.
  await expect(ta).toBeFocused()
  await ta.fill("Make the dagger ")
  await ta.press("Alt+KeyT")
  await expect(page.locator(SHOW)).toBeHidden()
  await expect(ta).toBeVisible()
  await expect(ta).toHaveValue(/^Make the dagger /)
  // Outside a field it still folds.
  await page.keyboard.press("Escape")
  await page.locator(".track").click()
  await page.keyboard.press("Alt+KeyT")
  await expect(page.locator(SHOW)).toBeVisible()
  expect(h.dockErrors).toEqual([])
})

test("picking again while a note is being written keeps what was typed (F149)", async ({ page }) => {
  const h = await openDock(page, DOCK_URL)
  await recordSome(h, ["#toggle"])
  await h.pause()
  await page.locator('[data-tool="comment"]').click()
  const b = await h.box("#card")
  await page.mouse.click(b.x + b.w / 2, b.y + b.h / 2)
  const ta = page.locator("#wb-note textarea")
  await expect(ta).toBeFocused()
  await ta.fill("Keep these words")
  await page.mouse.click(b.x + b.w / 2 + 4, b.y + b.h / 2)
  await expect(ta).toBeVisible()
  await expect(ta).toHaveValue("Keep these words")
  expect(h.dockErrors).toEqual([])
})

test("the app can leave room for the dock: window.__retakeDockHeight and a retake:dock event, 0 when folded (F81)", async ({ page }) => {
  const h = await openDock(page, DOCK_URL)
  await page.evaluate(() => localStorage.removeItem("retake:collapsed"))
  const app = () => page.locator("#wb-stage iframe.live").evaluate((f) => f.contentWindow.__retakeDockHeight)
  await expect.poll(app).toBe(200)
  await page.locator("#wb-stage iframe.live").evaluate((f) => {
    f.contentWindow.__seen = []
    f.contentWindow.addEventListener("retake:dock", (e) => f.contentWindow.__seen.push(e.detail.height))
  })
  await dragDivider(page, 799)
  await expect(page.locator(SHOW)).toBeVisible()
  await expect.poll(app).toBe(0)
  await page.locator(SHOW).click()
  await expect.poll(app).toBe(200)
  const seen = await page.locator("#wb-stage iframe.live").evaluate((f) => f.contentWindow.__seen)
  expect(seen.slice(-2)).toEqual([0, 200])
  expect(h.dockErrors).toEqual([])
})

test("a link to another site opens in a new tab; the app's frame and the timeline stay", async ({ page, context }) => {
  await context.route("https://example.com/**", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<p>elsewhere</p>" }))
  const h = await openDock(page, DOCK_URL + "?ext")
  const frame = page.frameLocator("#wb-stage iframe").first()
  await frame.locator("#ext").waitFor()
  const before = await dock(page, (D) => D.PT.state().now)
  const [tab] = await Promise.all([context.waitForEvent("page"), frame.locator("#ext").click()])
  await tab.waitForLoadState()
  expect(tab.url()).toBe("https://example.com/elsewhere")
  expect(page.url().startsWith(DOCK_URL)).toBe(true)
  await expect(frame.locator("#ext")).toBeVisible()
  expect(await dock(page, (D) => D.PT.state().now)).toBeGreaterThan(before)
  expect(h.dockErrors).toEqual([])
})

// F145: an app that autofocuses a field: Space types into it while live (the
// app has the keys), so the dock's key that always works is ⌥P; and the Play
// button takes a click with the app's field focused.
test("F145: with an app field focused, ⌥P pauses and plays, and a click on Play pauses", async ({ page }) => {
  const h = await openDock(page, DOCK_URL + "?autofocus")
  const playing = () => dock(page, (D) => !!(D.last && D.last.playing))
  await expect.poll(playing).toBe(true)
  const frame = await h.liveFrame()
  await frame.locator("#ask").click()
  await page.keyboard.type("hi there")
  await expect(frame.locator("#ask")).toHaveValue("hi there")
  await expect.poll(playing).toBe(true)
  await page.keyboard.press("Alt+KeyP")
  await expect.poll(playing).toBe(false)
  await expect(frame.locator("#ask")).toHaveValue("hi there")
  await page.keyboard.press("Alt+KeyP")
  await expect.poll(playing).toBe(true)
  // Focus back in the app's field, then the dock's Play button.
  await (await h.liveFrame()).locator("#ask").click()
  await page.locator("#wb-dock button.play").click()
  await expect.poll(playing).toBe(false)
  await page.locator("#wb-dock button.play").click()
  await expect.poll(playing).toBe(true)
  expect(h.dockErrors).toEqual([])
})
