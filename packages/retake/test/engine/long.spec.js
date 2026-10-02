// F19: a 10-minute session with the mouse moving the whole time: how big is
// the recording, and how long does going back to its end take?
import { test, expect } from "@playwright/test"
import { openDock } from "./helpers.js"
import { PORTS } from "./servers.js"

test("a 10-minute pointer-heavy session is small and rewinds to its end in under a second", async ({ page }) => {
  test.setTimeout(180_000)
  const h = await openDock(page, `http://localhost:${PORTS.probe}/`)
  await page.waitForTimeout(500)
  await h.pause()
  const { json, bytes, end } = await h.rt(() => {
    const base = __retake.history()
    const MIN = 10
    const end = MIN * 60000
    const frames = []
    for (let t = 16.667; t < end; t += 16.667) frames.push(Math.round(t * 1000) / 1000)
    // The pad (#pad) is body's child; the mouse wanders over it every frame.
    const pad = document.getElementById("pad")
    const path = [[...document.documentElement.childNodes].indexOf(document.body), [...document.body.childNodes].indexOf(pad)]
    const events = frames.map((t, i) => ({ type: "pointermove", path, clientX: 20 + (i % 150), clientY: 40, t, mm: 1 }))
    const rec = { ...base, frames, events, end }
    const json = JSON.stringify(rec)
    if (document.documentElement.childNodes[path[0]].childNodes[path[1]] !== pad) throw new Error("bad path")
    return { json, bytes: json.length, end }
  })
  console.log(`10 min: ${(bytes / 1e6).toFixed(2)} MB`)
  expect(bytes).toBeLessThan(5e6) // was 12.5 MB before compact events (AUDIT F19)
  const cdp = process.env.PROFILE ? await page.context().newCDPSession(page) : null
  if (cdp) { await cdp.send("Profiler.enable"); await cdp.send("Profiler.start") }
  const t0 = Date.now()
  await h.rt(({ json, end }) => __retake.load(json, end - 1), { json, end })
  await page.waitForTimeout(50)
  const s = await h.settle()
  const ms = Date.now() - t0
  if (cdp) {
    const { profile } = await cdp.send("Profiler.stop")
    const self = new Map()
    const byId = new Map(profile.nodes.map((n) => [n.id, n]))
    const dt = profile.timeDeltas; const samples = profile.samples
    for (let i = 0; i < samples.length; i++) { const n = byId.get(samples[i]); const k = `${n.callFrame.functionName || "(anon)"} ${n.callFrame.url.split("/").pop().slice(0, 30)}:${n.callFrame.lineNumber}`; self.set(k, (self.get(k) || 0) + (dt[i] || 0)) }
    console.log([...self].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => `${(v / 1000).toFixed(0).padStart(6)}ms ${k}`).join("\n"))
  }
  console.log(`rewind to the end of 10 minutes: ${ms} ms`, JSON.stringify(await h.rt(() => { const d = __retake.debug(); return { seekMs: d.seekMs, settles: d.settles, yields: d.yields, stuck: d.stuck, boot: Math.round(performance.timeOrigin) } })))
  expect(s.now).toBeGreaterThan(end - 100)
  expect(ms).toBeLessThan(1000 + 400) // + the helper's polling and frame swap
})
