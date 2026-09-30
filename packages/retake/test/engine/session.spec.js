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
  const r = await h.rt(() => __wayback.history())
  expect(r.frames.length).toBeGreaterThan(10)
})

test("rewinding a 10-second session is fast", async ({ page }) => {
  const h = await openDock(page, URL_)
  await h.record(); await page.waitForTimeout(3000); await h.pause()
  const t0 = Date.now()
  await h.seek(100)
  expect(Date.now() - t0).toBeLessThan(5000)
})

test("F7 input while paused in the past is not silently lost", async ({ page }) => {
  test.fail()
  const h = await openDock(page, URL_)
  await h.record(); await page.waitForTimeout(600); await h.pause()
  await h.click("#go") // app reacts, but nothing records it
  await page.waitForTimeout(300)
  await h.record(); await page.waitForTimeout(1000); await h.pause()
  const liveClicks = pick(await h.log(), "click-random")
  const T = (await h.state()).now
  await h.seek(T - 1)
  // Contract: either the click is blocked (live saw nothing) or it replays.
  expect(pick(await h.log(), "click-random")).toEqual(liveClicks)
})

test("F14 rewinding while a fetch is in flight doesn't hang that request later", async ({ page }) => {
  test.fail()
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
  test.fail()
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
  expect(await page.evaluate(() => window.__marker)).toBe(1)
  const s = await h.state()
  expect(s.started).toBe(true)
})

test("F16 a same-origin iframe inside the app gets its own page, not the dock", async ({ page }) => {
  test.fail()
  const h = await openDock(page, URL_)
  const res = await h.rt(async () => {
    const f = document.createElement("iframe")
    f.src = "/embed.html"
    document.body.appendChild(f)
    await new Promise((r) => (f.onload = r))
    await new Promise((r) => setTimeout(r, 300))
    return { dock: !!f.contentDocument.querySelector("#wb-dock"), body: !!f.contentDocument.querySelector("#emb-body") }
  })
  expect(res).toEqual({ dock: false, body: true })
})

test("?retake=0 serves the plain app", async ({ request }) => {
  for (const q of ["?retake=0", "?wayback=0"]) {
    const html = await (await request.get(URL_ + q)).text()
    expect(html).not.toContain("wb-dock")
    expect(html).not.toContain("data-wayback")
    expect(html).toContain('src="/main.js')
  }
})
