#!/usr/bin/env node
// Retake CLI.
//   retake [dev] <project> [--port 3014] [--code-timelines] [-- ...dev server args]
//     A Vite single-page app: runs the project's own Vite with the timeline
//     added, from a wrapper config kept outside the project. A framework with
//     its own dev server (Next, Nuxt, React Router, Remix, SvelteKit, Astro...):
//     runs its dev command and puts Retake in front of it (src/server/front.js).
//     Nothing in the project is touched, unless code timelines are on: then
//     stepping into a timeline puts that timeline's code on disk.
//   retake http://localhost:3000
//     Puts Retake in front of a dev server that's already running.
//   retake -- <dev command>
//     Runs that command (e.g. `retake -- next dev`) and puts Retake in front.
//   retake init
//     Prints the lines that add Retake to a project's vite.config instead.
//   retake mcp
//     MCP server (stdio) for coding agents, talking to a running dev server.
//   retake code status|list|checkout <timeline>|restore [version]|export <timeline>
//     Each timeline's code (code timelines), with or without a dev server running.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import crypto from "node:crypto"
import { spawn } from "node:child_process"
import { createRequire } from "node:module"
import { fileURLToPath, pathToFileURL } from "node:url"
import { detectProject, nextDebugChannelWarning, shellQuote, withArgs } from "../src/server/detect.js"
import { runDevCommand } from "../src/server/child.js"

const HOME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const PKG = JSON.parse(fs.readFileSync(path.join(HOME, "package.json"), "utf8"))
const CONFIGS = ["vite.config.ts", "vite.config.mts", "vite.config.cts", "vite.config.js", "vite.config.mjs", "vite.config.cjs"]
const USAGE = `Retake ${PKG.version}: a time machine for your dev server

Usage:
  retake <project>                  run the project's dev server with the timeline
                                    (Vite apps, Next, Nuxt, React Router, Remix,
                                    SvelteKit, Astro...)
  retake dev <project> [options]    same thing
  retake http://localhost:3000      put the timeline in front of a running dev server
  retake -- <dev command>           run that command with the timeline in front
                                    (e.g. retake -- next dev, retake -- pnpm dev)
  retake init                       print the lines for vite.config or Next's
                                    proxy.ts instead
  retake mcp [--url http://localhost:3014]
                                    MCP server for coding agents (stdio)
  retake code status|list           each timeline's code (code timelines)
  retake code checkout <timeline>   put a timeline's code on disk
  retake code restore [version]     put the newest code (or a version) back
  retake code export <timeline> [--branch <name>]
                                    a timeline's code as a git branch (your
                                    working tree, index and HEAD stay as they are)

Options:
  --port <n>          port to serve on (default 3014)
  --root <dir>        where .retake/ (sessions, recordings) goes
                      (default: the project, or this folder)
  --code-timelines    each timeline keeps its own code: stepping into one puts
                      its code on disk (the newest goes back when Retake stops)
  --no-code-timelines every timeline shares the files (default: the dock asks
                      the first time it matters; --code-branches = on)
  --verbose           log every request to .retake/front.log (front server)
  --                  after a project: arguments for its dev server
                      (e.g. retake . -- --host); without one: the dev command
  -v, --version       print the version
  -h, --help          show this help`

/** @returns {never} */
function fail(msg, hint) {
  console.error(`retake: ${msg}`)
  if (hint) console.error(`        ${hint}`)
  process.exit(1)
}

// Minimal argv parsing with validation. After `--`: with no project, the dev
// command to run (`retake -- next dev`); otherwise arguments for the dev server.
export function parseArgs(argv) {
  const dash = argv.indexOf("--")
  const own = dash < 0 ? argv : argv.slice(0, dash)
  let passthrough = dash < 0 ? [] : argv.slice(dash + 1)
  /** @type {{ cmd: string | null, project: string | null, upstream: string | null, command: string[] | null, root: string | null, verbose: boolean,
   *   port: number, portSet?: boolean, codeTimelines?: boolean, url: string | null, passthrough: string[], help: boolean, version: boolean,
   *   codeArgs: string[], branch: string | null }} */
  const out = { cmd: null, project: null, upstream: null, command: null, root: null, verbose: false, port: 3014, url: null, passthrough, help: false, version: false, codeArgs: [], branch: null }
  const positional = []
  const value = (a, i, what) => {
    const v = a.includes("=") ? a.slice(a.indexOf("=") + 1) : own[i]
    if (v == null || v === "") throw new Error(`${a.split("=")[0]} needs ${what}`)
    return v
  }
  for (let i = 0; i < own.length; i++) {
    const a = own[i]
    if (a === "-h" || a === "--help") out.help = true
    else if (a === "-v" || a === "--version") out.version = true
    else if (a === "--code-branches" || a === "--code-timelines") out.codeTimelines = true
    else if (a === "--no-code-timelines") out.codeTimelines = false
    else if (a === "--branch" || a.startsWith("--branch=")) out.branch = value(a, a.includes("=") ? i : ++i, "a branch name")
    else if (a === "--verbose") out.verbose = true
    else if (a === "--port" || a.startsWith("--port=")) {
      const v = a.includes("=") ? a.split("=")[1] : own[++i]
      const n = Number(v)
      if (v == null || v === "" || !Number.isInteger(n) || n < 1 || n > 65535) throw new Error(`--port needs a number between 1 and 65535 (got ${v == null ? "nothing" : JSON.stringify(v)})`)
      out.port = n
      out.portSet = true
    } else if (a === "--url" || a.startsWith("--url=")) {
      out.url = a.includes("=") ? a.split("=")[1] : own[++i]
      if (!out.url) throw new Error("--url needs a value, like http://localhost:3014")
    } else if (a === "--root" || a.startsWith("--root=")) {
      out.root = value(a, a.includes("=") ? i : ++i, "a folder")
    } else if (a.startsWith("-")) throw new Error(`unknown option ${a} (pass dev server options after --, e.g. retake . -- ${a})`)
    else positional.push(a)
  }
  if (positional[0] === "code") {
    out.cmd = positional.shift()
    out.codeArgs = positional.splice(0)
  } else if (["dev", "init", "mcp", "help"].includes(positional[0])) out.cmd = positional.shift()
  else if (positional.length) out.cmd = "dev" // a bare path (or URL) means dev
  if (out.cmd === "help") out.help = true
  const target = positional.shift() ?? null
  if (target && /^https?:\/\//i.test(target)) {
    try {
      out.upstream = new URL(target).href
    } catch {
      throw new Error(`${JSON.stringify(target)} isn't a URL`)
    }
  } else out.project = target
  if (positional.length) throw new Error(`unexpected argument ${JSON.stringify(positional[0])}`)
  // `retake -- next dev`: no project, and the first word isn't an option.
  if (!out.project && !out.upstream && passthrough.length && !passthrough[0].startsWith("-") && (out.cmd === null || out.cmd === "dev")) {
    out.command = passthrough
    out.passthrough = passthrough = []
    out.cmd = "dev"
  }
  return out
}

// The project's own Vite (so its plugins match), found the way Node would find
// it from the project, walking up to a workspace root. Falls back to ours.
export function resolveVite(project) {
  const ours = path.join(HOME, "package.json")
  for (const from of [path.join(project, "package.json"), ours]) {
    try {
      const pkgPath = createRequire(from).resolve("vite/package.json")
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"))
      const bin = typeof pkg.bin === "string" ? pkg.bin : pkg.bin && pkg.bin.vite
      return { bin: path.join(path.dirname(pkgPath), bin || "bin/vite.js"), version: pkg.version, own: from === ours }
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

async function dev(opts) {
  if (opts.upstream || opts.command) {
    const root = path.resolve(opts.root || ".")
    // `retake -- "next dev --turbo"` (one word) is a command line as it is.
    const command = opts.command && (opts.command.length === 1 ? opts.command[0] : opts.command.map(shellQuote).join(" "))
    // Run from a framework's folder, it's that framework (it tunes the runtime).
    const here = opts.command ? detectProject(process.cwd()) : null
    const framework = here && here.mode === "front" ? here.framework : null
    // Whose code the timelines keep: the folder the dev command runs in, or
    // for a bare URL the --root given (no project folder to go on otherwise).
    const codeRoot = opts.command ? process.cwd() : opts.root ? root : null
    return front({ ...opts, root, upstream: opts.upstream, command, cwd: process.cwd(), framework, dir: framework ? process.cwd() : null, codeRoot })
  }
  const project = path.resolve(opts.project || ".")
  if (!fs.existsSync(project)) fail(`${project} doesn't exist`)
  if (!fs.existsSync(path.join(project, "package.json"))) fail(`no package.json in ${project}`, "point retake at your app's folder, e.g. retake ./my-app, or run retake -- <your dev command>")
  const found = detectProject(project)
  if (found.mode === "front") {
    if (found.framework === "next") {
      const warning = nextDebugChannelWarning(project)
      if (warning) console.warn(`retake: ${warning}`)
    }
    return front({ ...opts, root: path.resolve(opts.root || project), command: withArgs(found.command, opts.passthrough, found.pm), cwd: project, framework: found.framework, dir: project, codeRoot: project })
  }
  if (found.mode !== "vite") {
    fail(`${found.reason}`, `run your dev server through Retake instead: retake -- <your dev command> (e.g. retake -- npm run dev), or retake http://localhost:<port> if it's already running`)
  }
  viteDev(project, opts)
}

// A Vite single-page app: the project's own Vite, with the plugin added from a
// wrapper config outside the project.
function viteDev(project, opts) {
  const vite = resolveVite(project)
  if (!vite) fail(`vite isn't installed for ${project}`, "run your package manager's install there first")
  if (vite.own) console.warn(`retake: vite not found from ${project}; using retake's own vite ${vite.version}`)
  const config = CONFIGS.map((f) => path.join(project, f)).find((f) => fs.existsSync(f))
  const work = workDir(project)
  fs.mkdirSync(work, { recursive: true })
  // One wrapper (and dep cache) per port: Vite watches its config, so two runs
  // on one project sharing a wrapper would restart each other on the wrong port.
  const wrapper = path.join(work, `vite.config.${opts.port}.mjs`)
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
    cacheDir: ${JSON.stringify(path.join(work, `vite-${opts.port}`))},
    plugins: [retake({ ${opts.codeTimelines !== undefined ? `codeTimelines: ${opts.codeTimelines}, ` : ""}banner: true${opts.root ? `, root: ${JSON.stringify(path.resolve(opts.root))}` : ""} }), ...(cfg.plugins || [])],
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
  for (const sig of /** @type {NodeJS.Signals[]} */ (["SIGINT", "SIGTERM", "SIGHUP"])) process.on(sig, () => child.kill(sig))
}

// Front-server mode: Retake on --port, in front of a dev server that's
// running (`upstream`) or that `command` starts.
async function front(opts) {
  const { startFront } = await import(pathToFileURL(path.join(HOME, "src", "server", "front.js")).href)
  // Where the dev command listens isn't known until it says (or answers).
  let found = /** @type {{ resolve: (url: string) => void, reject: (err: any) => void } | null} */ (null)
  const upstream = opts.upstream || new Promise((resolve, reject) => (found = { resolve, reject }))
  let label = opts.upstream ? new URL(opts.upstream).host : opts.command
  let server
  try {
    server = await startFront({
      upstream,
      port: opts.port,
      root: opts.root,
      verbose: opts.verbose,
      framework: opts.framework,
      dir: opts.dir,
      watch: opts.dir || (opts.command ? opts.cwd : null) || opts.codeRoot, // whose edits retire kept pages
      code: { root: opts.codeRoot || null, enabled: opts.codeTimelines },
      get label() {
        return label // the waiting page's "Waiting for next dev on :3015…"
      },
    })
  } catch (err) {
    if (err.code === "EADDRINUSE") fail(`port ${opts.port} is in use`, `pick another with --port, e.g. --port ${opts.port === 65535 ? 3014 : opts.port + 1}`)
    throw err
  }
  // "Retake  timeline docked at http://localhost:3014  (in front of next dev on :3015)"
  const banner = (url, what) => {
    const c = server.code
    const codeLabel = c ? `  (code timelines: ${c.enabled === true ? "on" : c.enabled === false ? "off" : "ask"})` : ""
    console.log(`\n  \x1b[1mRetake\x1b[0m  timeline docked at ${server.url}  (in front of ${what})${codeLabel}`)
    console.log(`          Using sign-in? Sign in at ${new URL(url).origin} first.\n`)
  }
  const stop = async (code) => {
    await server.close().catch(() => {})
    process.exit(code)
  }
  if (opts.upstream) {
    banner(opts.upstream, new URL(opts.upstream).origin)
    for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, () => stop(0))
    return
  }
  // PORT is the dev server's, unless it's the one Retake took.
  const env = { ...process.env }
  if (Number(env.PORT) === server.port) delete env.PORT
  const dev = await runDevCommand(opts.command, { cwd: opts.cwd, env })
  if (dev.portTaken) console.warn(`retake: PORT ${dev.portTaken} is already in use; the dev command gets PORT=${dev.port}`)
  label = `${opts.command} on :${dev.port}`
  for (const sig of /** @type {NodeJS.Signals[]} */ (["SIGINT", "SIGTERM", "SIGHUP"])) {
    process.on(sig, () => {
      dev.stop(sig)
      // A dev server that ignores the signal gets SIGKILL after 5 s.
      setTimeout(() => dev.stop("SIGKILL"), 5000).unref()
    })
  }
  // Exit with the dev command's exit code, once what it started has stopped
  // too (a wrapper can exit on Ctrl-C before its server does: that one gets
  // SIGKILL 5 s on, not left running on its own).
  dev.exited.then(async (code) => {
    await dev.reap(5000)
    stop(code)
  })
  try {
    const url = await dev.url
    found?.resolve(url)
    label = `${opts.command} on :${new URL(url).port}`
    banner(url, label)
  } catch (err) {
    found?.reject(err)
  }
}
// `retake code …`: each timeline's code, from a terminal. With a dev server
// running it goes through the server (so the dock follows); without one it
// works on .retake/ directly, one process at a time (.retake/code.lock).
async function code(opts) {
  const [sub = "status", arg] = opts.codeArgs
  const { createCodeHost, exportVersion } = await import(pathToFileURL(path.join(HOME, "src", "code-versions.js")).href)
  const { sessionStore } = await import(pathToFileURL(path.join(HOME, "src", "server", "api.js")).href)
  // The project: --root, else the nearest folder with a .retake/ in it.
  let root = path.resolve(opts.root || ".")
  if (!opts.root) for (let d = root; ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, ".retake", "code-timelines.json"))) {
      root = d
      break
    }
    if (path.dirname(d) === d) break
  }
  if (!fs.existsSync(path.join(root, ".retake", "code-timelines.json"))) fail(`no code timelines in ${root}`, "run retake on the project first (or pass --root)")
  // A dev server running for it?
  /** @type {any} */
  let server = null
  try {
    const info = JSON.parse(fs.readFileSync(path.join(root, ".retake", "server.json"), "utf8"))
    const r = await fetch(`${info.url.replace(/\/$/, "")}/__retake/code`, { signal: AbortSignal.timeout(1500) })
    if (r.ok) server = info
  } catch {}
  const call = async (method, p, body) => {
    const r = await fetch(`${server.url.replace(/\/$/, "")}/__retake/${p}`, { method, headers: { "content-type": "application/json", "x-retake-token": server.token }, body: body ? JSON.stringify(body) : undefined })
    return r.json()
  }
  const sessions = sessionStore(root)
  const session = sessions.getSession()
  const host = server ? null : createCodeHost({ root, sessions, enabled: true, quiet: true, restoreOnExit: false, recoverCrash: false })
  const state = server ? await call("GET", "code") : host.state()
  const names = new Map((session.branches || []).map((b) => [String(b.id), b.name]))
  const nameOf = (id) => names.get(String(id)) || (state.deleted[id] && state.deleted[id].name) || `Timeline ${id}`
  const timelineOf = (which) => {
    if (which == null) fail("which timeline? (its number or name)")
    const id = Object.keys(state.timelines).find((k) => k === String(which) || nameOf(k).toLowerCase() === String(which).toLowerCase())
    if (!id) fail(`no timeline ${JSON.stringify(which)}`, "retake code list shows them")
    return id
  }
  if (sub === "status" || sub === "list") {
    const mode = state.enabled === true ? "on" : state.enabled === false ? "off (every timeline shares the files)" : "ask (not chosen yet; every timeline shares the files)"
    console.log(`Code timelines: ${mode}${state.suspended ? `, paused (${state.suspended})` : ""}${server ? `  [dev server at ${server.url}]` : ""}`)
    console.log(`On disk: ${state.checkedOut != null ? `${nameOf(state.checkedOut)}'s code` : "no timeline yet"} (version ${state.disk})${state.disk !== state.newest ? `; newest is ${state.newest}` : ""}`)
    for (const [id, t] of Object.entries(state.timelines)) {
      const here = String(id) === String(state.checkedOut) ? "*" : " "
      const files = sub === "list" && t.files && t.files.length ? `: ${t.files.join(", ")}` : ""
      console.log(`${here} ${id}  ${nameOf(id).padEnd(16)} ${t.head}  ${t.changed ? `${t.changed} file${t.changed > 1 ? "s" : ""} changed since it started${files}` : "no code changes"}`)
    }
    if (sub === "list") for (const [id, t] of Object.entries(state.deleted || {})) console.log(`  ${id}  deleted ${t.name || `Timeline ${id}`}  ${t.head}`)
    return
  }
  if (sub === "checkout") {
    const id = timelineOf(arg)
    const r = server ? await call("POST", "code/checkout", { branchId: Number(id) || id, reason: "cli", force: true }) : await host.checkout(id, { reason: "cli", force: true })
    if (!r.ok) fail(r.error || "couldn't check that timeline's code out")
    console.log(`Files on disk are now ${nameOf(id)}'s code (version ${r.version}${r.files && r.files.length ? `, ${r.files.length} file${r.files.length > 1 ? "s" : ""} changed` : ""}).`)
    if (!server) console.log(`Run "retake code restore" to put the newest code back.`)
    return
  }
  if (sub === "restore") {
    const v = arg || state.newest
    const r = server ? await call("POST", "code/restore", { version: v }) : await host.checkoutVersion(v)
    if (!r.ok) fail(r.error || "couldn't restore that version")
    console.log(`Files on disk are version ${v}${v === state.newest ? " (the newest)" : ""}${r.files && r.files.length ? `: ${r.files.length} file${r.files.length > 1 ? "s" : ""} changed` : ""}.`)
    return
  }
  if (sub === "export") {
    const id = timelineOf(arg)
    const store = host ? host.store : (await import(pathToFileURL(path.join(HOME, "src", "code-versions.js")).href)).createStore(root)
    const branch = opts.branch || `retake/timeline-${id}`
    try {
      const r = exportVersion(store, state.timelines[id].head, { branch, message: `${nameOf(id)}'s code (Retake version ${state.timelines[id].head})` })
      console.log(`Branch ${r.branch} is ${nameOf(id)}'s code (commit ${r.commit.slice(0, 10)}, on top of HEAD). Your working tree, index and HEAD are as they were.`)
    } catch (err) {
      fail(`couldn't export it: ${err.message}`)
    }
    return
  }
  fail(`unknown code command ${JSON.stringify(sub)}`, "retake code status | list | checkout <timeline> | restore [version] | export <timeline>")
}

function init() {
  console.log(`Add Retake to vite.config (dev only; it does nothing in builds):

  import { retake } from "retake-dev"

  export default defineConfig({
    plugins: [retake(), /* ...your plugins */],
  })

Options: retake({ codeTimelines: true }) gives each timeline its own code (false: they share it;
the default asks in the dock the first time it matters).

Next.js: one file in the project root (src/ if your app is in src/app), dev only; the timeline
shows on your usual dev URL:

  // proxy.ts (Next 16)
  export { default } from "retake-dev/next"

  // middleware.ts (Next 15)
  import retake from "retake-dev/next"
  export default retake
  export const config = { runtime: "nodejs" }

Or leave the project untouched and run:  npx retake-dev .
(Next, Nuxt, React Router, SvelteKit, Astro... too: it puts Retake in front of your dev server.)`)
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
  if (opts.cmd === "dev") return dev(opts).catch((err) => fail(err.message))
  if (opts.cmd === "init") return init()
  if (opts.cmd === "code") return code(opts).catch((err) => fail(err.message))
  if (opts.cmd === "mcp") {
    const { runMcp } = await import(pathToFileURL(path.join(HOME, "src", "server", "mcp.js")).href)
    // Without --url/--port it finds the server from <cwd>/.retake/server.json.
    return runMcp({ url: opts.url || process.env.RETAKE_URL || (opts.portSet ? `http://localhost:${opts.port}` : null) })
  }
}

// Only run when executed, not when imported by tests.
const invoked = process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
if (invoked) main()
