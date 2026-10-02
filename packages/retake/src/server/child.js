// Runs the app's own dev command (`next dev`, `pnpm run dev`...) for the front
// server, and finds out where it listens: the first local URL it prints wins
// (Vite-based tools ignore PORT), else PORT, which is set to a free port unless
// it already was (and that one is free: a PORT exported in the shell with
// another app on it would have been taken for the dev server). The command runs
// in its own process group, so stopping it stops what it started too
// (`pnpm dev` → `next dev`), even what outlives the command itself (`reap`).
import http from "node:http"
import https from "node:https"
import net from "node:net"
import path from "node:path"
import fs from "node:fs"
import { spawn, spawnSync } from "node:child_process"

const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07/g
const LOCAL_URL = /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0):(\d{2,5})\b[^\s'"]*/

// The first local URL in a line of output (0.0.0.0 means this machine).
export function localUrlIn(text) {
  const m = LOCAL_URL.exec(String(text).replace(ANSI, ""))
  return m ? m[0].replace("0.0.0.0", "localhost").replace(/[).,;]+$/, "") : null
}

export function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer()
    s.unref()
    s.once("error", reject)
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address()
      s.close(() => resolve(port))
    })
  })
}

// Can we listen on this port (on any loopback address an app would use)?
function portFree(port) {
  const on = (host) =>
    new Promise((resolve) => {
      const s = net.createServer()
      s.unref()
      s.once("error", (e) => resolve(e.code === "EADDRNOTAVAIL" || e.code === "EAFNOSUPPORT"))
      s.listen(port, host, () => s.close(() => resolve(true)))
    })
  return Promise.all([on("127.0.0.1"), on("::1")]).then((r) => r.every(Boolean))
}

// Does anything answer HTTP there (any status)?
export function answers(url, timeout = 2000) {
  return new Promise((resolve) => {
    const u = new URL(url)
    const lib = u.protocol === "https:" ? https : http
    const r = lib.request(u, { method: "HEAD", autoSelectFamily: true, rejectUnauthorized: false, timeout }, (res) => {
      res.resume()
      resolve(true)
    })
    r.on("timeout", () => r.destroy())
    r.on("error", () => resolve(false))
    r.end()
  })
}

// The project's node_modules/.bin folders (walking up to a workspace root), so
// `retake -- next dev` finds the project's own `next`.
function binPath(cwd) {
  const dirs = []
  for (let d = path.resolve(cwd); ; d = path.dirname(d)) {
    const bin = path.join(d, "node_modules", ".bin")
    if (fs.existsSync(bin)) dirs.push(bin)
    if (path.dirname(d) === d) break
  }
  return dirs
}

/**
 * @param {string} command a shell command line
 * @param {{ cwd?: string, env?: object, onOutput?: (chunk: Buffer, stream: "stdout" | "stderr") => void }} [options]
 * @returns {Promise<{ child: import("node:child_process").ChildProcess, port: number, portTaken: number | null,
 *   url: Promise<string>, exited: Promise<number>, stop(signal?: string): void, reap(ms?: number): Promise<void> }>}
 *   `url` resolves once the server answers (it rejects if the command exits first).
 *   `portTaken`: the PORT given, if something else was already on it. `reap`:
 *   once the command has exited, what it started that's still running gets
 *   SIGTERM (unless it was signalled already), then SIGKILL `ms` after that.
 */
export async function runDevCommand(command, { cwd = process.cwd(), env = process.env, onOutput } = {}) {
  const asked = env.PORT ? Number(env.PORT) : null
  const portTaken = asked && !(await portFree(asked)) ? asked : null
  const port = asked && !portTaken ? asked : await freePort()
  const sep = process.platform === "win32" ? ";" : ":"
  const childEnv = { ...env, PORT: String(port), PATH: [...binPath(cwd), env.PATH || env.Path || ""].join(sep) }
  // Astro (7.x) moves `astro dev` into a detached background process when it
  // thinks an AI agent ran it (Claude Code, Cursor...): out of this process
  // group, so stopping Retake left it running, and the next run found "already
  // running" and exited. Retake is the foreground owner; this is how Astro's own
  // background child tells it not to background again.
  if (childEnv.ASTRO_DEV_BACKGROUND == null) childEnv.ASTRO_DEV_BACKGROUND = "1"
  if (process.stdout.isTTY && childEnv.FORCE_COLOR == null && childEnv.NO_COLOR == null) childEnv.FORCE_COLOR = "1"
  const win = process.platform === "win32"
  const child = spawn(command, { cwd, env: childEnv, shell: true, detached: !win, stdio: ["inherit", "pipe", "pipe"], windowsHide: true })

  let printed = null
  let pending = ""
  const scan = (chunk) => {
    if (printed) return
    pending = (pending + chunk.toString("utf8")).slice(-4096)
    const u = localUrlIn(pending)
    if (u) printed = u
  }
  const pass = (name) => (chunk) => {
    scan(chunk)
    if (onOutput) onOutput(chunk, name)
    else (name === "stderr" ? process.stderr : process.stdout).write(chunk)
  }
  child.stdout.on("data", pass("stdout"))
  child.stderr.on("data", pass("stderr"))

  let exitCode = null
  const exited = new Promise((resolve) => {
    child.on("exit", (code, signal) => resolve((exitCode = code ?? (signal ? 1 : 0))))
    child.on("error", () => resolve((exitCode = 127)))
  })

  // The printed URL (once it answers) wins; PORT answering first means the
  // tool honoured it.
  const url = (async () => {
    const fallback = `http://localhost:${port}`
    for (;;) {
      if (exitCode != null) throw new Error(`the dev command exited (code ${exitCode}) before it started a server`)
      if (printed) {
        const origin = new URL(printed).origin
        if (await answers(origin)) return origin
      } else if (await answers(fallback, 500)) return fallback
      await new Promise((r) => setTimeout(r, 250))
    }
  })()
  url.catch(() => {})

  // The command's process group: its leader (the shell, a package manager) can
  // exit while what it started is still stopping.
  let signalled = false
  const groupAlive = () => {
    if (win || child.pid == null) return false
    try {
      process.kill(-child.pid, 0)
      return true
    } catch (e) {
      return e.code === "EPERM"
    }
  }
  const stop = (signal = "SIGTERM") => {
    if (child.pid == null || (exitCode != null && !groupAlive())) return
    signalled = true
    try {
      if (win) spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" })
      else process.kill(-child.pid, signal)
    } catch {
      try {
        child.kill(signal)
      } catch {}
    }
  }
  const reap = async (ms = 5000) => {
    await exited
    if (!groupAlive()) return
    if (!signalled) stop("SIGTERM")
    const end = Date.now() + ms
    while (groupAlive() && Date.now() < end) await new Promise((r) => setTimeout(r, 100))
    if (groupAlive()) stop("SIGKILL")
  }
  return { child, port, portTaken, url, exited, stop, reap }
}
