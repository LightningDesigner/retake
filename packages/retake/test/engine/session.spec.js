// Session-level behaviour: paused input, rewinds mid-request, reloads, iframes.
import fs from "node:fs"
import path from "node:path"
import { test, expect } from "@playwright/test"
import { openDock, pick } from "./helpers.js"
import { PORTS, FIXTURES } from "./servers.js"
const URL_ = `http://localhost:${PORTS.probe}/`

test("recording is on from page load", async ({ page }) => {
  const h = await openDock(page, URL_)
  await page.waitForTimeout(800)
  const r = await h.rt(() => __retake.history())
  expect(r.frames.length).toBeGreaterThan(10)
})

test("rewinding a 10-second session is fast", async ({ page }) => {
  const h = await openDock(page, URL_)
  await h.record(); await page.waitForTimeout(3000); await h.pause()
  const t0 = Date.now()
  await h.seek(100)
  expect(Date.now() - t0).toBeLessThan(5000)
})

test("F7 input while paused never goes unrecorded: the app doesn't get it", async ({ page }) => {
  const h = await openDock(page, URL_)
  await page.waitForTimeout(600)
  await h.pause()
  await h.click("#go") // blocked: paused is view-only
  await page.waitForTimeout(300)
  expect(pick(await h.log(), "click-random")).toEqual([])
  await h.record()
  await page.waitForTimeout(800)
  await h.pause()
  const T = (await h.state()).now
  await h.seek(T - 1)
  expect(pick(await h.log(), "click-random")).toEqual([])
})

test("F14 rewinding while a fetch is in flight doesn't hang that request later", async ({ page }) => {
  const h = await openDock(page, URL_)
  await h.record(); await page.waitForTimeout(300)
  await h.click("#go") // /api/stream takes ~1.5s
  await page.waitForTimeout(400)
  await h.pause()
  const T = (await h.state()).now
  await h.seek(T - 300)
  await page.waitForTimeout(2000)
  const s = await h.state()
  await h.seek(s.end) // walk back through the recorded click
  await h.record(); await page.waitForTimeout(3000); await h.pause()
  expect(pick(await h.log(), "stream-done").length).toBe(1)
})

test("F10 a full reload of the app keeps the session", async ({ page }) => {
  const h = await openDock(page, URL_)
  await h.record(); await page.waitForTimeout(1200); await h.pause()
  await page.evaluate(() => (window.__marker = 1))
  const f = path.join(FIXTURES, "probe", "main.js")
  const orig = fs.readFileSync(f, "utf8")
  try {
    fs.writeFileSync(f, orig + "\n// touched by session.spec\n")
    await page.waitForTimeout(2500)
  } finally {
    fs.writeFileSync(f, orig)
  }
  expect(await page.evaluate(() => window.__marker)).toBe(1) // the dock page itself didn't reload
  const s = await h.settle()
  expect(s.started).toBe(true)
  expect(s.end).toBeGreaterThan(1000) // the recording resumed rather than starting over
  expect((await h.rt(() => __retake.history())).reloads.length).toBeGreaterThanOrEqual(1)
})

test("F16 a same-origin iframe inside the app gets its own page, not the dock", async ({ page }) => {
  const h = await openDock(page, URL_)
  await h.rt(() => {
    const f = document.createElement("iframe")
    f.id = "nested-test"
    f.src = "/embed.html"
    document.body.appendChild(f)
  })
  let res = null
  for (let i = 0; i < 50; i++) {
    await page.waitForTimeout(100)
    res = await h.rt(() => {
      const d = document.getElementById("nested-test").contentDocument
      return d && d.readyState === "complete" ? { dock: !!d.querySelector("#wb-dock"), body: !!d.querySelector("#emb-body") } : null
    })
    if (res && (res.dock || res.body)) break
  }
  expect(res).toEqual({ dock: false, body: true })
})

test("?retake=0 serves the plain app", async ({ request }) => {
  for (const q of ["?retake=0"]) {
    const html = await (await request.get(URL_ + q)).text()
    expect(html).not.toContain("wb-dock")
    expect(html).not.toContain("data-retake")
    expect(html).toContain('src="/main.js')
  }
})

test("F10 a full reload while recording carries on recording", async ({ page }) => {
  const h = await openDock(page, URL_)
  await page.waitForTimeout(1200)
  const f = path.join(FIXTURES, "probe", "main.js")
  const orig = fs.readFileSync(f, "utf8")
  try {
    fs.writeFileSync(f, orig + "\n// touched by session.spec (recording)\n")
    await page.waitForTimeout(2500)
  } finally {
    fs.writeFileSync(f, orig)
  }
  await page.waitForTimeout(1500)
  const s = await h.settle()
  expect(s.recording).toBe(true)
  expect(s.end).toBeGreaterThan(3000)
})

test("a frame the dock removes after a rebuild doesn't leave a resume behind", async ({ page }) => {
  const h = await openDock(page, URL_)
  await page.waitForTimeout(800)
  await h.pause()
  await h.seek(300)
  await h.seek(600)
  expect(await page.evaluate(() => window.__retakeShell.__resume || null)).toBeNull()
})
