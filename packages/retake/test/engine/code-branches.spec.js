// --code-branches against a throwaway copy in the OS temp dir (never this repo).
import { spawn } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { test, expect } from "@playwright/test"
import { openDock } from "./helpers.js"
import { BIN } from "./servers.js"

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
const stop = (child) => new Promise((r) => { child.once("exit", r); child.kill("SIGINT"); setTimeout(() => { child.kill("SIGKILL"); r() }, 5000) })

test("F1 F2 switching timelines then stopping the server keeps every version's files", async ({ page }) => {
  test.fail()
  const dir = makeApp()
  const child = await startServer(dir)
  try {
    const h = await openDock(page, `http://localhost:${PORT}/`)
    await h.record(); await page.waitForTimeout(1200); await h.pause(); await page.waitForTimeout(700)
    await h.rt(() => __wayback.forkHere())
    await page.waitForTimeout(600)
    fs.writeFileSync(path.join(dir, "main.js"), 'document.getElementById("v").textContent = "V2"\nimport "./extra.js"\n')
    fs.writeFileSync(path.join(dir, "extra.js"), "// new on timeline 2\n")
    fs.writeFileSync(path.join(dir, "big.json"), JSON.stringify({ pad: "trimmed" }))
    await page.waitForTimeout(2500)
    const branches = await page.evaluate(() => __waybackDock.branches())
    expect(branches.length).toBe(2)
    // Step into Timeline 1 (older code), then quit.
    const other = await page.$(".ribbon.other")
    const b = await other.boundingBox()
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2)
    await page.waitForTimeout(2500)
  } finally {
    await stop(child)
  }
  // After exit, the newest work must be on disk (or at least recoverable), and
  // nothing that existed in any version may be gone.
  expect(fs.readFileSync(path.join(dir, "main.js"), "utf8")).toContain("V2")
  expect(fs.existsSync(path.join(dir, "extra.js"))).toBe(true)
  expect(fs.existsSync(path.join(dir, "big.json"))).toBe(true)
})
