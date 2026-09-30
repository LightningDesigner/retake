// --code-branches against a throwaway copy in the OS temp dir (never this repo).
import { spawn } from "node:child_process"
import fs from "node:fs"
import { createRequire } from "node:module"
import { execSync } from "node:child_process"
const require_ = createRequire(import.meta.url)
import os from "node:os"
import path from "node:path"
import { test, expect } from "@playwright/test"
import { BIN } from "./servers.js"
import { createStore } from "../../src/code-versions.js"

const PORT = 3120

function makeApp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "retake-cb-"))
  fs.writeFileSync(path.join(dir, "package.json"), '{"name":"cb","private":true,"type":"module"}')
  fs.writeFileSync(path.join(dir, "index.html"), '<!doctype html><html><body><h1 id="v"></h1><script type="module" src="/main.js"></script></body></html>')
  fs.writeFileSync(path.join(dir, "main.js"), 'document.getElementById("v").textContent = "V1"\n')
  fs.writeFileSync(path.join(dir, "big.json"), JSON.stringify({ pad: "x".repeat(300_000) }))
  return dir
}

async function startServer(dir) {
  if (listeners().length) throw new Error(`port ${PORT} is still in use`)
  const child = spawn(process.execPath, [BIN, dir, "--port", String(PORT), "--code-branches"], { stdio: "pipe" })
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`http://localhost:${PORT}/`)).ok) return child
    } catch {}
    await new Promise((r) => setTimeout(r, 200))
  }
  child.kill()
  throw new Error("code-branches server didn't start")
}
const listeners = () => execSync(`lsof -ti tcp:${PORT} -sTCP:LISTEN || true`).toString().trim().split("\n").filter(Boolean).map(Number)
// Stop gracefully (SIGINT, as Ctrl-C would), and don't return until the port is free.
async function stop(child) {
  child.kill("SIGINT")
  for (let i = 0; i < 80 && listeners().length; i++) await new Promise((r) => setTimeout(r, 100))
  for (const pid of listeners()) process.kill(pid, "SIGKILL")
  await new Promise((r) => setTimeout(r, 200))
}

test("F1 F2 switching to older code then stopping the server puts the newest work back", async () => {
  const dir = makeApp()
  const child = await startServer(dir)
  const base = `http://localhost:${PORT}`
  const version = async () => (await (await fetch(`${base}/__wayback/version`)).json()).version
  try {
    const token = (await (await fetch(`${base}/`)).text()).match(/__WAYBACK_TOKEN = "([0-9a-f]+)"/)[1]
    const v1 = await version()
    await new Promise((r) => setTimeout(r, 800)) // let the file watcher finish its initial scan
    fs.writeFileSync(path.join(dir, "main.js"), 'document.getElementById("v").textContent = "V2"\nimport "./extra.js"\n')
    fs.writeFileSync(path.join(dir, "extra.js"), "// new on timeline 2\n")
    fs.writeFileSync(path.join(dir, "big.json"), JSON.stringify({ pad: "trimmed" }))
    let v2 = v1
    for (let i = 0; i < 50 && v2 === v1; i++) { await new Promise((r) => setTimeout(r, 100)); v2 = await version() }
    expect(v2).not.toBe(v1)
    const r = await fetch(`${base}/__wayback/checkout?v=${v1}`, { method: "POST", headers: { "x-wayback-token": token } })
    expect((await r.json()).ok).toBe(true)
    expect(fs.readFileSync(path.join(dir, "main.js"), "utf8")).toContain("V1")
    expect(fs.existsSync(path.join(dir, "extra.js"))).toBe(false)
  } finally {
    await stop(child)
  }
  expect(fs.readFileSync(path.join(dir, "main.js"), "utf8")).toContain("V2")
  expect(fs.existsSync(path.join(dir, "extra.js"))).toBe(true)
  expect(fs.readFileSync(path.join(dir, "big.json"), "utf8")).toContain("trimmed")
})

test("F1 after a crash on older code, the next start puts the newest work back", async () => {
  const dir = makeApp()
  let child = await startServer(dir)
  const base = `http://localhost:${PORT}`
  const version = async () => (await (await fetch(`${base}/__wayback/version`)).json()).version
  const token = (await (await fetch(`${base}/`)).text()).match(/__WAYBACK_TOKEN = "([0-9a-f]+)"/)[1]
  const v1 = await version()
  await new Promise((r) => setTimeout(r, 800))
  fs.writeFileSync(path.join(dir, "main.js"), "// V2 work\n")
  let v2 = v1
  for (let i = 0; i < 50 && v2 === v1; i++) { await new Promise((r) => setTimeout(r, 100)); v2 = await version() }
  await fetch(`${base}/__wayback/checkout?v=${v1}`, { method: "POST", headers: { "x-wayback-token": token } })
  // SIGKILL the whole tree: no exit handlers run.
  for (const pid of listeners()) process.kill(pid, "SIGKILL")
  child.kill("SIGKILL")
  for (let i = 0; i < 30 && listeners().length; i++) await new Promise((r) => setTimeout(r, 100))
  expect(fs.readFileSync(path.join(dir, "main.js"), "utf8")).toContain("V1")
  child = await startServer(dir)
  await stop(child)
  expect(fs.readFileSync(path.join(dir, "main.js"), "utf8")).toContain("V2 work")
})

test("F2 a file the target version skipped is never deleted", () => {
  const dir = makeApp()
  const store = createStore(dir)
  fs.writeFileSync(path.join(dir, "huge.bin"), Buffer.alloc(6 * 1024 * 1024, 1)) // over the per-file cap
  const v1 = store.snapshot()
  expect(store.load(v1).skipped).toContain("huge.bin")
  fs.writeFileSync(path.join(dir, "huge.bin"), "small now")
  fs.writeFileSync(path.join(dir, "main.js"), "// v2\n")
  store.snapshot()
  expect(store.checkout(v1).ok).toBe(true)
  expect(fs.readFileSync(path.join(dir, "main.js"), "utf8")).toContain("V1")
  expect(fs.readFileSync(path.join(dir, "huge.bin"), "utf8")).toBe("small now") // left alone
})

test("F3 checkout snapshots unsaved-to-us edits first, so switching back restores them", () => {
  const dir = makeApp()
  const store = createStore(dir)
  const v1 = store.snapshot()
  fs.writeFileSync(path.join(dir, "main.js"), "// edited a moment ago, never snapshotted\n")
  fs.writeFileSync(path.join(dir, "new.js"), "// brand new\n")
  const r = store.checkout(v1)
  expect(r.ok).toBe(true)
  expect(fs.existsSync(path.join(dir, "new.js"))).toBe(false)
  expect(store.checkout(r.from).ok).toBe(true)
  expect(fs.readFileSync(path.join(dir, "main.js"), "utf8")).toContain("edited a moment ago")
  expect(fs.readFileSync(path.join(dir, "new.js"), "utf8")).toContain("brand new")
})

test("F3 an interrupted checkout is rolled back on the next start", () => {
  const dir = makeApp()
  const store = createStore(dir)
  const v1 = store.snapshot()
  fs.writeFileSync(path.join(dir, "main.js"), "// v2 work\n")
  const v2 = store.snapshot()
  // Simulate a crash half-way into switching v2 -> v1: journal written, one file flipped.
  fs.writeFileSync(path.join(store.dir, "journal.json"), JSON.stringify({ from: v2, to: v1, at: Date.now() }))
  fs.writeFileSync(path.join(dir, "main.js"), 'document.getElementById("v").textContent = "V1"\n')
  const again = createStore(dir)
  expect(again.recover()).toEqual({ restored: v2 })
  expect(fs.readFileSync(path.join(dir, "main.js"), "utf8")).toContain("v2 work")
  expect(fs.existsSync(path.join(store.dir, "journal.json"))).toBe(false)
})

test("F3 refuses to switch when the current tree can't be snapshotted", () => {
  const dir = makeApp()
  const store = createStore(dir)
  const v1 = store.snapshot()
  fs.writeFileSync(path.join(dir, "main.js"), "// v2\n")
  const locked = path.join(dir, "locked.js")
  fs.writeFileSync(locked, "x")
  fs.chmodSync(locked, 0o000)
  try {
    const r = store.checkout(v1)
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/refusing/)
    expect(fs.readFileSync(path.join(dir, "main.js"), "utf8")).toBe("// v2\n")
  } finally {
    fs.chmodSync(locked, 0o644)
  }
})

test("F3 in a git repo, ignored files are never touched", () => {
  const dir = makeApp()
  const { execFileSync } = require_("node:child_process")
  execFileSync("git", ["init", "-q"], { cwd: dir })
  fs.writeFileSync(path.join(dir, ".gitignore"), "secret.txt\n")
  const store = createStore(dir)
  const v1 = store.snapshot()
  fs.writeFileSync(path.join(dir, "secret.txt"), "mine")
  fs.writeFileSync(path.join(dir, "main.js"), "// v2\n")
  store.snapshot()
  expect(store.checkout(v1).ok).toBe(true)
  expect(fs.readFileSync(path.join(dir, "secret.txt"), "utf8")).toBe("mine")
  expect(Object.keys(store.load(v1).files)).not.toContain(".retake/.gitignore")
})

test("F28 checkout needs POST + token (cross-site GETs are refused)", async () => {
  const dir = makeApp()
  const child = await startServer(dir)
  try {
    const bad = await fetch(`http://localhost:${PORT}/__wayback/checkout?v=0000000000`, { headers: { "sec-fetch-site": "cross-site" } })
    expect(bad.status).toBe(403)
    const noToken = await fetch(`http://localhost:${PORT}/__wayback/checkout?v=0000000000`, { method: "POST" })
    expect(noToken.status).toBe(403)
    const html = await (await fetch(`http://localhost:${PORT}/`)).text()
    const token = html.match(/__WAYBACK_TOKEN = "([0-9a-f]+)"/)[1]
    const ok = await fetch(`http://localhost:${PORT}/__wayback/checkout?v=0000000000`, { method: "POST", headers: { "x-wayback-token": token } })
    expect(ok.status).toBe(409) // authorised, but no such version
  } finally {
    await stop(child)
  }
})
