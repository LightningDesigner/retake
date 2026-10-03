// retake-dev/next: Retake from the app's own middleware, on the app's own dev
// server, with plain `next dev` (no Retake CLI). Next 16: a one-line proxy.ts;
// Next 15: middleware.ts with the Node.js runtime. retake-dev is copied into
// the fixture's node_modules (installRetake), as npm would put it there.
// `next build && next start` must show no dock and no runtime.
// Ports: Next 16 dev 3320, start 3321, behind the CLI 3324 (its dev server on
// 3325, before the debug-channel copy's dev on 3325); Next 15 dev 3322, start 3323. The fixtures are copied to the OS temp dir (frameworks.js);
// without their dependencies (offline, first run) these skip.
import { spawn } from "node:child_process"
import fs from "node:fs"
import http from "node:http"
import path from "node:path"
import { test, expect } from "@playwright/test"
import { buildNext, fixtureDir, installRetake, startFramework, startNext } from "./frameworks.js"
import { openDock } from "./helpers.js"
import { BIN, FIXTURES } from "./servers.js"

test.describe.configure({ mode: "serial" })

const PROXY = `export { default } from "retake-dev/next"\n`
// (Next 15.5's Turbopack runs a re-exported default on the Edge runtime: imported, it's Node.)
const MIDDLEWARE = `import retake from "retake-dev/next"\nexport default retake\nexport const config = { runtime: "nodejs" }\n`

const hydrated = (h) => h.rt(() => !!document.querySelector("#inc") && Object.keys(document.querySelector("#inc")).some((k) => k.startsWith("__reactFiber")))
const fx = (h) => h.rt(() => JSON.parse(JSON.stringify(window.__fx ? window.__fx.log : [])))
// What the app logged up to t (a rebuild rests just short of t).
const upTo = (log, k, t) => log.filter((e) => e.k === k && e.vt < t + 1000 - 20).map((e) => [e.vt, e.v])
const dockState = (page, fn, arg) => page.evaluate(`(${fn})(window.__retakeDock.state, ${JSON.stringify(arg ?? null)})`)
const NAV = { "sec-fetch-mode": "navigate", "sec-fetch-site": "none" }
// A page as the browser asks for it (Node's fetch sets Sec-Fetch-Mode itself).
const getText = (url, headers = {}) =>
  new Promise((resolve, reject) => {
    http.get(url, { headers }, (res) => {
      let body = ""
      res.setEncoding("utf8")
      res.on("data", (d) => (body += d))
      res.on("end", () => resolve(body))
    }).on("error", reject)
  })

async function open(page, url) {
  const warnings = []
  page.on("console", (m) => (m.type() === "error" || m.type() === "warning") && warnings.push(m.text()))
  const h = await openDock(page, url)
  h.warnings = warnings
  return h
}

// Record a few clicks and the headline typing, pause with the dock's button,
// scrub back with the mouse (a live preview), let go: one hidden build swaps
// in, "Building" never shows, and the rebuilt moment is what the app logged.
// Then Play back to the live end.
async function recordScrubRelease(page, h) {
  await expect.poll(() => hydrated(h), { timeout: 30_000 }).toBe(true)
  await page.waitForTimeout(400)
  await h.click("#inc")
  await page.waitForTimeout(250)
  await h.click("#inc")
  await page.waitForTimeout(700)
  const tTarget = (await h.state()).now - 300
  await h.click("#inc")
  await page.waitForTimeout(600)
  await page.click('#wb-dock [data-a="play"]')
  await page.waitForTimeout(300)
  const sp = await h.state()
  expect(sp.playing).toBe(false)
  expect(await h.rt(() => __retake.isInteractive())).toBe(false)
  const live = await fx(h)
  expect(live.filter((e) => e.k === "inc").map((e) => e.v)).toEqual([1, 2, 3])

  await page.evaluate(() => {
    const W = (window.__watch = { phases: [], added: 0, stop: false })
    new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => n.tagName === "IFRAME" && !n.classList.contains("checkpoint") && W.added++))).observe(document.querySelector("#wb-stage"), { childList: true })
    const loop = () => {
      const p = document.querySelector(".readout .phase").textContent
      if (W.phases[W.phases.length - 1] !== p) W.phases.push(p)
      if (!W.stop) requestAnimationFrame(loop)
    }
    requestAnimationFrame(loop)
  })
  const xOf = (t) =>
    page.evaluate((t) => {
      const D = window.__retakeDock.state
      const r = document.querySelector(".lines").getBoundingClientRect()
      return r.left + 12 + ((t - D.view.from) / (D.view.to - D.view.from)) * (r.width - 30)
    }, t)
  const g = await page.locator(".lines").boundingBox()
  const y = g.y + g.height - 6
  const x0 = await xOf(sp.now)
  const x1 = await xOf(tTarget)
  await page.keyboard.down("Alt") // (no snapping)
  await page.mouse.move(x0, y)
  await page.mouse.down()
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(x0 + ((x1 - x0) * i) / 12, y)
    await page.waitForTimeout(16)
  }
  await page.waitForTimeout(300)
  const dragT = await dockState(page, (D) => D.dragT)
  const pv = await h.state()
  expect(pv.previewing).toBe(true)
  expect(await h.rt(() => document.querySelector("#inc").textContent)).toBe("count 2")
  await page.evaluate(() => (window.__watch.phases = [document.querySelector(".readout .phase").textContent]))
  await page.keyboard.up("Alt")
  await page.mouse.up()
  await expect
    .poll(() => dockState(page, (D) => !D.building && document.querySelectorAll("#wb-stage iframe:not(.checkpoint)").length === 1 && !!D.PT && D.PT.state().booted && !D.PT.state().seeking), { timeout: 45_000 })
    .toBe(true)
  const w = await page.evaluate(() => ((window.__watch.stop = true), window.__watch))
  expect(w.added).toBe(1)
  expect(w.phases.filter((p) => /Building/.test(p))).toEqual([])
  await page.waitForTimeout(300)
  const rb = await h.state()
  expect(Math.abs(rb.now - dragT)).toBeLessThan(60)
  expect(await h.rt(() => document.querySelector("#inc").textContent)).toBe("count 2")
  expect(upTo(await fx(h), "headline", rb.now)).toEqual(upTo(live, "headline", rb.now))
  // Play: through the recording to the live end.
  await page.click('#wb-dock [data-a="play"]')
  await expect.poll(() => h.rt(() => __retake.isInteractive()).catch(() => false), { timeout: sp.end - rb.now + 20_000 }).toBe(true)
  expect(await h.rt(() => document.querySelector("#inc").textContent)).toBe("count 3")
  expect(h.errors).toEqual([])
}

// Leave a note on #served with the dock's comment tool.
async function addNote(page, h, text) {
  await h.pause()
  await page.locator('[data-tool="comment"]').click()
  const b = await h.box("#served")
  await page.mouse.move(b.x + b.w / 2 - 4, b.y + b.h / 2)
  await page.mouse.move(b.x + b.w / 2, b.y + b.h / 2)
  await page.mouse.click(b.x + b.w / 2, b.y + b.h / 2)
  const ta = page.locator("#wb-note textarea")
  await expect(ta).toBeVisible()
  await ta.fill(text)
  await ta.press("Enter")
}

// `retake mcp` started in the project folder (it finds .retake/server.json): list_notes.
async function mcpNotes(cwd) {
  const child = spawn(process.execPath, [BIN, "mcp"], { cwd, stdio: ["pipe", "pipe", "pipe"] })
  try {
    let buf = ""
    const waiting = new Map()
    child.stdout.setEncoding("utf8")
    child.stdout.on("data", (d) => {
      buf += d
      let i
      while ((i = buf.indexOf("\n")) >= 0) {
        const msg = JSON.parse(buf.slice(0, i))
        buf = buf.slice(i + 1)
        waiting.get(msg.id)?.(msg)
      }
    })
    let seq = 0
    const rpc = (method, params) =>
      new Promise((resolve) => {
        const id = ++seq
        waiting.set(id, resolve)
        child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n")
      })
    await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } })
    const r = await rpc("tools/call", { name: "list_notes", arguments: {} })
    return JSON.parse(r.result.content[0].text)
  } finally {
    child.kill()
  }
}

// The production build: no dock, no runtime, no session API.
async function checkProduction(page, url) {
  await page.goto(url + "/")
  await expect(page.locator("#inc")).toBeVisible()
  expect(await page.locator("#wb-dock").count()).toBe(0)
  expect(await page.evaluate(() => [!!window.__retake, !!window.__retakeShell, !!document.querySelector("script[data-retake]")])).toEqual([false, false, false])
  for (const dest of ["document", "iframe"]) {
    const html = await getText(url + "/", { ...NAV, "sec-fetch-dest": dest })
    expect(html, dest).toContain('id="inc"')
    expect(html, dest).not.toContain("data-retake")
    expect(html, dest).not.toContain("__retake")
  }
  expect((await fetch(url + "/__retake/session")).status).toBe(404)
}

test.describe("Next 16: proxy.ts", () => {
  let dir = null
  test.beforeAll(() => {
    test.setTimeout(300_000)
    dir = fixtureDir("next", "proxy")
    test.skip(!dir, "the Next fixture's dependencies couldn't be installed")
    fs.writeFileSync(path.join(dir, "proxy.ts"), PROXY)
    installRetake(dir)
    fs.rmSync(path.join(dir, ".retake"), { recursive: true, force: true })
  })

  test.describe("next dev", () => {
    let next = null
    test.beforeAll(async () => {
      test.setTimeout(180_000)
      next = await startNext(dir, 3320, "dev")
    })
    test.afterAll(async () => next && next.stop())

    test("the dock is on the app's own dev URL; the frame gets the runtime; assets and data pass through", async ({ page }) => {
      const h = await open(page, next.url + "/")
      expect(await page.locator("#wb-dock").count()).toBe(1)
      await expect.poll(() => hydrated(h), { timeout: 30_000 }).toBe(true)
      expect(await h.rt(() => location.href)).toBe(next.url + "/")
      expect(h.warnings.filter((w) => /hydrat/i.test(w))).toEqual([])
      // Set up for Next as the front server sets it up (frontRuntime("next")).
      const frame = await getText(next.url + "/", { ...NAV, "sec-fetch-dest": "iframe" })
      expect(frame.match(/<script data-retake>/g)).toHaveLength(1)
      expect(frame.indexOf("<script")).toBe(frame.indexOf("<script data-retake>"))
      expect(frame).toContain('"bootAt":"load"')
      expect(frame).toContain('"next":16')
      expect(frame).toContain("_next/webpack-hmr")
      // A page the app embeds (on /about) stays inert.
      const ha = await open(page, next.url + "/about")
      await expect.poll(() => ha.rt(() => !!document.querySelector("#emb")), { timeout: 30_000 }).toBe(true)
      const emb = await (await (await ha.liveFrame()).$("#emb")).contentFrame()
      await expect.poll(() => emb.evaluate(() => !!document.querySelector("#emb-body")), { timeout: 15_000 }).toBe(true)
      expect(await emb.evaluate(() => window.__retake && window.__retake.inert)).toBe(true)
      // Plain fetches (no navigation) are the app's: no dock, no runtime.
      const plain = await (await fetch(next.url + "/")).text()
      expect(plain).not.toContain("data-retake")
      expect(plain).not.toContain("wb-dock")
      expect((await getText(next.url + "/?retake=0", { ...NAV, "sec-fetch-dest": "document" }))).not.toContain("wb-dock")
      // .retake/: server.json for `retake mcp`, and it ignores itself.
      const info = JSON.parse(fs.readFileSync(path.join(dir, ".retake", "server.json"), "utf8"))
      expect(info.url).toBe(next.url)
      expect(fs.readFileSync(path.join(dir, ".retake", ".gitignore"), "utf8")).toBe("*\n")
    })

    test("record, pause, scrub, let go: one hidden build, no Building, the rebuilt moment matches; Play", async ({ page }) => {
      test.setTimeout(120_000)
      const h = await open(page, next.url + "/")
      await recordScrubRelease(page, h)
    })

    test("an HMR edit applies while playing", async ({ page }) => {
      const file = path.join(dir, "app", "hmr-target.jsx")
      const original = fs.readFileSync(file, "utf8")
      try {
        const h = await open(page, next.url + "/")
        await expect.poll(() => hydrated(h), { timeout: 30_000 }).toBe(true)
        fs.writeFileSync(file, original.replace("hmr v1", "hmr v2"))
        await expect.poll(() => h.rt(() => document.querySelector("#hmr").textContent), { timeout: 15_000 }).toBe("hmr v2")
        expect((await h.state()).playing).toBe(true)
        expect(await h.rt(() => (__retake.history().sockets || []).filter(Boolean).length)).toBe(0)
      } finally {
        fs.writeFileSync(file, original)
      }
    })

    test("a note and the timeline persist across a reload (.retake on disk); retake mcp lists the note", async ({ page }) => {
      const h = await open(page, next.url + "/")
      await expect.poll(() => hydrated(h), { timeout: 30_000 }).toBe(true)
      await page.waitForTimeout(500)
      await h.click("#inc")
      await page.waitForTimeout(300)
      await addNote(page, h, "make it blue")
      await expect.poll(() => JSON.parse(fs.readFileSync(path.join(dir, ".retake", "session.json"), "utf8")).notes.length, { timeout: 10_000 }).toBe(1)
      await expect.poll(() => fs.readdirSync(path.join(dir, ".retake", "recordings")).length, { timeout: 10_000 }).toBeGreaterThan(0)
      await page.reload()
      await expect.poll(() => dockState(page, (D) => D.notes.map((n) => n.text)), { timeout: 15_000 }).toEqual(["make it blue"])
      const notes = await mcpNotes(dir)
      expect(notes.notes.map((n) => n.text)).toEqual(["make it blue"])
    })

    test("a large recording upload goes through the middleware's 10 MB body limit (gzipped)", async ({ page }) => {
      const h = await open(page, next.url + "/")
      await expect.poll(() => hydrated(h), { timeout: 30_000 }).toBe(true)
      const ok = await page.evaluate(async () => {
        const big = JSON.stringify({ pad: "x".repeat(12_000_000) })
        const data = await new Response(new Blob([big]).stream().pipeThrough(new CompressionStream("gzip"))).blob()
        const r = await fetch("/__retake/recording/99", { method: "PUT", headers: { "x-retake-token": window.__RETAKE_TOKEN, "content-type": "application/json", "content-encoding": "gzip" }, body: data })
        const back = await fetch("/__retake/recording/99").then((r) => r.text())
        return [r.status, back.length === big.length]
      })
      expect(ok).toEqual([200, true])
    })
  })

  test("behind the Retake CLI as well, the frame gets the runtime once (the proxy stands aside)", async () => {
    test.setTimeout(180_000)
    const fw = await startFramework("next", 3324, { dir })
    try {
      const frame = await getText(fw.url + "/", { ...NAV, "sec-fetch-dest": "iframe" })
      expect(frame.match(/<script data-retake>/g)).toHaveLength(1)
      const dock = await getText(fw.url + "/", { ...NAV, "sec-fetch-dest": "document" })
      expect(dock).toContain("wb-dock")
    } finally {
      await fw.stop()
    }
  })

  test("next build && next start: no dock, no runtime", async ({ page }) => {
    test.setTimeout(400_000)
    buildNext(dir)
    const next = await startNext(dir, 3321, "start")
    try {
      await checkProduction(page, next.url)
    } finally {
      await next.stop()
    }
  })
})

test.describe("Next 16: proxy.ts, with Next's debug channel on (its default)", () => {
  let next = null
  test.beforeAll(async () => {
    test.setTimeout(300_000)
    const dir = fixtureDir("next", "proxy-debug") // its own copy: Next bakes the setting into its build cache
    test.skip(!dir, "the Next fixture's dependencies couldn't be installed")
    fs.writeFileSync(path.join(dir, "proxy.ts"), PROXY)
    installRetake(dir)
    fs.rmSync(path.join(dir, ".retake"), { recursive: true, force: true })
    next = await startNext(dir, 3325, "dev", { env: { FIXTURE_DEBUG_CHANNEL: "1" } })
  })
  test.afterAll(async () => next && next.stop())

  test("a server action and a soft navigation replay, rebuilt and played (F49)", async ({ page }) => {
    const h = await open(page, next.url + "/")
    await expect.poll(() => hydrated(h), { timeout: 30_000 }).toBe(true)
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
    expect((await h.rt(() => __retake.history().fetches.map((f) => (f.debug || []).length))).every((n) => n > 0)).toBe(true)
    const end = (await h.state()).end
    await h.seek(tAct)
    await expect.poll(() => hydrated(h), { timeout: 10_000 }).toBe(true)
    expect(await h.rt(() => [document.querySelector("#srv").textContent, document.querySelector("#inc").textContent])).toEqual(["server says 10", "count 1"])
    await h.seek(end - 5)
    expect(await h.rt(() => [location.pathname, !!document.querySelector("#about")])).toEqual(["/about", true])
    await h.seek(200)
    await h.rt(() => __retake.play())
    await expect.poll(() => h.rt(() => [location.pathname, !!document.querySelector("#about")]), { timeout: end + 5000 }).toEqual(["/about", true])
    expect(h.errors).toEqual([])
  })
})

test.describe("Next 15: middleware.ts (Node.js runtime)", () => {
  let dir = null
  test.beforeAll(() => {
    test.setTimeout(300_000)
    dir = fixtureDir("next15")
    test.skip(!dir, "the Next 15 fixture's dependencies couldn't be installed")
    fs.cpSync(path.join(FIXTURES, "next", "app"), path.join(dir, "app"), { recursive: true, force: true })
    fs.writeFileSync(path.join(dir, "middleware.ts"), MIDDLEWARE)
    installRetake(dir)
    fs.rmSync(path.join(dir, ".retake"), { recursive: true, force: true })
  })

  test.describe("next dev", () => {
    let next = null
    test.beforeAll(async () => {
      test.setTimeout(180_000)
      next = await startNext(dir, 3322, "dev")
    })
    test.afterAll(async () => next && next.stop())

    test("the dock is on the app's own dev URL; record, scrub, let go, the rebuilt moment matches; Play", async ({ page }) => {
      test.setTimeout(120_000)
      const h = await open(page, next.url + "/")
      expect(await page.locator("#wb-dock").count()).toBe(1)
      expect(await h.rt(() => location.href)).toBe(next.url + "/")
      const frame = await getText(next.url + "/", { ...NAV, "sec-fetch-dest": "iframe" })
      expect(frame).toContain('"next":15')
      await recordScrubRelease(page, h)
      expect(h.warnings.filter((w) => /hydrat/i.test(w))).toEqual([])
    })

    test("a note persists across a reload; retake mcp lists it", async ({ page }) => {
      const h = await open(page, next.url + "/")
      await expect.poll(() => hydrated(h), { timeout: 30_000 }).toBe(true)
      await page.waitForTimeout(400)
      await addNote(page, h, "next 15 note")
      await expect.poll(() => JSON.parse(fs.readFileSync(path.join(dir, ".retake", "session.json"), "utf8")).notes.length, { timeout: 10_000 }).toBe(1)
      await page.reload()
      await expect.poll(() => dockState(page, (D) => D.notes.map((n) => n.text)), { timeout: 15_000 }).toEqual(["next 15 note"])
      expect((await mcpNotes(dir)).notes.map((n) => n.text)).toEqual(["next 15 note"])
      expect(fs.readFileSync(path.join(dir, ".retake", ".gitignore"), "utf8")).toBe("*\n")
    })
  })

  test("next build && next start: no dock, no runtime", async ({ page }) => {
    test.setTimeout(400_000)
    buildNext(dir)
    const next = await startNext(dir, 3323, "start")
    try {
      await checkProduction(page, next.url)
    } finally {
      await next.stop()
    }
  })
})
