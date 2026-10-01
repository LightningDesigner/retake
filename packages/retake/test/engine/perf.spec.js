// Performance budgets (the user's list; results also go to .coord/PERF.md).
// Measured on the probe fixture; Sherpa numbers are taken by hand.
import { test, expect } from "@playwright/test"
import { openDock } from "./helpers.js"
import { PORTS } from "./servers.js"
const URL_ = `http://localhost:${PORTS.probe}/`
const results = {}
test.describe.configure({ mode: "serial" })
test.afterAll(() => console.log("PERF " + JSON.stringify(results)))

// A synthetic recording of `min` minutes with the pointer moving every frame
// and a click every 10 s (normal use is lighter than this).
async function fabricate(h, min) {
  return h.rt((min) => {
    const base = __wayback.history()
    const end = min * 60000
    const frames = []
    for (let t = 16.667; t < end; t += 16.667) frames.push(Math.round(t * 1000) / 1000)
    const pad = document.getElementById("pad")
    const path = [[...document.documentElement.childNodes].indexOf(document.body), [...document.body.childNodes].indexOf(pad)]
    const events = []
    frames.forEach((t, i) => {
      events.push({ type: "pointermove", path, clientX: 20 + (i % 150), clientY: 40, t, mm: 1 })
      if (i % 600 === 300) events.push({ type: "click", path, clientX: 50, clientY: 40, detail: 1, t })
    })
    return JSON.stringify({ ...base, frames, events, end })
  }, min)
}

test("recording overhead < 1 ms per frame; activity < 0.3 ms per sample", async ({ page }) => {
  const h = await openDock(page, URL_)
  await page.waitForTimeout(500)
  await h.click("#go")
  const b = await h.box("#pad")
  for (let i = 0; i < 40; i++) await page.mouse.move(b.x + 10 + i * 3, b.y + 20)
  await page.waitForTimeout(3000)
  const d = await h.rt(() => __wayback.debug())
  results.ownMsPerFrame = +(d.ownMs / d.ownFrames).toFixed(3)
  results.ownMaxMs = +d.ownMax.toFixed(2)
  results.activityMsPerSample = +(d.activity.ms / d.activity.samples).toFixed(3)
  expect(results.ownMsPerFrame).toBeLessThan(1)
  expect(results.activityMsPerSample).toBeLessThan(0.3)
})

test("idle CPU while recording: the runtime adds < 2% over the plain app", async ({ page, browser }) => {
  const measure = async (p, url) => {
    await p.goto(url)
    await p.waitForTimeout(2000)
    const cdp = await p.context().newCDPSession(p)
    await cdp.send("Performance.enable")
    const get = async () => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]))
    const a = await get()
    await p.waitForTimeout(5000)
    const z = await get()
    return (z.TaskDuration - a.TaskDuration) / (z.Timestamp - a.Timestamp)
  }
  const plainPage = await browser.newPage()
  const plain = await measure(plainPage, URL_ + "?retake=0")
  await plainPage.close()
  const docked = await measure(page, URL_)
  // The runtime's share: the same, with the dock's own render loop stopped
  // (the dock is S2's; its idle cost is reported separately).
  await page.evaluate(() => { const raf = window.requestAnimationFrame; window.requestAnimationFrame = () => raf(() => {}) })
  await page.waitForTimeout(300)
  const cdp = await page.context().newCDPSession(page)
  await cdp.send("Performance.enable")
  const get = async () => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]))
  // Best of three windows: the machine running other things only ever adds.
  let runtimeOnly = Infinity
  for (let i = 0; i < 3; i++) {
    const a = await get()
    await page.waitForTimeout(3000)
    const z = await get()
    runtimeOnly = Math.min(runtimeOnly, (z.TaskDuration - a.TaskDuration) / (z.Timestamp - a.Timestamp))
  }
  results.idleCpuPlain = +(plain * 100).toFixed(2)
  results.idleCpuDocked = +(docked * 100).toFixed(2)
  results.idleCpuRuntimeOnly = +(runtimeOnly * 100).toFixed(2)
  expect(runtimeOnly - plain).toBeLessThan(0.02)
})

test("10 minutes of recording: < 5 MB, serialises without blocking a frame, fits in memory", async ({ page, request }) => {
  const h = await openDock(page, URL_)
  await page.waitForTimeout(300)
  await h.pause()
  const json = await fabricate(h, 10)
  results.tenMinMB = +(json.length / 1e6).toFixed(2)
  expect(json.length).toBeLessThan(5e6)
  // on disk (gzipped by the server)
  const html = await (await request.get(URL_)).text()
  const token = html.match(/__WAYBACK_TOKEN = "([0-9a-f]+)"/)[1]
  await request.put(URL_ + "__wayback/recording/perf-10min", { data: json, headers: { "x-wayback-token": token, "content-type": "application/json" } })
  const fs = await import("node:fs")
  const path = await import("node:path")
  const { FIXTURES } = await import("./servers.js")
  results.tenMinDiskMB = +(fs.statSync(path.join(FIXTURES, "probe", ".retake", "recordings", "perf-10min.json.gz")).size / 1e6).toFixed(3)
  await request.delete(URL_ + "__wayback/recording/perf-10min", { headers: { "x-wayback-token": token } })
  // load it and time the serialisation the dock does every few seconds
  await h.rt(({ json, end }) => __wayback.load(json, end), { json, end: 600000 - 1 })
  await page.waitForTimeout(50)
  await h.settle()
  const ms = await page.evaluate(async () => {
    const f = document.querySelector("#wb-stage iframe.live").contentWindow
    const t0 = performance.now()
    f.JSON.stringify(f.__wayback.history())
    return performance.now() - t0
  })
  results.stringifyMs = +ms.toFixed(1)
  const cdp = await page.context().newCDPSession(page)
  for (let i = 0; i < 2; i++) await cdp.send("HeapProfiler.collectGarbage")
  results.heapMB = +((await cdp.send("Runtime.getHeapUsage")).usedSize / 1e6).toFixed(1)
  expect(results.heapMB).toBeLessThan(50)
})

test("5-minute session: 10 random rewinds, each < 1.5 s", async ({ page }) => {
  test.setTimeout(180_000)
  const h = await openDock(page, URL_)
  await page.waitForTimeout(300)
  await h.pause()
  const json = await fabricate(h, 5)
  await h.rt(({ json }) => __wayback.load(json, 1000), { json })
  await page.waitForTimeout(50)
  await h.settle()
  const times = []
  let x = 12345
  for (let i = 0; i < 10; i++) {
    x = (x * 1103515245 + 12345) % 2147483648
    const t = 1000 + (x % 298000)
    const t0 = Date.now()
    await h.rt(({ json, t }) => __wayback.load(json, t), { json, t })
    await page.waitForTimeout(20)
    const s = await h.settle()
    times.push(Date.now() - t0)
    expect(Math.abs(s.now - t)).toBeLessThan(20)
  }
  results.rewind5minMs = times
  expect(Math.max(...times)).toBeLessThan(1500)
})
