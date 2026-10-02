// F49: Next 16 sends React's debug data for each request over its HMR socket
// (experimental.reactDebugChannel, on by default), and React waits for it
// before showing a soft navigation or a server action's result. A replayed
// request never reaches the server, so replays stalled. The runtime keeps the
// debug data with each recorded request and hands it to Next's HMR client on
// replay (runtime/37-next.js). The Next fixture with FIXTURE_DEBUG_CHANNEL=1;
// Retake on 3342, Next on 3343, and `retake http://localhost:3343` on 3346.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { test, expect } from "@playwright/test"
import { fixtureDir, startFramework } from "./frameworks.js"
import { openDock } from "./helpers.js"

const PORT = 3342
let fw = null
test.beforeAll(async () => {
  test.setTimeout(180_000)
  const dir = fixtureDir("next", "debug") // its own copy: Next bakes the setting into its build cache
  test.skip(!dir, "the Next fixture's dependencies couldn't be installed")
  fw = await startFramework("next", PORT, { dir, env: { FIXTURE_DEBUG_CHANNEL: "1" } })
})
test.afterAll(async () => fw && fw.stop())
test.describe.configure({ mode: "serial" })

test("with Next 16's debug channel on, a server action and a soft navigation replay to the end (F49)", async ({ page }) => {
  const h = await openDock(page, fw.url + "/")
  const hydrated = () => h.rt(() => !!document.querySelector("#inc") && Object.keys(document.querySelector("#inc")).some((k) => k.startsWith("__reactFiber")))
  await expect.poll(hydrated, { timeout: 15_000 }).toBe(true)
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
  // The debug data came with the recording.
  const debug = await h.rt(() => __retake.history().fetches.map((f) => (f.debug || []).length))
  expect(debug.every((n) => n > 0)).toBe(true)
  const end = (await h.state()).end
  await h.seek(tAct)
  expect(await h.rt(() => document.querySelector("#srv").textContent)).toBe("server says 10")
  // That frame got the page as recorded (F56), so its own debug data came from the recording too.
  expect(await h.rt(() => (__retake.history().docDebug || []).length)).toBeGreaterThan(0)
  await h.seek(end - 5)
  expect(await h.rt(() => [location.pathname, !!document.querySelector("#about")])).toEqual(["/about", true])
  await h.seek(200)
  await h.rt(() => __retake.play())
  await expect.poll(() => h.rt(() => [location.pathname, !!document.querySelector("#about")]), { timeout: end + 5000 }).toEqual(["/about", true])
  await h.pause()
  expect(h.errors).toEqual([])
})

test("after a rewind (a frame built from the kept page) and Play, live server actions and soft navigations still finish (F71)", async ({ page }) => {
  // Such a frame's HMR socket has an id of its own (F58), but Next sends a live
  // request's debug data to the socket named by its x-nextjs-html-request-id:
  // the recorded page's id, whose socket closed with the frame swapped out.
  const h = await openDock(page, fw.url + "/")
  const hydrated = () => h.rt(() => !!document.querySelector("#inc") && Object.keys(document.querySelector("#inc")).some((k) => k.startsWith("__reactFiber")))
  await expect.poll(hydrated, { timeout: 15_000 }).toBe(true)
  await page.waitForTimeout(600)
  await h.pause()
  let stored = 0
  page.on("response", (r) => r.headers()["x-retake-doc"] === "stored" && stored++)
  await h.seek(200)
  expect(stored).toBe(1)
  await h.rt(() => __retake.play())
  await expect.poll(() => h.rt(() => __retake.isInteractive()), { timeout: 10_000 }).toBe(true)
  await expect.poll(hydrated, { timeout: 5000 }).toBe(true)
  await h.click("#inc")
  await h.click("#act")
  await expect.poll(() => h.rt(() => document.querySelector("#srv").textContent), { timeout: 8000 }).toBe("server says 10")
  await h.click("#to-about")
  await expect.poll(() => h.rt(() => [location.pathname, !!document.querySelector("#about")]), { timeout: 8000 }).toEqual(["/about", true])
})

test("fronting the running dev server by URL (no project to read Next's version from), the debug channel still replays (F49)", async ({ page }) => {
  test.setTimeout(90_000)
  // RT.next is "auto" there: the runtime asks Next's client which version it is.
  // (It was null, so a rebuilt page waited for its debug data for ever and never hydrated.)
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "retake-url-"))
  const front = await startFramework("next", 3346, { dir: fw.dir, upstream: "http://localhost:3343", root })
  try {
    const h = await openDock(page, front.url + "/")
    const hydrated = () => h.rt(() => !!document.querySelector("#inc") && Object.keys(document.querySelector("#inc")).some((k) => k.startsWith("__reactFiber")))
    await expect.poll(hydrated, { timeout: 15_000 }).toBe(true)
    await page.waitForTimeout(300)
    await h.click("#inc")
    await expect.poll(() => h.rt(() => document.querySelector("#inc").textContent)).toBe("count 1")
    await h.click("#act")
    await expect.poll(() => h.rt(() => document.querySelector("#srv").textContent)).toBe("server says 10")
    await page.waitForTimeout(300)
    const tAct = (await h.state()).now
    await page.waitForTimeout(300)
    await h.pause()
    await h.seek(tAct)
    await expect.poll(hydrated, { timeout: 5000 }).toBe(true)
    expect(await h.rt(() => [document.querySelector("#srv").textContent, document.querySelector("#inc").textContent])).toEqual(["server says 10", "count 1"])
    expect(h.errors).toEqual([])
  } finally {
    await front.stop()
    fs.rmSync(root, { recursive: true, force: true })
  }
})
