// CLI: argument parsing, messages, init output, project detection and the
// front-server mode with a dev command. No browser needed.
import { execFileSync, spawnSync } from "node:child_process"
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { test, expect } from "@playwright/test"
import { parseArgs, workDir, resolveVite } from "../../bin/retake.js"
import { BIN, FIXTURES } from "./servers.js"
import { detectProject, withArgs, frontRuntime, devTraffic, nextDebugChannelWarning } from "../../src/server/detect.js"
import { localUrlIn, runDevCommand } from "../../src/server/child.js"

const run = (...args) => spawnSync(process.execPath, [BIN, ...args], { encoding: "utf8", timeout: 20_000 })
const pkg = JSON.parse(fs.readFileSync(new URL("../../package.json", import.meta.url), "utf8"))

test("a bare path means dev", () => {
  expect(parseArgs(["."])).toMatchObject({ cmd: "dev", project: "." })
  expect(parseArgs(["dev", "app", "--port", "4000"])).toMatchObject({ cmd: "dev", project: "app", port: 4000 })
  expect(parseArgs(["./x", "--code-branches", "--", "--host"])).toMatchObject({ cmd: "dev", codeTimelines: true, passthrough: ["--host"] })
  expect(parseArgs(["./x", "--code-timelines"])).toMatchObject({ codeTimelines: true })
  expect(parseArgs(["./x", "--no-code-timelines"])).toMatchObject({ codeTimelines: false })
  expect(parseArgs(["./x"]).codeTimelines).toBe(undefined)
  expect(parseArgs(["code", "checkout", "2"])).toMatchObject({ cmd: "code", codeArgs: ["checkout", "2"], project: null })
  expect(parseArgs(["code", "export", "Timeline 2", "--branch", "retake/t2"])).toMatchObject({ cmd: "code", codeArgs: ["export", "Timeline 2"], branch: "retake/t2" })
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

// Two runs on one project must not share a wrapper config: Vite watches its
// config, so a second run rewriting it restarted the first on the second's
// port (S4 on Sherpa: :3400 moved to :3500, :3777, then died on a busy 3014).
test("two runs on the same project each keep their own server", async () => {
  const { spawn } = await import("node:child_process")
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "retake-two-runs-"))
  fs.cpSync(path.join(FIXTURES, "probe"), project, { recursive: true, filter: (p) => !p.includes(".retake") && !p.includes("node_modules") })
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), "retake-two-runs-cache-"))
  const env = { ...process.env, RETAKE_CACHE_DIR: cache }
  const start = (port) => {
    const p = spawn(process.execPath, [BIN, project, "--port", String(port)], { env })
    p.out = ""
    p.stdout.on("data", (d) => (p.out += d))
    p.stderr.on("data", (d) => (p.out += d))
    return p
  }
  const up = async (port) => {
    for (let i = 0; i < 100; i++) {
      try {
        if ((await fetch(`http://localhost:${port}/`)).ok) return true
      } catch {}
      await new Promise((r) => setTimeout(r, 200))
    }
    return false
  }
  const a = start(3490)
  try {
    expect(await up(3490)).toBe(true)
    const b = start(3491)
    try {
      expect(await up(3491)).toBe(true)
      await new Promise((r) => setTimeout(r, 1500))
      expect(await up(3490)).toBe(true)
      expect(a.out).not.toMatch(/restarting server/)
      expect(a.exitCode).toBeNull()
    } finally {
      b.kill()
    }
  } finally {
    a.kill()
  }
})

// ---- frameworks: front-server mode (ports 3326-3329, 3334-3335, 3350-3354) ------------

const FAKE_DEV = path.join(FIXTURES, "fake-dev", "fake-dev.js")
const tmpProject = (pkg, files = {}) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "retake-detect-"))
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify(pkg))
  for (const [f, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, f), text)
  return dir
}
const health = (port) =>
  new Promise((resolve) => {
    const r = http.get({ host: "127.0.0.1", port, path: "/__retake/health" }, (res) => {
      res.resume()
      resolve(res.statusCode)
    })
    r.on("error", () => resolve(0))
  })
const waitFor = async (fn, ms = 20_000) => {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await fn()) return true
    await new Promise((r) => setTimeout(r, 150))
  }
  return false
}
const portFree = (port) =>
  new Promise((resolve) => {
    const s = http.createServer()
    s.once("error", () => resolve(false))
    s.listen(port, "127.0.0.1", () => s.close(() => resolve(true)))
  })

test("parseArgs: a URL, a dev command after --, --root and --verbose", () => {
  expect(parseArgs(["http://localhost:3000"])).toMatchObject({ cmd: "dev", upstream: "http://localhost:3000/", project: null })
  expect(parseArgs(["https://127.0.0.1:5173", "--port", "4000", "--root", "/tmp/x"])).toMatchObject({ upstream: "https://127.0.0.1:5173/", port: 4000, root: "/tmp/x" })
  expect(parseArgs(["--", "next", "dev", "--turbopack"])).toMatchObject({ cmd: "dev", command: ["next", "dev", "--turbopack"], passthrough: [] })
  expect(parseArgs(["--verbose", "--", "pnpm", "dev"])).toMatchObject({ cmd: "dev", verbose: true, command: ["pnpm", "dev"] })
  // with a project, the words after -- go to its dev server
  expect(parseArgs([".", "--", "--host"])).toMatchObject({ cmd: "dev", project: ".", command: null, passthrough: ["--host"] })
  expect(parseArgs(["app", "--", "next"])).toMatchObject({ project: "app", command: null, passthrough: ["next"] })
  expect(parseArgs(["--root=out", "."])).toMatchObject({ root: "out", project: "." })
  expect(() => parseArgs(["--root"])).toThrow(/--root needs/)
})

test("detectProject: frameworks get the front server and their own dev command", () => {
  const next = tmpProject({ dependencies: { next: "16.0.0" }, scripts: { dev: "next dev", start: "next start" } }, { "pnpm-lock.yaml": "" })
  expect(detectProject(next)).toEqual({ mode: "front", framework: "next", command: "pnpm run dev", pm: "pnpm" })
  // no dev script: a start script that runs a dev server, never `next start`
  expect(detectProject(tmpProject({ dependencies: { nuxt: "4" }, scripts: { start: "nuxt dev" } }, { "yarn.lock": "" }))).toMatchObject({ framework: "nuxt", command: "yarn run start" })
  expect(detectProject(tmpProject({ dependencies: { next: "15" }, scripts: { start: "next start" } }))).toMatchObject({ command: "npx --no-install next dev", pm: "npm" })
  expect(detectProject(tmpProject({ devDependencies: { "@react-router/dev": "7", vite: "7" } }, { "vite.config.js": "" }))).toMatchObject({ mode: "front", framework: "react-router", command: "npx --no-install react-router dev" })
  expect(detectProject(tmpProject({ devDependencies: { "@sveltejs/kit": "2" }, scripts: { dev: "vite dev" }, packageManager: "bun@1.2.0" }))).toMatchObject({ framework: "sveltekit", command: "bun run dev" })
  expect(detectProject(tmpProject({ dependencies: { astro: "5" }, scripts: { dev: "astro dev" } }))).toMatchObject({ framework: "astro", command: "npm run dev" })
  // a Vite SPA keeps today's path
  expect(detectProject(tmpProject({ devDependencies: { vite: "8" } }, { "index.html": "<!doctype html>" }))).toMatchObject({ mode: "vite" })
  expect(detectProject(tmpProject({ devDependencies: { vite: "8" } }, { "vite.config.ts": "" }))).toMatchObject({ mode: "vite" })
  // neither
  expect(detectProject(tmpProject({ dependencies: { express: "5" } }))).toMatchObject({ mode: null })
  // extra arguments
  expect(withArgs("npm run dev", ["--turbopack"], "npm")).toBe("npm run dev -- --turbopack")
  expect(withArgs("pnpm run dev", ["--port", "1 2"], "pnpm")).toBe("pnpm run dev --port '1 2'")
})

test("a folder with no framework and no Vite app: a clear error naming both ways in", () => {
  const r = run(tmpProject({ dependencies: { express: "5" } }))
  expect(r.status).toBe(1)
  expect(r.stderr).toContain("retake -- <your dev command>")
  expect(r.stderr).toContain("retake http://localhost:<port>")
})

test("the dev server's printed URL is found through colour codes", () => {
  expect(localUrlIn("  \x1b[32m➜\x1b[39m  \x1b[1mLocal\x1b[22m:   \x1b[36mhttp://localhost:\x1b[1m5173\x1b[22m/\x1b[39m")).toBe("http://localhost:5173/")
  expect(localUrlIn("   - Local:        http://0.0.0.0:3015")).toBe("http://localhost:3015")
  expect(localUrlIn("ready on http://[::1]:4000, ok")).toBe("http://[::1]:4000")
  expect(localUrlIn("Network: http://192.168.1.4:3000")).toBe(null)
})

test("the dev command runs in the foreground: Astro is told not to background itself (it left its server running after Ctrl-C)", async () => {
  let out = ""
  const dev = await runDevCommand(`node -e "console.log('bg=' + process.env.ASTRO_DEV_BACKGROUND)"`, { env: { ...process.env, ASTRO_DEV_BACKGROUND: undefined, PORT: "3328" }, onOutput: (c) => (out += c) })
  await dev.exited
  expect(out).toContain("bg=1")
})

test("retake -- <command>: a dev server that ignores PORT is found by its output; Ctrl-C stops its whole group", async () => {
  const { spawn } = await import("node:child_process")
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "retake-cmd-"))
  const p = spawn(process.execPath, [BIN, "--port", "3326", "--root", root, "--", "node", FAKE_DEV, "3327"], { stdio: ["ignore", "pipe", "pipe"] })
  let out = ""
  p.stdout.on("data", (d) => (out += d))
  p.stderr.on("data", (d) => (out += d))
  try {
    expect(await waitFor(async () => (await health(3326)) === 200), out).toBe(true)
    await expect.poll(() => out).toContain("timeline docked at http://localhost:3326")
    expect(out).toContain("on :3327")
    expect(JSON.parse(fs.readFileSync(path.join(root, ".retake", "server.json"), "utf8")).url).toBe("http://localhost:3326")
  } finally {
    p.kill("SIGINT")
  }
  expect(await waitFor(async () => (await portFree(3327)) && (await portFree(3326)), 2000)).toBe(true)
})

test("retake <project>: a framework's dev script runs through its package manager, and stops with it", async () => {
  const { spawn } = await import("node:child_process")
  // npm run dev → sh → node: three processes, one group.
  const project = tmpProject({ dependencies: { next: "15" }, scripts: { dev: `node ${JSON.stringify(FAKE_DEV)} 3329` } })
  const p = spawn(process.execPath, [BIN, project, "--port", "3328"], { stdio: ["ignore", "pipe", "pipe"] })
  let out = ""
  p.stdout.on("data", (d) => (out += d))
  p.stderr.on("data", (d) => (out += d))
  try {
    expect(await waitFor(async () => (await health(3328)) === 200), out).toBe(true)
    expect(fs.existsSync(path.join(project, ".retake", "server.json"))).toBe(true) // .retake/ in the project by default
  } finally {
    p.kill("SIGINT")
  }
  expect(await waitFor(async () => (await portFree(3329)) && (await portFree(3328)), 2000)).toBe(true)
  await new Promise((r) => (p.exitCode != null ? r() : p.once("exit", r)))
})

test("PORT set in the shell with another app on it: the dev command gets a free PORT, and the URL it prints wins (F69)", async () => {
  const other = http.createServer((req, res) => res.end("OTHER APP")).listen(3350, "127.0.0.1")
  await new Promise((r) => other.once("listening", r))
  let dev = null
  try {
    let out = ""
    dev = await runDevCommand(`node ${JSON.stringify(FAKE_DEV)} 3351`, { env: { ...process.env, PORT: "3350" }, onOutput: (c) => (out += c) })
    expect(dev.port).not.toBe(3350)
    expect(dev.portTaken).toBe(3350)
    expect(await dev.url, out).toBe("http://localhost:3351")
  } finally {
    if (dev) {
      dev.stop()
      await dev.exited
    }
    other.close()
  }
  // A free PORT is still the dev server's.
  const free = await runDevCommand(`node -e "console.log('port=' + process.env.PORT)"`, { env: { ...process.env, PORT: "3352" }, onOutput: () => {} })
  expect([free.port, free.portTaken]).toEqual([3352, null])
  await free.exited
})

test("Ctrl-C: a dev server still stopping after its wrapper exited gets SIGKILL, not left running (F70)", async () => {
  const { spawn } = await import("node:child_process")
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "retake-stubborn-"))
  const p = spawn(process.execPath, [BIN, "--port", "3353", "--root", root, "--", "node", path.join(FIXTURES, "fake-dev", "stubborn-dev.js"), "3354"], { stdio: ["ignore", "pipe", "pipe"] })
  let out = ""
  p.stdout.on("data", (d) => (out += d))
  p.stderr.on("data", (d) => (out += d))
  const exited = new Promise((r) => (p.exitCode != null ? r() : p.once("exit", r)))
  try {
    expect(await waitFor(async () => (await health(3353)) === 200), out).toBe(true)
    await expect.poll(() => out).toContain("on :3354")
  } finally {
    p.kill("SIGINT")
  }
  await exited
  // Retake waited for it (at most 5 s, then SIGKILL): nothing is left on its port.
  expect(await portFree(3354)).toBe(true)
  expect(await portFree(3353)).toBe(true)
})

test("a busy --port is a one-line error", async () => {
  const busy = http.createServer().listen(3334, "127.0.0.1")
  await new Promise((r) => busy.once("listening", r))
  try {
    const r = run("http://localhost:3335", "--port", "3334", "--root", fs.mkdtempSync(path.join(os.tmpdir(), "retake-busy-")))
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/^retake: port 3334 is in use/)
    expect(r.stderr).not.toMatch(/at \w+ \(/)
  } finally {
    busy.close()
  }
})

test("frontRuntime: clock at load, scripts held, the framework's dev URLs; Next's major version from the project", () => {
  expect(frontRuntime(null)).toEqual({ bootAt: "load", holdScripts: true, exemptUrls: devTraffic("vite") })
  const rt = frontRuntime("next", tmpProject({ dependencies: { next: "16" } }))
  expect(rt.next).toBe("auto") // not installed there: the runtime asks Next's client
  expect(frontRuntime("next", null).next).toBe("auto") // fronting a bare URL
  expect(rt.exemptUrls.some((u) => new RegExp(u).test("/_next/hmr?id=x"))).toBe(true)
  expect(rt.exemptUrls.some((u) => new RegExp(u).test("/_next/static/chunks/app.js"))).toBe(false)
  expect(devTraffic("astro")).toContain("^/__astro_dev_toolbar")
  // Next 16 is handled (no warning); another version with a debug channel gets one.
  const dir = tmpProject({ dependencies: { next: "16" } })
  fs.mkdirSync(path.join(dir, "node_modules", "next"), { recursive: true })
  fs.writeFileSync(path.join(dir, "node_modules", "next", "package.json"), JSON.stringify({ name: "next", version: "16.3.8" }))
  expect(nextDebugChannelWarning(dir)).toBe(null)
  expect(frontRuntime("next", dir).next).toBe(16)
  fs.writeFileSync(path.join(dir, "node_modules", "next", "package.json"), JSON.stringify({ name: "next", version: "17.0.0" }))
  expect(nextDebugChannelWarning(dir)).toMatch(/reactDebugChannel: false/)
})
