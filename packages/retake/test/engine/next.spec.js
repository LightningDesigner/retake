// Next.js 16 (app router, Turbopack) behind the front server: `retake <the
// Next fixture>` runs `npm run dev` and docks it. Retake on 3340, Next on 3341.
// The fixture is copied into the OS temp dir and installed there once (see
// frameworks.js); without its dependencies (offline, first run) these skip.
// Covers F46 (no __wb), F54 (the HMR socket isn't recorded), F47 (hydration on
// the virtual clock), F48 (lazily loaded chunks), F35 (storage across frames),
// replay of server actions and soft navigations, the pages router, reloads, HMR.
import fs from "node:fs"
import path from "node:path"
import { test, expect } from "@playwright/test"
import { fixtureDir, startFramework } from "./frameworks.js"
import { openDock } from "./helpers.js"

const PORT = 3340
let fw = null
test.describe.configure({ mode: "serial" })
test.beforeAll(async () => {
  test.setTimeout(180_000)
  const dir = fixtureDir("next")
  test.skip(!dir, "the Next fixture's dependencies couldn't be installed")
  fw = await startFramework("next", PORT, { dir, args: ["--verbose"] })
})
test.afterAll(async () => fw && fw.stop())

const fx = (h) => h.rt(() => JSON.parse(JSON.stringify(window.__fx ? window.__fx.log : [])))
const hydrated = (h) => h.rt(() => !!document.querySelector("#inc") && Object.keys(document.querySelector("#inc")).some((k) => k.startsWith("__reactFiber")))
async function open(page, p = "/") {
  const warnings = []
  page.on("console", (m) => (m.type() === "error" || m.type() === "warning") && warnings.push(m.text()))
  const h = await openDock(page, fw.url + p)
  h.warnings = warnings
  return h
}
// What the app logged up to t. A rebuild to t stops just short of t, and
// rests there: a timer due in the frame before t runs when time moves on, as
// it did live, so the last frame before t is left out.
const upTo = (log, k, t) => log.filter((e) => e.k === k && e.vt < t + 1000 - 20).map((e) => [e.vt, e.v])

test("the app hydrates in the dock's frame: no __wb anywhere, no hydration warnings, the HMR socket isn't recorded (F46, F54)", async ({ page }) => {
  const h = await open(page)
  await expect.poll(() => hydrated(h), { timeout: 15_000 }).toBe(true)
  await page.waitForTimeout(500)
  await h.click("#to-about")
  await expect.poll(() => h.rt(() => !!document.querySelector("#about")), { timeout: 10_000 }).toBe(true)
  await h.pause()
  expect(await h.rt(() => location.href)).not.toContain("__wb")
  const r = await h.rt(() => __retake.history())
  expect((r.sockets || []).filter(Boolean).map((s) => s.key)).toEqual([])
  expect(r.fetches.map((f) => f.key).join(" ")).not.toContain("__wb")
  expect(r.fetches.map((f) => f.key).join(" ")).not.toContain("_rsc=")
  const log = fs.readFileSync(path.join(fw.dir, ".retake", "front.log"), "utf8")
  expect(log).not.toContain("__wb")
  expect(log).toContain('"inject":true')
  // The page's own iframe got the script, and it stayed inert.
  const emb = await (await (await h.liveFrame()).$("#emb")).contentFrame()
  await expect.poll(() => emb.evaluate(() => !!document.querySelector("#emb-body")), { timeout: 10_000 }).toBe(true)
  expect(await emb.evaluate(() => window.__retake && window.__retake.inert)).toBe(true)
  expect(h.warnings.filter((w) => /hydrat/i.test(w))).toEqual([])
})

test("a server action and a soft navigation replay, rebuilt and played (debug channel off)", async ({ page }) => {
  const h = await open(page)
  await expect.poll(() => hydrated(h), { timeout: 15_000 }).toBe(true)
  await page.waitForTimeout(300)
  await h.click("#inc")
  await expect.poll(() => h.rt(() => document.querySelector("#inc").textContent)).toBe("count 1")
  await h.click("#act")
  await expect.poll(() => h.rt(() => document.querySelector("#srv").textContent)).toBe("server says 10")
  await page.waitForTimeout(300)
  const tAct = (await h.state()).now
  await h.click("#to-about")
  await expect.poll(() => h.rt(() => !!document.querySelector("#about")), { timeout: 10_000 }).toBe(true)
  await page.waitForTimeout(300)
  await h.pause()
  const end = (await h.state()).end
  await h.seek(tAct)
  expect(await h.rt(() => [location.pathname, document.querySelector("#srv").textContent])).toEqual(["/", "server says 10"])
  await h.seek(end - 5)
  expect(await h.rt(() => [location.pathname, !!document.querySelector("#about")])).toEqual(["/about", true])
  await h.seek(200)
  await h.rt(() => __retake.play())
  await expect.poll(() => h.rt(() => [location.pathname, !!document.querySelector("#about")]), { timeout: end + 5000 }).toEqual(["/about", true])
  await h.pause()
  expect(h.errors).toEqual([])
})

test("hydration runs at the same virtual moment live and rebuilt: the typed headline matches at every moment (F47)", async ({ page }) => {
  const h = await open(page)
  await expect.poll(() => hydrated(h), { timeout: 15_000 }).toBe(true)
  await page.waitForTimeout(1800)
  await h.pause()
  const live = await fx(h)
  expect(upTo(live, "headline", 1800).length).toBeGreaterThan(20)
  for (const t of [150, 400, 700, 1000, 1500]) {
    await h.seek(t)
    expect(upTo(await fx(h), "headline", t), `at ${t}`).toEqual(upTo(live, "headline", t))
  }
})

test("a chunk loaded once the page runs lands at its recorded moment: every Math.random() matches (F48)", async ({ page }) => {
  const h = await open(page)
  await expect.poll(() => hydrated(h), { timeout: 15_000 }).toBe(true)
  await page.waitForTimeout(1800)
  await h.pause()
  const live = await fx(h)
  const loads = await h.rt(() => __retake.history().events.filter((e) => e.type === "script").map((e) => e.url))
  expect(loads.some((u) => /late/.test(u))).toBe(true)
  expect(upTo(live, "late", 1800)).toHaveLength(1)
  for (const t of [500, 900, 1700]) {
    await h.seek(t)
    const rb = await fx(h)
    // (Not "lazy": that chunk loads with the page, before the clock starts, where
    // the order of real-time arrivals isn't held; about 1 run in 30 it differs.)
    for (const k of ["late", "random"]) expect(upTo(rb, k, t), `${k} at ${t}`).toEqual(upTo(live, k, t))
  }
})

test("a field saved to localStorage keeps its text while a checkpoint builds and through Play (F35)", async ({ page }) => {
  const h = await open(page)
  await expect.poll(() => hydrated(h), { timeout: 15_000 }).toBe(true)
  await page.evaluate(() => (window.__retakeDock.state.cpMinMs = 0)) // every app is "heavy": a checkpoint after each rebuild
  await h.click("#draft")
  await page.keyboard.type("hello retake", { delay: 40 })
  await page.waitForTimeout(400)
  await h.pause()
  const end = (await h.state()).end
  await h.seek(end - 200)
  // A checkpoint is built behind (it boots on this origin's storage) while we look.
  await expect.poll(() => page.evaluate(() => document.querySelectorAll("#wb-stage iframe.checkpoint").length), { timeout: 8000 }).toBe(1)
  await page.waitForTimeout(800)
  // (Meanwhile the origin's storage is the checkpoint's: it's the frame that last ran app code.)
  await h.rt(() => __retake.play())
  await page.waitForTimeout(600)
  await h.pause()
  expect(await h.rt(() => [localStorage.getItem("draft"), document.querySelector("#draft").value])).toEqual(["hello retake", "hello retake"])
})

test("a rebuild gets the page as it was recorded, not rendered again (F56)", async ({ page }) => {
  const h = await open(page)
  await expect.poll(() => hydrated(h), { timeout: 15_000 }).toBe(true)
  const served = await h.rt(() => document.querySelector("#served").textContent)
  await page.waitForTimeout(800)
  await h.pause()
  let stored = 0
  page.on("response", (r) => r.headers()["x-retake-doc"] === "stored" && stored++)
  await h.seek(300)
  expect(stored).toBe(1)
  expect(await h.rt(() => document.querySelector("#served").textContent)).toBe(served)
  await expect.poll(() => hydrated(h)).toBe(true)
  // The cookie that asked for it was used once, and the app never sees it.
  expect(await h.rt(() => document.cookie)).not.toContain("__retake")
  expect(await h.rt(() => __retake.history().cookies || "")).not.toContain("__retake")
  expect(fs.readFileSync(path.join(fw.dir, ".retake", "front.log"), "utf8")).toContain('"stored":')
})

test("a pages-router route loads, takes clicks and rebuilds; a reload starts a new segment", async ({ page }) => {
  const h = await open(page, "/legacy")
  await expect.poll(() => hydrated(h), { timeout: 15_000 }).toBe(true)
  expect(await h.rt(() => document.querySelector("#legacy").textContent)).toBe("legacy server")
  await h.click("#inc")
  await page.waitForTimeout(150)
  await h.click("#inc")
  await page.waitForTimeout(300)
  const tBefore = (await h.state()).now
  await h.rt(() => location.reload())
  await expect.poll(async () => (await h.rt(() => (__retake.history().segments || []).length).catch(() => 0)), { timeout: 15_000 }).toBe(1)
  await expect.poll(() => hydrated(h), { timeout: 15_000 }).toBe(true)
  await h.pause()
  await h.seek(tBefore - 10)
  expect(await h.rt(() => document.querySelector("#inc").textContent)).toBe("count 2")
  await h.seek((await h.state()).end - 5)
  expect(await h.rt(() => document.querySelector("#inc").textContent)).toBe("count 0")
})

test("HMR: an edit shows while playing, and the dev socket stays live (not recorded) while paused", async ({ page }) => {
  const file = path.join(fw.dir, "app", "hmr-target.jsx")
  const original = fs.readFileSync(file, "utf8")
  try {
    const h = await open(page)
    await expect.poll(() => hydrated(h), { timeout: 15_000 }).toBe(true)
    fs.writeFileSync(file, original.replace("hmr v1", "hmr v2"))
    await expect.poll(() => h.rt(() => document.querySelector("#hmr").textContent), { timeout: 10_000 }).toBe("hmr v2")
    await h.pause()
    fs.writeFileSync(file, original)
    // Paused: the update arrives (the socket isn't held); it shows by Play at the latest.
    await page.waitForTimeout(1500)
    await h.rt(() => __retake.play())
    await expect.poll(() => h.rt(() => document.querySelector("#hmr").textContent), { timeout: 10_000 }).toBe("hmr v1")
    expect(await h.rt(() => (__retake.history().sockets || []).filter(Boolean).length)).toBe(0)
  } finally {
    fs.writeFileSync(file, original)
  }
})

test("HMR still applies in a frame rebuilt from the recorded page: its HMR socket gets an id of its own", async ({ page }) => {
  // The recorded page's request id is in its HMR socket's URL; Next keeps one
  // socket per id and drops the id when a socket closes. The frame swapped out
  // closing took the rebuilt frame's registration with it: no hot updates.
  const file = path.join(fw.dir, "app", "hmr-target.jsx")
  const original = fs.readFileSync(file, "utf8")
  try {
    const h = await open(page)
    await expect.poll(() => hydrated(h), { timeout: 15_000 }).toBe(true)
    await page.waitForTimeout(600)
    await h.pause()
    let stored = 0
    page.on("response", (r) => r.headers()["x-retake-doc"] === "stored" && stored++)
    await h.seek(200)
    expect(stored).toBe(1)
    await h.rt(() => __retake.play())
    await expect.poll(() => h.rt(() => __retake.isInteractive()), { timeout: 10_000 }).toBe(true)
    expect(await page.evaluate(() => document.querySelectorAll("#wb-stage iframe:not(.checkpoint)").length)).toBe(1)
    fs.writeFileSync(file, original.replace("hmr v1", "hmr v2"))
    await expect.poll(() => h.rt(() => document.querySelector("#hmr").textContent), { timeout: 10_000 }).toBe("hmr v2")
  } finally {
    fs.writeFileSync(file, original)
  }
})

test("rewinding to before a code edit: the build gets the page rendered with the new code, so it hydrates without a mismatch (F67)", async ({ page }) => {
  // The page kept before the edit has the old server-rendered text; the
  // client code is the new one: hydration always failed on that build.
  const file = path.join(fw.dir, "app", "hmr-target.jsx")
  const original = fs.readFileSync(file, "utf8")
  try {
    const h = await open(page)
    await expect.poll(() => hydrated(h), { timeout: 15_000 }).toBe(true)
    await page.waitForTimeout(600)
    fs.writeFileSync(file, original.replace("hmr v1", "hmr v2"))
    await expect.poll(() => h.rt(() => document.querySelector("#hmr").textContent), { timeout: 10_000 }).toBe("hmr v2")
    await page.waitForTimeout(300)
    await h.pause()
    let stored = 0
    page.on("response", (r) => r.headers()["x-retake-doc"] === "stored" && stored++)
    await h.seek(300)
    await expect.poll(() => hydrated(h)).toBe(true)
    expect(stored).toBe(0)
    expect(await h.rt(() => document.querySelector("#hmr").textContent)).toBe("hmr v2")
    expect(h.warnings.filter((w) => /hydrat/i.test(w))).toEqual([])
  } finally {
    fs.writeFileSync(file, original)
  }
})

// F76: a note on an element a server component rendered: React 19 dev's stack
// for it is a server frame (`about://React/Server/file:///…/.next/…/chunk.js`),
// which the dock fetched for its source map: "Fetch API cannot load
// about://React/Server/… URL scheme "about" is not supported" in the console
// for every such note (the landing page in `pnpm dev:site`).
test("a note on a server-rendered element: no fetch of React's server stack frames (F76)", async ({ page }) => {
  const h = await open(page)
  await expect.poll(() => hydrated(h), { timeout: 15_000 }).toBe(true)
  await h.pause()
  await page.locator('[data-tool="comment"]').click()
  const b = await h.box("#served")
  await page.mouse.move(b.x + b.w / 2 - 4, b.y + b.h / 2)
  await page.mouse.move(b.x + b.w / 2, b.y + b.h / 2)
  await page.mouse.click(b.x + b.w / 2, b.y + b.h / 2)
  const ta = page.locator("#wb-note textarea")
  await expect(ta).toBeVisible()
  await ta.fill("server text")
  await ta.press("Enter")
  await page.waitForTimeout(800)
  const note = await page.evaluate(() => window.__retakeDock.state.notes[0])
  expect(note.el.selector).toBe("#served")
  expect(JSON.stringify(note)).not.toContain("about://")
  expect(h.warnings.filter((w) => /about:\/\/|Fetch API/.test(w))).toEqual([])
})

// F77: a server component edit makes Next's router refetch the page's RSC
// payload (`next-hmr-refresh: 1`). That request was recorded like the app's own,
// so after a rewind (the frame on show has a future) the next edit's refetch
// was answered from the recording, with the payload of the edit before: the
// page kept showing old code, also after Play to the live end.
test("a server component edit made while paused in the past shows by Play: HMR refetches are never recorded or replayed (F77)", async ({ page }) => {
  const file = path.join(fw.dir, "app", "page.jsx")
  const original = fs.readFileSync(file, "utf8")
  const h1 = () => h.rt(() => document.querySelector("h1").textContent)
  let h
  try {
    h = await open(page)
    await expect.poll(() => hydrated(h), { timeout: 15_000 }).toBe(true)
    await page.waitForTimeout(400)
    fs.writeFileSync(file, original.replace("<h1>home</h1>", "<h1>home v2</h1>"))
    await expect.poll(h1, { timeout: 10_000 }).toBe("home v2")
    await page.waitForTimeout(600)
    await h.pause()
    expect(await h.rt(() => __retake.history().fetches.some((f) => f && /rsc=1/.test(f.key)))).toBe(false)
    await h.seek((await h.state()).now - 300)
    fs.writeFileSync(file, original)
    await page.waitForTimeout(1500)
    await h.rt(() => __retake.play())
    await expect.poll(h1, { timeout: 10_000 }).toBe("home")
    expect(h.warnings.filter((w) => /hydrat/i.test(w))).toEqual([])
  } finally {
    fs.writeFileSync(file, original)
  }
})
