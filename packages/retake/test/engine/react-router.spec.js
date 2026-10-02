// React Router 7 (framework mode, server rendering, Vite) behind the front
// server: `retake <the fixture>` runs `react-router dev`. Retake on 3344, the
// dev server on 3345. A Form action, its revalidation and a navigation record
// and replay; the server renders the frame's own URL, so no hydration warning
// (F46: `?__wb=app` made it render `/?index&__wb=app` in the client).
import fs from "node:fs"
import path from "node:path"
import { test, expect } from "@playwright/test"
import { fixtureDir, startFramework } from "./frameworks.js"
import { openDock } from "./helpers.js"

const PORT = 3344
let fw = null
test.beforeAll(async () => {
  test.setTimeout(180_000)
  const dir = fixtureDir("react-router")
  test.skip(!dir, "the React Router fixture's dependencies couldn't be installed")
  fw = await startFramework("react-router", PORT, { dir, args: ["--verbose"] })
})
test.afterAll(async () => fw && fw.stop())

test("a Form action, revalidation and a navigation record and replay; no hydration warning, no __wb (F46)", async ({ page }) => {
  const warnings = []
  page.on("console", (m) => (m.type() === "error" || m.type() === "warning") && warnings.push(m.text()))
  const h = await openDock(page, fw.url + "/")
  const hydrated = () => h.rt(() => !!document.querySelector("#inc") && Object.keys(document.querySelector("#inc")).some((k) => k.startsWith("__reactFiber")))
  await expect.poll(hydrated, { timeout: 20_000 }).toBe(true)
  await page.waitForTimeout(300)
  await h.click("#inc")
  await expect.poll(() => h.rt(() => document.querySelector("#inc").textContent)).toBe("count 1")
  await h.click("#act")
  await expect.poll(() => h.rt(() => document.querySelector("#srv").textContent)).toBe("server got 1")
  await page.waitForTimeout(300)
  const tAct = (await h.state()).now
  await h.click("#to-about")
  await expect.poll(() => h.rt(() => document.querySelector("#about") && document.querySelector("#about").textContent), { timeout: 10_000 }).toBe("about loader")
  await page.waitForTimeout(300)
  await h.pause()
  const end = (await h.state()).end
  const keys = await h.rt(() => __retake.history().fetches.map((f) => f.key))
  expect(keys.join(" ")).not.toContain("__wb")
  expect(keys.some((k) => /^POST /.test(k))).toBe(true)
  await h.seek(tAct)
  expect(await h.rt(() => [location.pathname, document.querySelector("#srv").textContent, document.querySelector("#inc").textContent])).toEqual(["/", "server got 1", "count 1"])
  await h.seek(end - 5)
  expect(await h.rt(() => [location.pathname, document.querySelector("#about").textContent])).toEqual(["/about", "about loader"])
  await h.seek(200)
  await h.rt(() => __retake.play())
  await expect.poll(() => h.rt(() => location.pathname), { timeout: end + 5000 }).toBe("/about")
  await h.pause()
  expect(warnings.filter((w) => /hydrat|did not match/i.test(w))).toEqual([])
  expect(h.errors).toEqual([])
  expect(fs.readFileSync(path.join(fw.dir, ".retake", "front.log"), "utf8")).not.toContain("__wb")
})
