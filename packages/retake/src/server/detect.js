// What kind of project `retake <dir>` was pointed at, and how to run it.
//   front: a framework with its own dev server (Next, Nuxt, React Router,
//          Remix, SvelteKit, Astro...). Retake runs its dev command and sits in
//          front of it (server/front.js).
//   vite:  a Vite single-page app (index.html). Retake runs the project's own
//          Vite with the plugin added, from a wrapper config (bin/retake.js).
import fs from "node:fs"
import path from "node:path"

// Dependency → framework, and the framework's own dev command (the last resort,
// when package.json has no dev script).
export const FRAMEWORKS = {
  next: { name: "next", cli: "next dev" },
  nuxt: { name: "nuxt", cli: "nuxt dev" },
  "@remix-run/dev": { name: "remix", cli: "remix vite:dev" },
  "@react-router/dev": { name: "react-router", cli: "react-router dev" },
  "@sveltejs/kit": { name: "sveltekit", cli: "vite dev" },
  astro: { name: "astro", cli: "astro dev" },
  "@tanstack/react-start": { name: "tanstack-start", cli: "vite dev" },
  "@solidjs/start": { name: "solid-start", cli: "vinxi dev" },
  vike: { name: "vike", cli: "vike dev" },
  waku: { name: "waku", cli: "waku dev" },
  "@analogjs/platform": { name: "analog", cli: "vite" },
}
const VITE_CONFIGS = ["vite.config.ts", "vite.config.mts", "vite.config.cts", "vite.config.js", "vite.config.mjs", "vite.config.cjs"]
const LOCKS = [
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["package-lock.json", "npm"],
]

// The package manager: package.json's `packageManager`, else the nearest lockfile
// (a workspace's is at its root), else npm.
export function packageManager(dir, pkg = readPkg(dir)) {
  const declared = pkg && typeof pkg.packageManager === "string" && /^(pnpm|yarn|bun|npm)@/.exec(pkg.packageManager)
  if (declared) return declared[1]
  for (let d = path.resolve(dir); ; d = path.dirname(d)) {
    for (const [file, pm] of LOCKS) if (fs.existsSync(path.join(d, file))) return pm
    if (path.dirname(d) === d) return "npm"
  }
}

function readPkg(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"))
  } catch {
    return null
  }
}

/**
 * @param {string} dir the project folder
 * @returns {{ mode: "front" | "vite" | null, framework: string | null, command: string | null, pm: string | null, reason?: string }}
 */
export function detectProject(dir) {
  const pkg = readPkg(dir)
  if (!pkg) return { mode: null, framework: null, command: null, pm: null, reason: `no package.json in ${dir}` }
  const deps = { ...pkg.peerDependencies, ...pkg.optionalDependencies, ...pkg.devDependencies, ...pkg.dependencies }
  const dep = Object.keys(FRAMEWORKS).find((d) => d in deps)
  const pm = packageManager(dir, pkg)
  if (dep) {
    const fw = FRAMEWORKS[dep]
    const scripts = pkg.scripts || {}
    let command = null
    if (scripts.dev) command = `${pm} run dev`
    // A start script that runs a dev server (never a production `next start`).
    else if (scripts.start && /\bdev\b|^\s*vite(\s|$)/.test(scripts.start) && !/\bnext\s+start\b/.test(scripts.start)) command = `${pm} run start`
    else command = `${pm === "npm" ? "npx --no-install" : `${pm} exec`} ${fw.cli}`
    return { mode: "front", framework: fw.name, command, pm }
  }
  if (VITE_CONFIGS.some((f) => fs.existsSync(path.join(dir, f))) || fs.existsSync(path.join(dir, "index.html"))) {
    return { mode: "vite", framework: "vite", command: null, pm }
  }
  return { mode: null, framework: null, command: null, pm, reason: `no framework or Vite app found in ${dir}` }
}

// The dev server's own traffic, by URL (regular expressions on path + query),
// for the runtime to leave alone (RT.exemptUrls, see isExemptUrl in the
// runtime): HMR sockets, overlays and hot updates. A call stack can't always
// tell (Turbopack bundles Next's router and its HMR client into one chunk).
const VITE_TRAFFIC = ["^/@vite/client", "^/@react-refresh"]
export const DEV_TRAFFIC = {
  next: ["^/_next/webpack-hmr", "^/_next/hmr\\b", "^/__nextjs_", "\\.hot-update\\."],
  nuxt: ["^/__nuxt_devtools__", "^/_nuxt/@vite/client", ...VITE_TRAFFIC],
  astro: ["^/__astro_dev_toolbar", ...VITE_TRAFFIC],
  vite: VITE_TRAFFIC,
}
export const devTraffic = (framework) => DEV_TRAFFIC[framework] || VITE_TRAFFIC

// The version of Next installed for the project (null: not found): its
// node_modules or a parent folder's, as Node would find it from there, but not
// through NODE_PATH, where pnpm puts every package of the workspace Retake was
// started from (F74).
export function nextVersion(dir) {
  for (let d = path.resolve(dir); ; d = path.dirname(d)) {
    try {
      return JSON.parse(fs.readFileSync(path.join(d, "node_modules", "next", "package.json"), "utf8")).version || null
    } catch {}
    if (path.dirname(d) === d) return null
  }
}

// The major version of Next the project uses (null: not found).
export function nextMajor(dir) {
  try {
    const v = nextVersion(dir)
    return Number(v.split(".")[0]) || null
  } catch {
    return null
  }
}

/**
 * How the runtime runs behind the front server (RT, see core.js) for a
 * framework (null: not known yet; the front server sniffs Next itself).
 * The clock starts at the window's load (F47) and scripts added later are
 * held to their recorded moments (F48). `next`: the Next major version the
 * debug-channel adapter is for (F49; only 16 is known), "auto" when the
 * runtime has to ask Next's client (no project folder to look in).
 */
export function frontRuntime(framework, dir) {
  const rt = { bootAt: "load", holdScripts: true, exemptUrls: devTraffic(framework) }
  // (No project folder, or Next not found from it: the runtime reads Next's own version, "auto".)
  if (framework === "next") rt.next = (dir && nextMajor(dir)) || "auto"
  return rt
}

// Extra arguments for a detected dev command (`retake . -- --turbopack`).
export function withArgs(command, args, pm) {
  if (!args || !args.length) return command
  const quoted = args.map(shellQuote).join(" ")
  // `npm run dev --foo` would give --foo to npm itself.
  return pm === "npm" && /^npm run /.test(command) ? `${command} -- ${quoted}` : `${command} ${quoted}`
}

export const shellQuote = (a) => (/^[\w@%+=:,./-]+$/.test(a) ? a : process.platform === "win32" ? `"${a.replace(/"/g, '\\"')}"` : `'${a.replace(/'/g, "'\\''")}'`)

// Next 16 sends React's debug data for every page request over its HMR socket
// (`experimental.reactDebugChannel`, on by default), and a replayed request
// never gets it, so replayed navigations and server actions never show. Read
// as text, never evaluated. Returns the warning, or null.
export function nextDebugChannelWarning(dir) {
  let version = null
  try {
    version = nextVersion(dir)
  } catch {
    return null
  }
  if (!version || Number(version.split(".")[0]) < 16) return null
  const config = ["next.config.js", "next.config.mjs", "next.config.ts", "next.config.cjs", "next.config.mts"].map((f) => path.join(dir, f)).find((f) => fs.existsSync(f))
  let text = ""
  try {
    text = config ? fs.readFileSync(config, "utf8") : ""
  } catch {}
  if (/reactDebugChannel\s*:\s*false/.test(text)) return null
  // Retake speaks Next 16's debug channel itself (runtime/37-next.js).
  if (Number(version.split(".")[0]) === 16) return null
  return `Next ${version}: if replayed navigations and server actions don't show, set experimental: { reactDebugChannel: false } in ${config ? path.basename(config) : "next.config"} (Retake knows Next 16's debug channel, not this version's).`
}
