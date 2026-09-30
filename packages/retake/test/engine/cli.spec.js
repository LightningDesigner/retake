// CLI: argument parsing, messages, init output. No browser needed.
import { execFileSync, spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { test, expect } from "@playwright/test"
import { parseArgs, workDir, resolveVite } from "../../bin/retake.js"
import { BIN, FIXTURES } from "./servers.js"

const run = (...args) => spawnSync(process.execPath, [BIN, ...args], { encoding: "utf8", timeout: 20_000 })
const pkg = JSON.parse(fs.readFileSync(new URL("../../package.json", import.meta.url), "utf8"))

test("a bare path means dev", () => {
  expect(parseArgs(["."])).toMatchObject({ cmd: "dev", project: "." })
  expect(parseArgs(["dev", "app", "--port", "4000"])).toMatchObject({ cmd: "dev", project: "app", port: 4000 })
  expect(parseArgs(["./x", "--code-branches", "--", "--host"])).toMatchObject({ cmd: "dev", codeBranches: true, passthrough: ["--host"] })
})

test("bad arguments give a clear message and exit 1", () => {
  for (const args of [["dev", ".", "--port"], ["dev", ".", "--port", "abc"], ["--host", "."], ["a", "b"]]) {
    const r = run(...args)
    expect(r.status, args.join(" ")).toBe(1)
    expect(r.stderr).toMatch(/^retake: /)
    expect(r.stderr).not.toMatch(/at \w+ \(/) // no stack traces
  }
  const r = run("dev", "/definitely/not/here")
  expect(r.status).toBe(1)
  expect(r.stderr).toContain("doesn't exist")
})

test("--version and --help", () => {
  expect(run("--version").stdout.trim()).toBe(pkg.version)
  expect(run("-v").stdout.trim()).toBe(pkg.version)
  const h = run("--help")
  expect(h.status).toBe(0)
  expect(h.stdout).toContain("retake <project>")
})

test("init prints a package import, not a local path (F26)", () => {
  const out = run("init").stdout
  expect(out).toContain('import { retake } from "retake-dev"')
  expect(out).not.toContain(os.homedir())
})

test("the cache dir is keyed by the full path, not the folder name (F21)", () => {
  expect(workDir("/a/web")).not.toBe(workDir("/b/web"))
  expect(workDir("/a/web")).not.toContain(path.resolve(BIN, "../.."))
})

test("vite is resolved from a hoisted workspace root (F20)", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "retake-mono-"))
  const app = path.join(root, "packages", "app")
  fs.mkdirSync(app, { recursive: true })
  fs.writeFileSync(path.join(app, "package.json"), "{}")
  const vite = path.join(root, "node_modules", "vite")
  fs.mkdirSync(path.join(vite, "bin"), { recursive: true })
  fs.writeFileSync(path.join(vite, "package.json"), JSON.stringify({ name: "vite", version: "5.9.9", bin: { vite: "bin/vite.js" } }))
  fs.writeFileSync(path.join(vite, "bin", "vite.js"), "")
  const r = resolveVite(app)
  expect(r.version).toBe("5.9.9")
  expect(r.own).toBe(false)
})
