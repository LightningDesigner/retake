// Real frameworks behind the front server, for the specs that need them
// (next.spec.js, react-router.spec.js...). Each fixture is copied into the OS
// temp dir and its dependencies installed there once (keyed by its
// package.json), so the repo never holds a framework's node_modules and other
// specs don't pay for Next's startup. Ports: Retake on `port`, the dev server
// on `port + 1` (3340-3349 belong to these specs).
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawn, execFileSync } from "node:child_process"
import { BIN, FIXTURES } from "./servers.js"

const SKIP = new Set(["node_modules", ".next", ".react-router", "build", ".retake"])

/**
 * The fixture's copy in the temp dir, with node_modules installed. Null if they can't be.
 * `variant`: a second copy (a dev server run with other settings keeps its own
 * build cache), its node_modules cloned from the first.
 */
export function fixtureDir(name, variant = "") {
  const src = path.join(FIXTURES, name)
  const pkg = fs.readFileSync(path.join(src, "package.json"), "utf8")
  const hash = crypto.createHash("sha1").update(pkg).digest("hex").slice(0, 10)
  const dir = path.join(os.tmpdir(), "retake-fw", `${name}-${hash}${variant ? "-" + variant : ""}`)
  if (variant && !fs.existsSync(path.join(dir, "node_modules", ".retake-installed"))) {
    const base = fixtureDir(name)
    if (!base) return null
    fs.mkdirSync(dir, { recursive: true })
    try {
      // A copy-on-write clone where the file system has one (APFS, btrfs), else a copy.
      execFileSync("cp", process.platform === "darwin" ? ["-cR", path.join(base, "node_modules"), dir] : ["-R", "--reflink=auto", path.join(base, "node_modules"), dir], { stdio: "ignore" })
    } catch {
      return null
    }
  }
  fs.mkdirSync(dir, { recursive: true })
  // The sources, fresh every time (a spec may have edited its copy).
  fs.cpSync(src, dir, { recursive: true, force: true, filter: (p) => !SKIP.has(path.basename(p)) })
  const done = path.join(dir, "node_modules", ".retake-installed")
  if (!fs.existsSync(done)) {
    try {
      execFileSync("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error"], { cwd: dir, stdio: "ignore", timeout: 300_000 })
      fs.writeFileSync(done, pkg)
    } catch {
      return null
    }
  }
  return dir
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * `retake <fixture copy> --port <port>` with the dev server on port + 1.
 * `upstream`: `retake <that URL> --port <port> --root <root>` instead, in front
 * of a dev server that's already running (no project folder to look in).
 * Resolves once /__retake/health says the dev server has answered.
 * @returns {Promise<{ url: string, dir: string, out: () => string, stop: () => Promise<void> }>}
 */
export async function startFramework(name, port, { env = {}, args = [], dir = fixtureDir(name), upstream = null, root = null } = {}) {
  if (!dir) throw new Error(`couldn't install the ${name} fixture's dependencies`)
  const where = upstream ? root : dir
  fs.rmSync(path.join(where, ".retake"), { recursive: true, force: true })
  let out = ""
  const target = upstream ? [upstream, "--root", root] : [dir]
  const child = spawn(process.execPath, [BIN, ...target, "--port", String(port), ...args], {
    cwd: where,
    env: { ...process.env, PORT: String(port + 1), NEXT_TELEMETRY_DISABLED: "1", BROWSER: "none", ...env },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  })
  child.stdout.on("data", (d) => (out += d))
  child.stderr.on("data", (d) => (out += d))
  const exited = new Promise((r) => child.on("exit", r))
  const url = `http://localhost:${port}`
  const stop = async () => {
    try {
      process.kill(-child.pid, "SIGINT")
    } catch {}
    await Promise.race([exited, sleep(5000)])
    try {
      process.kill(-child.pid, "SIGKILL")
    } catch {}
  }
  const deadline = Date.now() + 120_000
  for (;;) {
    if (child.exitCode != null) throw new Error(`retake exited (${child.exitCode}):\n${out}`)
    try {
      const r = await fetch(`${url}/__retake/health`)
      if (r.status === 200) break
    } catch {}
    if (Date.now() > deadline) {
      await stop()
      throw new Error(`${name} never got healthy:\n${out}`)
    }
    await sleep(300)
  }
  return { url, dir, out: () => out, stop }
}
