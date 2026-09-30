#!/usr/bin/env node
// Retake CLI.
//   retake [dev] <project> [--port 3014] [--code-branches] [-- ...vite args]
//     Runs the project's own Vite dev server with the timeline added, from a
//     wrapper config kept outside the project. Nothing in the project is touched
//     (except with --code-branches, which checks timelines' code out on disk).
//   retake init
//     Prints the lines that add Retake to a project's vite.config instead.
//   retake mcp
//     MCP server (stdio) for coding agents, talking to a running dev server.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import crypto from "node:crypto"
import { spawn } from "node:child_process"
import { createRequire } from "node:module"
import { fileURLToPath, pathToFileURL } from "node:url"

const HOME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const PKG = JSON.parse(fs.readFileSync(path.join(HOME, "package.json"), "utf8"))
const CONFIGS = ["vite.config.ts", "vite.config.mts", "vite.config.cts", "vite.config.js", "vite.config.mjs", "vite.config.cjs"]
const USAGE = `Retake ${PKG.version}: a time machine for Vite prototypes

Usage:
  retake <project>                  run the project's Vite dev server with the timeline
  retake dev <project> [options]    same thing
  retake init                       print the vite.config lines instead
  retake mcp [--url http://localhost:3014]
                                    MCP server for coding agents (stdio)

Options:
  --port <n>          port to serve on (default 3014)
  --code-branches     each timeline keeps its own version of the code
                      (rewrites files on disk; use on prototypes)
  --                  anything after this goes to vite (e.g. -- --host)
  -v, --version       print the version
  -h, --help          show this help`

function fail(msg, hint) {
  console.error(`retake: ${msg}`)
  if (hint) console.error(`        ${hint}`)
  process.exit(1)
}

// Minimal argv parsing with validation. Everything after `--` is passed to vite.
export function parseArgs(argv) {
  const dash = argv.indexOf("--")
  const own = dash < 0 ? argv : argv.slice(0, dash)
  const passthrough = dash < 0 ? [] : argv.slice(dash + 1)
  const out = { cmd: null, project: null, port: 3014, codeBranches: false, url: null, passthrough, help: false, version: false }
  const positional = []
  for (let i = 0; i < own.length; i++) {
    const a = own[i]
    if (a === "-h" || a === "--help") out.help = true
    else if (a === "-v" || a === "--version") out.version = true
    else if (a === "--code-branches") out.codeBranches = true
    else if (a === "--port" || a.startsWith("--port=")) {
      const v = a.includes("=") ? a.split("=")[1] : own[++i]
      const n = Number(v)
      if (v == null || v === "" || !Number.isInteger(n) || n < 1 || n > 65535) throw new Error(`--port needs a number between 1 and 65535 (got ${v == null ? "nothing" : JSON.stringify(v)})`)
      out.port = n
    } else if (a === "--url" || a.startsWith("--url=")) {
      out.url = a.includes("=") ? a.split("=")[1] : own[++i]
      if (!out.url) throw new Error("--url needs a value, like http://localhost:3014")
    } else if (a.startsWith("-")) throw new Error(`unknown option ${a} (pass vite options after --, e.g. retake . -- ${a})`)
    else positional.push(a)
  }
  if (["dev", "init", "mcp", "help"].includes(positional[0])) out.cmd = positional.shift()
  else if (positional.length) out.cmd = "dev" // a bare path means dev
  if (out.cmd === "help") out.help = true
  out.project = positional.shift() ?? null
  if (positional.length) throw new Error(`unexpected argument ${JSON.stringify(positional[0])}`)
  return out
}

// The project's own Vite (so its plugins match), found the way Node would find
// it from the project, walking up to a workspace root. Falls back to ours.
export function resolveVite(project) {
  for (const from of [path.join(project, "package.json"), path.join(HOME, "package.json")]) {
    try {
      const pkgPath = createRequire(from).resolve("vite/package.json")
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"))
      const bin = typeof pkg.bin === "string" ? pkg.bin : pkg.bin && pkg.bin.vite
      return { bin: path.join(path.dirname(pkgPath), bin || "bin/vite.js"), version: pkg.version, own: from.startsWith(HOME) }
    } catch {}
  }
  return null
}

// Wrapper config and Vite's dep cache live outside the project, keyed by the
// project's absolute path so two projects with the same folder name don't clash.
export function workDir(project) {
  const hash = crypto.createHash("sha1").update(project).digest("hex").slice(0, 10)
  const base = process.env.RETAKE_CACHE_DIR || path.join(os.tmpdir(), "retake")
  return path.join(base, `${path.basename(project)}-${hash}`)
}

function dev(opts) {
  const project = path.resolve(opts.project || ".")
  if (!fs.existsSync(project)) fail(`${project} doesn't exist`)
  if (!fs.existsSync(path.join(project, "package.json"))) fail(`no package.json in ${project}`, "point retake at a Vite project folder, e.g. retake ./my-app")
  const vite = resolveVite(project)
  if (!vite) fail(`vite isn't installed for ${project}`, "run your package manager's install there first")
  if (vite.own) console.warn(`retake: vite not found from ${project}; using retake's own vite ${vite.version}`)
  const config = CONFIGS.map((f) => path.join(project, f)).find((f) => fs.existsSync(f))
  const work = workDir(project)
  fs.mkdirSync(work, { recursive: true })
  const wrapper = path.join(work, "vite.config.mjs")
  const url = (p) => JSON.stringify(pathToFileURL(p).href)
  fs.writeFileSync(
    wrapper,
    `// Generated by retake; regenerated on every run.
import { retake } from ${url(path.join(HOME, "src", "plugin.js"))}
${config ? `import base from ${url(config)}` : "const base = {}"}

export default async (env) => {
  const cfg = (typeof base === "function" ? await base(env) : await base) || {}
  return {
    ...cfg,
    root: cfg.root ? cfg.root : ${JSON.stringify(project)},
    // Our own dep cache, so the project's node_modules/.vite is left alone.
    cacheDir: ${JSON.stringify(path.join(work, "vite"))},
    plugins: [retake({ codeBranches: ${opts.codeBranches}, banner: true }), ...(cfg.plugins || [])],
    server: { ...cfg.server, port: ${opts.port}, strictPort: true },
  }
}
`,
  )
  const child = spawn(process.execPath, [vite.bin, "--config", wrapper, ...opts.passthrough], {
    cwd: project,
    stdio: "inherit",
    env: { ...process.env, VITE_CONFIG_NATIVE_IGNORE_WARNING: "true", RETAKE_PROJECT: project },
  })
  child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)))
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, () => child.kill(sig))
}

function init() {
  console.log(`Add Retake to vite.config (dev only; it does nothing in builds):

  import { retake } from "retake-dev"

  export default defineConfig({
    plugins: [retake(), /* ...your plugins */],
  })

Options: retake({ codeBranches: true }) gives each timeline its own version of the code.
Or leave the project untouched and run:  npx retake-dev .`)
}

async function main() {
  let opts
  try {
    opts = parseArgs(process.argv.slice(2))
  } catch (err) {
    fail(err.message, "run retake --help for usage")
  }
  if (opts.version) return console.log(PKG.version)
  if (opts.help || !opts.cmd) {
    console.log(USAGE)
    return
  }
  if (opts.cmd === "dev") return dev(opts)
  if (opts.cmd === "init") return init()
  if (opts.cmd === "mcp") {
    const { runMcp } = await import(pathToFileURL(path.join(HOME, "src", "server", "mcp.js")).href)
    return runMcp({ url: opts.url || process.env.RETAKE_URL || `http://localhost:${opts.port}` })
  }
}

// Only run when executed, not when imported by tests.
const invoked = process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
if (invoked) main()
