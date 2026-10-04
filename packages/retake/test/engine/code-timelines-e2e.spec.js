// Code timelines end to end, the product question as a test: "I create
// Timeline 2, leave a note on an animation there and give it to the agent. The
// change lands in Timeline 2; Timeline 1 keeps its recording and still shows
// the old animation." On a group of staggered bars (test/fixtures/bars, and
// the Next fixture's /bars), in each way of serving Retake:
//   Vite (retake <copy>, 3121), Next 16 behind the front server (3122, its dev
//   server on 3123), Next 16's proxy.ts (next dev on 3124), Next 15.5's
//   middleware.ts (next dev on 3125).
// Every project is a copy in the OS temp dir (a checkout rewrites files). The
// Next ones skip when their dependencies can't be installed (offline).
import { spawn, execFileSync, execSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { test, expect } from "@playwright/test"
import { fixtureDir, installRetake, startFramework, startNext } from "./frameworks.js"
import { openDock } from "./helpers.js"
import { BIN, FIXTURES } from "./servers.js"

test.describe.configure({ mode: "serial" })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const dockState = (page, fn, arg) => page.evaluate(`(${fn})(window.__retakeDock.state, ${JSON.stringify(arg ?? null)})`)
// The grow animation's duration on the third bar, in the frame on show.
const duration = (h) => h.rt(() => {
  const a = document.querySelector(".bar:nth-child(3)")?.getAnimations().find((x) => x.animationName === "grow")
  return a ? a.effect.getTiming().duration : null
})

function mcp(dir) {
  const child = spawn(process.execPath, [BIN, "mcp"], { cwd: dir, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, RETAKE_URL: "" } })
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
  const tool = (name, args = {}) =>
    new Promise((resolve) => {
      const id = ++seq
      waiting.set(id, (r) => resolve({ isError: !!r.result.isError, text: r.result.content[0].text }))
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }) + "\n")
    })
  return { tool, close: () => child.kill() }
}

// Every file of the project as it is now (path → content), versions folder aside.
function filesOf(dir) {
  const out = new Map()
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (["node_modules", ".next", ".retake", ".git"].includes(e.name)) continue
      const f = path.join(d, e.name)
      if (e.isDirectory()) walk(f)
      else out.set(path.relative(dir, f), fs.readFileSync(f, "utf8"))
    }
  }
  walk(dir)
  return out
}

/**
 * The whole story on one running app. `css`: bars.css in the project. `stop`:
 * stops the server (as Ctrl-C would). Returns versions A (before) and B (the edit).
 */
async function story(page, { url, dir, css }) {
  const cssFile = path.join(dir, css)
  const before = filesOf(dir)
  const h = await openDock(page, url)
  await expect.poll(() => h.rt(() => document.querySelectorAll(".bar").length), { timeout: 60_000 }).toBe(6)
  const token = await page.evaluate(() => window.__RETAKE_TOKEN)
  const call = (method, p, body) => page.evaluate(async ([method, p, body, token]) => (await fetch(`/__retake/${p}`, { method, headers: { "content-type": "application/json", "x-retake-token": token }, body: body ? JSON.stringify(body) : undefined })).json(), [method, p, body, token])
  // 1. Code timelines on; record on Timeline 1, replay the bars, pause.
  expect(await call("POST", "code/enabled", { on: true })).toMatchObject({ ok: true, enabled: true })
  await page.waitForTimeout(500)
  await h.click("#replay")
  const tNote = (await h.state()).now + 450 // mid-animation (600ms, staggered 80ms)
  await page.waitForTimeout(1500)
  await h.pause()
  await page.waitForTimeout(400)
  const A = (await call("GET", "code")).disk
  expect(A).toMatch(/^[0-9a-f]{10}$/)
  expect(await duration(h)).toBe(600)
  // 2. Timeline 2 from the middle (Control-click): it starts on Timeline 1's code.
  await dockState(page, (D, t) => window.__retakeDock.newTimelineAt(t), tNote)
  await expect.poll(() => dockState(page, (D) => D.activeId), { timeout: 20_000 }).toBe(2)
  await expect.poll(() => JSON.parse(fs.readFileSync(path.join(dir, ".retake", "code-timelines.json"), "utf8")).timelines["2"] || null).toMatchObject({ fork: A, head: A })
  await h.settle()
  // 3. A note on the third bar, at the moment it's growing.
  await dockState(page, (D, t) => {
    D.notes.push({ id: 7, branchId: 2, t, text: "slower, 1200ms, spring", el: { label: "div.bar", text: "", selector: ".bar:nth-child(3)", components: [], rect: { x: 0, y: 0, w: 18, h: 120 }, page: location.pathname, classes: ["bar"], source: null }, clip: null, status: "pending", replies: [], range: null, target: null, anims: null, inside: [], asked: null, group: null })
  }, tNote)
  await expect.poll(async () => (await call("GET", "notes")).some((n) => n.id === 7), { timeout: 10_000 }).toBe(true)
  // 4. The agent: get_note, the hard path (Timeline 1's code first), acknowledge, edit, resolve.
  const agent = mcp(dir)
  try {
    const note = await agent.tool("get_note", { id: 7 })
    expect(note.text).toContain(`Timeline: "Timeline 2" (branched from "Timeline 1"`)
    expect(note.text).toContain(`code version ${A}`)
    expect((await agent.tool("checkout_timeline", { timeline: 1 })).text).toContain("Files on disk are now Timeline 1's code")
    await expect.poll(() => dockState(page, (D) => D.activeId), { timeout: 20_000 }).toBe(1)
    await h.settle()
    const ack = await agent.tool("acknowledge", { id: 7 })
    expect(ack.isError).toBe(false)
    expect(ack.text).toContain("Files on disk are now Timeline 2's code")
    await expect.poll(() => dockState(page, (D) => D.activeId), { timeout: 20_000 }).toBe(2)
    fs.writeFileSync(cssFile, fs.readFileSync(cssFile, "utf8").replace("grow 600ms ease-out", "grow 1200ms cubic-bezier(.3, 1.4, .5, 1)"))
    await expect.poll(async () => (await call("GET", "code")).timelines["2"].head, { timeout: 10_000 }).not.toBe(A)
    expect((await agent.tool("resolve", { id: 7, summary: "1200ms with a springy curve" })).text).toMatch(/^Resolved note 7 \(code version [0-9a-f]{10}\)\.$/)
  } finally {
    agent.close()
  }
  const B = (await call("GET", "code")).timelines["2"].head
  // 5. Timeline 2 rebuilt on the new code: 1200ms; the files are Timeline 2's.
  await expect.poll(() => duration(h).catch(() => null), { timeout: 45_000 }).toBe(1200)
  expect(fs.readFileSync(cssFile, "utf8")).toContain("1200ms")
  expect(await call("GET", "code")).toMatchObject({ disk: B, checkedOut: 2 })
  expect((await call("GET", "notes/7")).resolvedVersion).toBe(B)
  // 6. Step into Timeline 1 (its lane): its code goes back on disk and its moment is the old animation.
  await h.settle()
  await page.locator('.lane-name[data-lane="1"]').click()
  await expect.poll(() => dockState(page, (D) => D.activeId), { timeout: 20_000 }).toBe(1)
  expect(fs.readFileSync(cssFile, "utf8")).toContain("grow 600ms ease-out")
  await expect.poll(() => duration(h).catch(() => null), { timeout: 45_000 }).toBe(600)
  expect((await h.state()).playing).toBe(false)
  // 7. And back: 1200ms again.
  await h.settle()
  await page.locator('.lane-name[data-lane="2"]').click()
  await expect.poll(() => dockState(page, (D) => D.activeId), { timeout: 20_000 }).toBe(2)
  await expect.poll(() => duration(h).catch(() => null), { timeout: 45_000 }).toBe(1200)
  // Leave it on Timeline 1's code, so stopping has to put the newest back.
  await h.settle()
  await page.locator('.lane-name[data-lane="1"]').click()
  await expect.poll(() => fs.readFileSync(cssFile, "utf8").includes("grow 600ms"), { timeout: 20_000 }).toBe(true)
  await page.close()
  return { A, B, before }
}

// 8. After stopping: the newest code (B) on disk, both versions kept whole, no file lost.
function checkAfterStop(dir, css, { A, B, before }) {
  expect(fs.readFileSync(path.join(dir, css), "utf8")).toContain("1200ms")
  for (const v of [A, B]) {
    const version = JSON.parse(fs.readFileSync(path.join(dir, ".retake", "versions", `${v}.json`), "utf8"))
    for (const h of Object.values(version.files)) expect(fs.existsSync(path.join(dir, ".retake", "blobs", h))).toBe(true)
  }
  const now = filesOf(dir)
  for (const f of before.keys()) expect(now.has(f), f).toBe(true)
  const changed = [...before.keys()].filter((f) => now.get(f) !== before.get(f))
  expect(changed).toEqual([css])
}

test("Vite: the agent's edit lands in Timeline 2; Timeline 1 still rebuilds on its own code; stopping leaves the newest", async ({ browser }) => {
  test.setTimeout(240_000)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "retake-e2e-bars-"))
  fs.cpSync(path.join(FIXTURES, "bars"), dir, { recursive: true })
  const port = 3121
  const listeners = () => execSync(`lsof -ti tcp:${port} -sTCP:LISTEN || true`).toString().trim().split("\n").filter(Boolean).map(Number)
  const start = async () => {
    let out = ""
    const child = spawn(process.execPath, [BIN, dir, "--port", String(port)], { stdio: "pipe" })
    child.stdout.on("data", (d) => (out += d))
    child.stderr.on("data", (d) => (out += d))
    for (let i = 0; i < 150; i++) {
      try {
        if ((await fetch(`http://localhost:${port}/__retake/code`)).ok) return { child, out: () => out }
      } catch {}
      await sleep(200)
    }
    throw new Error(`vite didn't start:\n${out}`)
  }
  const stop = async (child) => {
    child.kill("SIGINT")
    for (let i = 0; i < 80 && listeners().length; i++) await sleep(100)
    for (const pid of listeners()) process.kill(pid, "SIGKILL")
  }
  const { child, out } = await start()
  let r
  try {
    r = await story(await browser.newPage(), { url: `http://localhost:${port}/`, dir, css: "bars.css" })
  } finally {
    await stop(child)
  }
  checkAfterStop(dir, "bars.css", r)
  await expect.poll(() => out(), { timeout: 5000 }).toContain("left Timeline 2's code on disk (newest). Timeline 1 is kept in .retake/")
  // 9. From a terminal, no dev server: Timeline 1's code, then the newest back.
  const cli = (...a) => execFileSync(process.execPath, [BIN, "code", ...a], { cwd: dir }).toString()
  expect(cli("checkout", "1")).toContain("Files on disk are now Timeline 1's code")
  expect(fs.readFileSync(path.join(dir, "bars.css"), "utf8")).toContain("grow 600ms")
  expect(cli("restore")).toContain("(the newest)")
  expect(fs.readFileSync(path.join(dir, "bars.css"), "utf8")).toContain("1200ms")
})

test("Next 16 behind the front server: the same, with the pages Next rendered for each timeline's code", async ({ browser }) => {
  test.setTimeout(420_000)
  const dir = fixtureDir("next", "code")
  test.skip(!dir, "the Next fixture's dependencies couldn't be installed")
  fs.rmSync(path.join(dir, ".next"), { recursive: true, force: true })
  const app = await startFramework("next", 3122, { dir })
  let r
  try {
    // A first compile of the page before the dock opens it.
    await fetch(`${app.url}/bars`, { headers: { "x-retake-front": "1" } }).catch(() => {})
    r = await story(await browser.newPage(), { url: `${app.url}/bars`, dir, css: "app/bars/bars.css" })
  } finally {
    await app.stop()
  }
  checkAfterStop(dir, "app/bars/bars.css", r)
  await expect.poll(() => app.out(), { timeout: 5000 }).toContain("left Timeline 2's code on disk (newest)")
})

// next dev with Retake in its own middleware: the code host lives in Next's server.
async function proxyMode(browser, { dir, port, file, text }) {
  fs.writeFileSync(path.join(dir, file), text)
  installRetake(dir)
  fs.rmSync(path.join(dir, ".retake"), { recursive: true, force: true })
  fs.rmSync(path.join(dir, ".next"), { recursive: true, force: true })
  let next = await startNext(dir, port, "dev")
  let r
  try {
    await fetch(`${next.url}/bars`).catch(() => {})
    r = await story(await browser.newPage(), { url: `${next.url}/bars`, dir, css: "app/bars/bars.css" })
  } finally {
    await next.stop()
  }
  // Next's server process can be killed before its exit handlers run: then
  // the next start puts the newest code back.
  if (!fs.readFileSync(path.join(dir, "app/bars/bars.css"), "utf8").includes("1200ms")) {
    next = await startNext(dir, port, "dev")
    try {
      await fetch(`${next.url}/__retake/code`)
    } finally {
      await next.stop()
    }
  }
  fs.rmSync(path.join(dir, file), { force: true })
  checkAfterStop(dir, "app/bars/bars.css", { ...r, before: new Map([...r.before].filter(([f]) => f !== file)) })
}

test("Next 16 proxy.ts: the same, on the app's own dev server", async ({ browser }) => {
  test.setTimeout(420_000)
  const dir = fixtureDir("next", "code-proxy")
  test.skip(!dir, "the Next fixture's dependencies couldn't be installed")
  await proxyMode(browser, { dir, port: 3124, file: "proxy.ts", text: `export { default } from "retake-dev/next"\n` })
})

test("Next 15.5 middleware.ts (Node.js runtime): the same", async ({ browser }) => {
  test.setTimeout(420_000)
  const dir = fixtureDir("next15", "code")
  test.skip(!dir, "the Next 15 fixture's dependencies couldn't be installed")
  fs.cpSync(path.join(FIXTURES, "next", "app"), path.join(dir, "app"), { recursive: true, force: true })
  await proxyMode(browser, { dir, port: 3125, file: "middleware.ts", text: `import retake from "retake-dev/next"\nexport default retake\nexport const config = { runtime: "nodejs" }\n` })
})
