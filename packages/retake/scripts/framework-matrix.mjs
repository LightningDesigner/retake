#!/usr/bin/env node
// Retake on real frameworks, end to end, in Chromium. Not part of `pnpm test`:
// each app is created in the OS temp dir ($TMPDIR/retake-matrix/<app>-<hash>)
// and installed there with npm once (keyed by its package.json), so the repo
// never holds a framework's node_modules.
//
//   node scripts/framework-matrix.mjs                 every app, both ways
//   node scripts/framework-matrix.mjs --only next16-app,astro --modes cli
//   node scripts/framework-matrix.mjs --list          the apps
//   options: --port 3360 (Retake on it, the dev server on the next one; url
//            mode uses +2/+3), --headed, --json <file>, --keep (leave .retake/);
//            MATRIX_DEBUG=1 prints the page's console when the HMR step fails and
//            the previewed DOM when the preview step does
//
// Two ways to start, as a user would:
//   cli: `retake <app>` (it detects the framework and runs its dev script)
//   url: the app's dev server started by hand, then `retake http://localhost:<port>`
// The scenario, on each: the dock loads and the app hydrates in its frame with
// no hydration warning; record (a counter, typing, a client-side navigation, a
// timer running); pause; scrub back (the live preview shows that moment);
// let go (one hidden build swaps in, "Building" never shows) and the rebuilt
// frame matches what the app logged at that moment; Play carries on to the
// live end; an edit while live hot-updates; a reload keeps the session (the
// old moment rebuilds from it).
// Every app logs what it does to window.__log ({ vt: performance.now(), k, v }),
// which the runtime's virtual clock stamps, and the checks compare against that.
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawn, execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { chromium } from "@playwright/test"
import { openDock } from "../test/engine/helpers.js"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const BIN = path.resolve(HERE, "../bin/retake.js")
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---- the apps ---------------------------------------------------------------
// The same page everywhere: a counter (#inc "count N"), a field (#name) echoed
// in #echo, a timer (#tick, every 250 ms), a client-side link to /about
// (#about), and #hmr ("hmr v1") from its own file, shown on both pages.
const LOG = `const L = (k, v) => { if (typeof window === "undefined") return; (window.__log = window.__log || []).push({ vt: performance.now(), k, v }) }`

const reactHome = ({ link, hmr, client = "" }) => `${client}import { useEffect, useRef, useState } from "react"
${link.import}
import Hmr from "${hmr}"
${LOG}
export default function Home() {
  const [n, setN] = useState(0)
  const [name, setName] = useState("")
  const [tick, setTick] = useState(0)
  const ticks = useRef(0)
  useEffect(() => {
    window.__hydrated = true
    L("path", location.pathname)
    const id = setInterval(() => {
      ticks.current++
      L("tick", ticks.current)
      setTick(ticks.current)
    }, 250)
    return () => clearInterval(id)
  }, [])
  return (
    <main>
      <h1>home</h1>
      <button id="inc" onClick={() => { L("count", n + 1); setN(n + 1) }}>count {n}</button>
      <input id="name" value={name} onChange={(e) => { L("name", e.target.value); setName(e.target.value) }} />
      <span id="echo">{name}</span>
      <span id="tick">{tick}</span>
      ${link.jsx("about", "/about", "to-about")}
      <Hmr />
    </main>
  )
}
`
const reactAbout = ({ link, hmr, client = "" }) => `${client}import { useEffect } from "react"
${link.import}
import Hmr from "${hmr}"
${LOG}
export default function About() {
  useEffect(() => {
    window.__hydrated = true
    L("path", location.pathname)
  }, [])
  return (
    <main>
      <h1 id="about">about page</h1>
      ${link.jsx("home", "/", "to-home")}
      <Hmr />
    </main>
  )
}
`
const reactHmr = `export default function Hmr() {
  return <span id="hmr">hmr v1</span>
}
`
const LINKS = {
  next: { import: `import Link from "next/link"`, jsx: (t, to, id) => `<Link id="${id}" href="${to}">${t}</Link>` },
  rr: { import: `import { Link } from "react-router"`, jsx: (t, to, id) => `<Link id="${id}" to="${to}">${t}</Link>` },
  remix: { import: `import { Link } from "@remix-run/react"`, jsx: (t, to, id) => `<Link id="${id}" to="${to}">${t}</Link>` },
  a: { import: ``, jsx: (t, to, id) => `<a id="${id}" href="${to}">${t}</a>` },
}
const REACT = { react: "19.2.0", "react-dom": "19.2.0" }

const nextApp = (version) => ({
  pkg: { scripts: { dev: "next dev" }, dependencies: { next: version, ...REACT } },
  files: {
    "app/layout.jsx": `export default function RootLayout({ children }) {\n  return (\n    <html lang="en">\n      <body>{children}</body>\n    </html>\n  )\n}\n`,
    "app/page.jsx": reactHome({ link: LINKS.next, hmr: "./hmr.jsx", client: `"use client"\n` }),
    "app/about/page.jsx": reactAbout({ link: LINKS.next, hmr: "../hmr.jsx", client: `"use client"\n` }),
    "app/hmr.jsx": reactHmr,
  },
  hmr: "app/hmr.jsx",
  dev: (port) => `npx --no-install next dev -p ${port}`,
})

export const APPS = {
  "next16-app": { label: "Next.js 16 App Router", ...nextApp("16.3.8") },
  "next15-app": { label: "Next.js 15 App Router", ...nextApp("15.5.27") },
  "next16-pages": {
    label: "Next.js 16 Pages Router",
    pkg: { scripts: { dev: "next dev" }, dependencies: { next: "16.3.8", ...REACT } },
    files: {
      "pages/index.jsx": reactHome({ link: LINKS.next, hmr: "../components/hmr.jsx" }),
      "pages/about.jsx": reactAbout({ link: LINKS.next, hmr: "../components/hmr.jsx" }),
      "components/hmr.jsx": reactHmr,
    },
    hmr: "components/hmr.jsx",
    dev: (port) => `npx --no-install next dev -p ${port}`,
  },
  "react-router7": {
    label: "React Router 7 (framework mode)",
    pkg: {
      scripts: { dev: "react-router dev" },
      dependencies: { "react-router": "7.18.4", "@react-router/node": "7.18.4", isbot: "^5", ...REACT },
      devDependencies: { "@react-router/dev": "7.18.4", vite: "^7" },
    },
    files: {
      "vite.config.js": `import { reactRouter } from "@react-router/dev/vite"\nimport { defineConfig } from "vite"\nexport default defineConfig({ plugins: [reactRouter()], server: { port: Number(process.env.PORT) || 5173, strictPort: true } })\n`,
      "react-router.config.js": `export default { ssr: true }\n`,
      "app/root.jsx": `import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router"\nexport function Layout({ children }) {\n  return (\n    <html lang="en">\n      <head>\n        <meta charSet="utf-8" />\n        <Meta />\n        <Links />\n      </head>\n      <body>\n        {children}\n        <ScrollRestoration />\n        <Scripts />\n      </body>\n    </html>\n  )\n}\nexport default function App() {\n  return <Outlet />\n}\n`,
      "app/routes.js": `import { index, route } from "@react-router/dev/routes"\nexport default [index("routes/home.jsx"), route("about", "routes/about.jsx")]\n`,
      "app/routes/home.jsx": reactHome({ link: LINKS.rr, hmr: "../hmr.jsx" }),
      "app/routes/about.jsx": reactAbout({ link: LINKS.rr, hmr: "../hmr.jsx" }),
      "app/hmr.jsx": reactHmr,
    },
    hmr: "app/hmr.jsx",
    dev: (port) => `npx --no-install react-router dev --port ${port}`,
  },
  remix2: {
    label: "Remix v2 (Vite)",
    pkg: {
      scripts: { dev: "remix vite:dev" },
      dependencies: { "@remix-run/node": "2.17.5", "@remix-run/react": "2.17.5", isbot: "^5", react: "18.3.1", "react-dom": "18.3.1" },
      devDependencies: { "@remix-run/dev": "2.17.5", vite: "^6" },
    },
    files: {
      "vite.config.js": `import { vitePlugin as remix } from "@remix-run/dev"\nimport { defineConfig } from "vite"\nexport default defineConfig({ plugins: [remix()], server: { port: Number(process.env.PORT) || 5173, strictPort: true } })\n`,
      "app/root.jsx": `import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "@remix-run/react"\nexport function Layout({ children }) {\n  return (\n    <html lang="en">\n      <head>\n        <meta charSet="utf-8" />\n        <Meta />\n        <Links />\n      </head>\n      <body>\n        {children}\n        <ScrollRestoration />\n        <Scripts />\n      </body>\n    </html>\n  )\n}\nexport default function App() {\n  return <Outlet />\n}\n`,
      "app/routes/_index.jsx": reactHome({ link: LINKS.remix, hmr: "../hmr.jsx" }),
      "app/routes/about.jsx": reactAbout({ link: LINKS.remix, hmr: "../hmr.jsx" }),
      "app/hmr.jsx": reactHmr,
    },
    hmr: "app/hmr.jsx",
    dev: (port) => `npx --no-install remix vite:dev --port ${port}`,
  },
  astro: {
    label: "Astro (React islands, ClientRouter)",
    pkg: { scripts: { dev: "astro dev" }, dependencies: { astro: "7.3.5", "@astrojs/react": "latest", ...REACT } },
    files: {
      "astro.config.mjs": `import { defineConfig } from "astro/config"\nimport react from "@astrojs/react"\nexport default defineConfig({ integrations: [react()], server: { port: Number(process.env.PORT) || 4321 } })\n`,
      "src/layouts/Page.astro": `---\nimport { ClientRouter } from "astro:transitions"\n---\n<html lang="en">\n  <head>\n    <meta charset="utf-8" />\n    <title>astro</title>\n    <ClientRouter />\n  </head>\n  <body>\n    <slot />\n  </body>\n</html>\n`,
      "src/pages/index.astro": `---\nimport Page from "../layouts/Page.astro"\nimport Home from "../components/Home.jsx"\n---\n<Page><Home client:load /></Page>\n`,
      "src/pages/about.astro": `---\nimport Page from "../layouts/Page.astro"\nimport About from "../components/About.jsx"\n---\n<Page><About client:load /></Page>\n`,
      "src/components/Home.jsx": reactHome({ link: LINKS.a, hmr: "./Hmr.jsx" }),
      "src/components/About.jsx": reactAbout({ link: LINKS.a, hmr: "./Hmr.jsx" }),
      "src/components/Hmr.jsx": reactHmr,
    },
    hmr: "src/components/Hmr.jsx",
    dev: (port) => `npx --no-install astro dev --port ${port}`,
  },
  sveltekit: {
    label: "SvelteKit",
    pkg: {
      scripts: { dev: "vite dev" },
      devDependencies: { "@sveltejs/kit": "latest", "@sveltejs/vite-plugin-svelte": "latest", svelte: "latest", vite: "latest" },
    },
    files: {
      "vite.config.js": `import { sveltekit } from "@sveltejs/kit/vite"\nimport { defineConfig } from "vite"\nexport default defineConfig({ plugins: [sveltekit()], server: { port: Number(process.env.PORT) || 5173, strictPort: true } })\n`,
      "src/app.html": `<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="utf-8" />\n    %sveltekit.head%\n  </head>\n  <body data-sveltekit-preload-data="hover">\n    <div style="display: contents">%sveltekit.body%</div>\n  </body>\n</html>\n`,
      "src/routes/+page.svelte": `<script>\n  import { onMount } from "svelte"\n  import Hmr from "../lib/Hmr.svelte"\n  ${LOG}\n  let n = $state(0)\n  let name = $state("")\n  let tick = $state(0)\n  onMount(() => {\n    window.__hydrated = true\n    L("path", location.pathname)\n    const id = setInterval(() => {\n      tick++\n      L("tick", tick)\n    }, 250)\n    return () => clearInterval(id)\n  })\n</script>\n\n<main>\n  <h1>home</h1>\n  <button id="inc" onclick={() => { L("count", n + 1); n++ }}>count {n}</button>\n  <input id="name" value={name} oninput={(e) => { L("name", e.currentTarget.value); name = e.currentTarget.value }} />\n  <span id="echo">{name}</span>\n  <span id="tick">{tick}</span>\n  <a id="to-about" href="/about">about</a>\n  <Hmr />\n</main>\n`,
      "src/routes/about/+page.svelte": `<script>\n  import { onMount } from "svelte"\n  import Hmr from "../../lib/Hmr.svelte"\n  ${LOG}\n  onMount(() => {\n    window.__hydrated = true\n    L("path", location.pathname)\n  })\n</script>\n\n<main>\n  <h1 id="about">about page</h1>\n  <a id="to-home" href="/">home</a>\n  <Hmr />\n</main>\n`,
      "src/lib/Hmr.svelte": `<span id="hmr">hmr v1</span>\n`,
    },
    hmr: "src/lib/Hmr.svelte",
    dev: (port) => `npx --no-install vite dev --port ${port} --strictPort`,
  },
  nuxt: {
    label: "Nuxt",
    pkg: { scripts: { dev: "nuxt dev" }, dependencies: { nuxt: "latest", vue: "latest", "vue-router": "latest" } },
    files: {
      "nuxt.config.js": `export default defineNuxtConfig({ compatibilityDate: "2025-07-15", devtools: { enabled: true }, devServer: { port: Number(process.env.PORT) || 3000 } })\n`,
      "app/app.vue": `<template>\n  <NuxtPage />\n</template>\n`,
      "app/pages/index.vue": `<script setup>\nimport { ref, onMounted, onUnmounted } from "vue"\n${LOG}\nconst n = ref(0)\nconst name = ref("")\nconst tick = ref(0)\nlet id = 0\nonMounted(() => {\n  window.__hydrated = true\n  L("path", location.pathname)\n  id = setInterval(() => {\n    tick.value++\n    L("tick", tick.value)\n  }, 250)\n})\nonUnmounted(() => clearInterval(id))\nfunction inc() {\n  L("count", n.value + 1)\n  n.value++\n}\nfunction onName(e) {\n  L("name", e.target.value)\n  name.value = e.target.value\n}\n</script>\n\n<template>\n  <main>\n    <h1>home</h1>\n    <button id="inc" @click="inc">count {{ n }}</button>\n    <input id="name" :value="name" @input="onName" />\n    <span id="echo">{{ name }}</span>\n    <span id="tick">{{ tick }}</span>\n    <NuxtLink id="to-about" to="/about">about</NuxtLink>\n    <Hmr />\n  </main>\n</template>\n`,
      "app/pages/about.vue": `<script setup>\nimport { onMounted } from "vue"\n${LOG}\nonMounted(() => {\n  window.__hydrated = true\n  L("path", location.pathname)\n})\n</script>\n\n<template>\n  <main>\n    <h1 id="about">about page</h1>\n    <NuxtLink id="to-home" to="/">home</NuxtLink>\n    <Hmr />\n  </main>\n</template>\n`,
      "app/components/Hmr.vue": `<template>\n  <span id="hmr">hmr v1</span>\n</template>\n`,
    },
    hmr: "app/components/Hmr.vue",
    dev: (port) => `npx --no-install nuxt dev --port ${port}`,
    // (nuxt dev takes neither PORT nor devServer.port: it would take :3000.)
    cliArgs: (port) => ["--", "--port", String(port)],
  },
  "vite-react": {
    label: "Vite React SPA",
    pkg: {
      scripts: { dev: "vite" },
      dependencies: { "react-router": "7.18.4", ...REACT },
      devDependencies: { vite: "latest", "@vitejs/plugin-react": "latest" },
    },
    files: {
      "vite.config.js": `import { defineConfig } from "vite"\nimport react from "@vitejs/plugin-react"\nexport default defineConfig({ plugins: [react()], server: { port: Number(process.env.PORT) || 5173, strictPort: true } })\n`,
      "index.html": `<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="utf-8" />\n    <title>vite</title>\n  </head>\n  <body>\n    <div id="root"></div>\n    <script type="module" src="/src/main.jsx"></script>\n  </body>\n</html>\n`,
      "src/main.jsx": `import { StrictMode } from "react"\nimport { createRoot } from "react-dom/client"\nimport { createBrowserRouter, RouterProvider } from "react-router"\nimport Home from "./Home.jsx"\nimport About from "./About.jsx"\nconst router = createBrowserRouter([{ path: "/", element: <Home /> }, { path: "/about", element: <About /> }])\ncreateRoot(document.getElementById("root")).render(\n  <StrictMode>\n    <RouterProvider router={router} />\n  </StrictMode>,\n)\n`,
      "src/Home.jsx": reactHome({ link: LINKS.rr, hmr: "./Hmr.jsx" }),
      "src/About.jsx": reactAbout({ link: LINKS.rr, hmr: "./Hmr.jsx" }),
      "src/Hmr.jsx": reactHmr,
    },
    hmr: "src/Hmr.jsx",
    dev: (port) => `npx --no-install vite --port ${port} --strictPort`,
  },
}

/** The app's folder in the temp dir, created and installed (once). */
export function appDir(name) {
  const app = APPS[name]
  const pkg = JSON.stringify({ name: `retake-matrix-${name}`, private: true, type: "module", ...app.pkg }, null, 2)
  const hash = crypto.createHash("sha1").update(pkg).digest("hex").slice(0, 10)
  const dir = path.join(os.tmpdir(), "retake-matrix", `${name}-${hash}`)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, "package.json"), pkg + "\n")
  for (const [f, text] of Object.entries(app.files)) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true })
    fs.writeFileSync(path.join(dir, f), text)
  }
  const done = path.join(dir, "node_modules", ".retake-installed")
  if (!fs.existsSync(done)) {
    console.error(`[matrix] npm install in ${dir}`)
    execFileSync("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error"], { cwd: dir, stdio: "inherit", timeout: 600_000 })
    fs.writeFileSync(done, pkg)
  }
  return dir
}

// ---- processes ----------------------------------------------------------------
function run(cmd, args, { cwd, env, label }) {
  let out = ""
  const child = spawn(cmd, args, { cwd, env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1", BROWSER: "none", NUXT_TELEMETRY_DISABLED: "1", ASTRO_TELEMETRY_DISABLED: "1", ...env }, stdio: ["ignore", "pipe", "pipe"], detached: true })
  child.stdout.on("data", (d) => (out += d))
  child.stderr.on("data", (d) => (out += d))
  const exited = new Promise((r) => child.on("exit", r))
  return {
    child,
    label,
    out: () => out,
    async stop() {
      try {
        process.kill(-child.pid, "SIGINT")
      } catch {}
      await Promise.race([exited, sleep(6000)])
      try {
        process.kill(-child.pid, "SIGKILL")
      } catch {}
    },
  }
}

async function waitFor(url, ok, proc, ms = 180_000) {
  const deadline = Date.now() + ms
  for (;;) {
    if (proc && proc.child.exitCode != null) throw new Error(`${proc.label} exited (${proc.child.exitCode}):\n${proc.out().slice(-3000)}`)
    try {
      const r = await fetch(url, { headers: { accept: "text/html" }, signal: AbortSignal.timeout(30_000) })
      if (ok(r.status)) return
    } catch {}
    if (Date.now() > deadline) throw new Error(`${url} never answered:\n${proc ? proc.out().slice(-3000) : ""}`)
    await sleep(400)
  }
}

/** Starts the app one way; resolves to { url, stop, procs }. */
export async function start(name, dir, mode, base) {
  fs.rmSync(path.join(dir, ".retake"), { recursive: true, force: true })
  const app = APPS[name]
  const procs = []
  const stop = async () => {
    for (const p of procs.reverse()) await p.stop()
  }
  try {
    if (mode === "cli") {
      const retake = run(process.execPath, [BIN, dir, "--port", String(base), "--verbose", ...(app.cliArgs ? app.cliArgs(base + 1) : [])], { cwd: dir, env: { PORT: String(base + 1) }, label: "retake" })
      procs.push(retake)
      const url = `http://localhost:${base}`
      // (A Vite SPA runs inside Retake's own Vite: no health route.)
      if (name === "vite-react") await waitFor(url + "/", (s) => s === 200, retake)
      else await waitFor(url + "/__retake/health", (s) => s === 200, retake)
      return { url, stop, procs }
    }
    const devPort = base + 1
    const [cmd, ...args] = app.dev(devPort).split(" ")
    // (Run from an agent, `astro dev` would move itself to the background and exit.)
    const dev = run(cmd, args, { cwd: dir, env: { PORT: String(devPort), ASTRO_DEV_BACKGROUND: "1" }, label: "dev server" })
    procs.push(dev)
    await waitFor(`http://localhost:${devPort}/`, (s) => s < 500, dev)
    const retake = run(process.execPath, [BIN, `http://localhost:${devPort}`, "--port", String(base), "--root", dir, "--verbose"], { cwd: dir, label: "retake" })
    procs.push(retake)
    const url = `http://localhost:${base}`
    await waitFor(url + "/__retake/health", (s) => s === 200, retake)
    return { url, stop, procs }
  } catch (e) {
    await stop()
    throw e
  }
}

// ---- the scenario ---------------------------------------------------------------
const STEPS = ["dock", "hydrate", "record", "pause", "preview", "release", "rebuilt", "play", "hmr", "reload"]
const dock = (page, fn, arg) => page.evaluate(`(${fn})(window.__retakeDock.state, ${JSON.stringify(arg ?? null)})`)
const readApp = () => {
  const q = (s) => document.querySelector(s)
  return {
    now: __retake.state().now,
    path: location.pathname,
    count: q("#inc") ? q("#inc").textContent.replace("count", "").trim() : null,
    name: q("#name") ? q("#name").value : null,
    echo: q("#echo") ? q("#echo").textContent : null,
    tick: q("#tick") ? q("#tick").textContent : null,
    about: !!q("#about"),
    hmr: q("#hmr") ? q("#hmr").textContent : null,
  }
}
// What the app logged by virtual time t: the value of each key at t, with a
// frame or two either side accepted (a rebuild rests just short of t).
function expectedAt(log, off, t) {
  const at = (k, d, u) => {
    let v = d
    for (const e of log) if (e.k === k && e.vt - off <= u) v = e.v
    return String(v)
  }
  const out = {}
  for (const [k, d] of [["count", 0], ["name", ""], ["tick", 0], ["path", "/"]]) out[k] = [...new Set([at(k, d, t - 40), at(k, d, t), at(k, d, t + 40)])]
  return out
}
function compare(got, exp, { value = true } = {}) {
  const bad = []
  if (!exp.path.includes(got.path)) bad.push(`path ${got.path} (want ${exp.path})`)
  if (got.path === "/") {
    if (!exp.count.includes(got.count)) bad.push(`count ${got.count} (want ${exp.count})`)
    if (!exp.name.includes(got.echo)) bad.push(`echo "${got.echo}" (want ${exp.name})`)
    if (value && !exp.name.includes(got.name)) bad.push(`input "${got.name}" (want ${exp.name})`)
    if (!exp.tick.includes(got.tick)) bad.push(`tick ${got.tick} (want ${exp.tick})`)
  }
  return bad
}

async function scenario(page, name, dir, url, mode) {
  const R = {}
  const set = (step, ok, note = "") => (R[step] = { ok: !!ok, note: String(note || "") })
  const consoleMsgs = []
  const allMsgs = []
  page.on("console", (m) => {
    allMsgs.push(`${m.type()}: ${m.text()}`.slice(0, 300))
    if (["error", "warning"].includes(m.type())) consoleMsgs.push(m.text())
  })
  const hydration = () => consoleMsgs.filter((t) => /hydrat|did not match|mismatch/i.test(t))

  // The dock, and the app hydrated in its frame.
  const h = await openDock(page, url + "/")
  set("dock", (await page.locator("#wb-dock").count()) === 1 && (await page.locator("#wb-stage iframe.live").count()) === 1)
  const deadline = Date.now() + 90_000
  while (!(await h.rt(() => !!window.__hydrated && !!document.querySelector("#inc")).catch(() => false))) {
    if (Date.now() > deadline) throw new Error("the app never hydrated in the frame")
    await page.waitForTimeout(250)
  }
  await page.waitForTimeout(600)
  const href = await h.rt(() => location.href)
  // (Only the Vite SPA path marks its frame with ?__wb=app; behind the front server no URL carries it, F46.)
  const viteSpa = name === "vite-react" && mode === "cli"
  const wbOk = viteSpa || !href.includes("__wb")
  set("hydrate", hydration().length === 0 && wbOk, hydration().length ? hydration()[0].slice(0, 160) : wbOk ? "" : "the frame's URL has __wb")

  // Record: counter, typing, the timer running, a client-side navigation.
  const s0 = await h.state()
  await h.click("#inc")
  await page.waitForTimeout(250)
  await h.click("#inc")
  await page.waitForTimeout(250)
  await h.click("#name")
  await page.keyboard.type("hello", { delay: 70 })
  await page.waitForTimeout(900)
  const tTarget = (await h.state()).now - 350
  const docBefore = await h.rt(() => performance.timeOrigin)
  await h.click("#to-about")
  let nav = false
  for (let i = 0; i < 60 && !nav; i++) {
    await page.waitForTimeout(200)
    nav = await h.rt(() => !!document.querySelector("#about")).catch(() => false)
  }
  const soft = nav && (await h.rt(() => performance.timeOrigin).catch(() => 0)) === docBefore
  await page.waitForTimeout(800)
  const live = await h.rt(() => ({ log: JSON.parse(JSON.stringify(window.__log || [])), off: performance.now() - __retake.state().now, s: __retake.state() }))
  const counted = live.log.filter((e) => e.k === "count").length
  set("record", s0.playing !== false && nav && counted === 2 && live.log.some((e) => e.k === "name" && e.v === "hello"), nav ? (soft ? "client-side nav" : "nav was a full page load") : "navigation never showed /about")

  // Pause with the dock's button.
  await page.click('#wb-dock [data-a="play"]')
  await page.waitForTimeout(300)
  const sp = await h.state()
  set("pause", sp.playing === false && !(await h.rt(() => __retake.isInteractive())), `end ${Math.round(sp.end)} ms`)

  // Scrub back (Alt: no snapping) and hold: the live preview shows the moment.
  await page.evaluate(() => {
    const W = (window.__watch = { phases: [], added: 0, stop: false })
    new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => n.tagName === "IFRAME" && !n.classList.contains("checkpoint") && W.added++))).observe(document.querySelector("#wb-stage"), { childList: true })
    const loop = () => {
      const p = document.querySelector(".readout .phase").textContent
      if (W.phases[W.phases.length - 1] !== p) W.phases.push(p)
      if (!W.stop) requestAnimationFrame(loop)
    }
    requestAnimationFrame(loop)
  })
  const xOf = (t) =>
    page.evaluate((t) => {
      const D = window.__retakeDock.state
      const r = document.querySelector(".lines").getBoundingClientRect()
      return r.left + 12 + ((t - D.view.from) / (D.view.to - D.view.from)) * (r.width - 30)
    }, t)
  const g = await page.locator(".lines").boundingBox()
  const y = g.y + g.height - 6
  const x0 = await xOf(sp.now)
  const x1 = await xOf(tTarget)
  await page.keyboard.down("Alt")
  await page.mouse.move(x0, y)
  await page.mouse.down()
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(x0 + ((x1 - x0) * i) / 12, y)
    await page.waitForTimeout(16)
  }
  await page.waitForTimeout(200)
  const dragT = await dock(page, (D) => D.dragT)
  const pv = await h.rt(() => ({ ...__retake.state() }))
  // (A preview leaves the app's own location alone; the route on show is state().route,
  // which the dock's address bar follows.)
  await page.waitForTimeout(500)
  const pvApp = { ...(await h.rt(readApp)), path: pv.route, bar: new URL(page.url()).pathname }
  const exp = expectedAt(live.log, live.off, dragT)
  // (The preview doesn't put form values back, F37: the field isn't checked.)
  const pvBad = compare(pvApp, exp, { value: false })
  if (pvApp.bar !== pv.route) pvBad.push(`address bar ${pvApp.bar} (route ${pv.route})`)
  if (pvApp.about || pvApp.count == null) pvBad.push("the DOM isn't the home page")
  if (pvBad.length && process.env.MATRIX_DEBUG) console.error("preview body:", await h.rt(() => [document.body.children.length, ...[...document.querySelectorAll("astro-island, main, #__nuxt")].map((e) => e.tagName + " " + e.innerHTML.slice(0, 300))]))
  set("preview", pv.previewing && pvBad.length === 0, pv.previewing ? `count ${pvApp.count}, echo "${pvApp.echo}", tick ${pvApp.tick}${pvBad.length ? "; " + pvBad.join("; ") : ""}` : "not previewing")
  await page.waitForTimeout(100)
  await page.mouse.move(x1, y)

  // Let go: one hidden build, swapped in, "Building" never shown.
  await page.evaluate(() => (window.__watch.phases = [document.querySelector(".readout .phase").textContent]))
  await page.keyboard.up("Alt")
  await page.mouse.up()
  let swapped = false
  const t0 = Date.now()
  while (!swapped && Date.now() - t0 < 45_000) {
    await page.waitForTimeout(100)
    swapped = await dock(page, (D) => !D.building && document.querySelectorAll("#wb-stage iframe:not(.checkpoint)").length === 1 && !!D.PT && D.PT.state().booted && !D.PT.state().seeking)
  }
  const swapMs = Date.now() - t0
  const w = await page.evaluate(() => ((window.__watch.stop = true), window.__watch))
  const building = w.phases.filter((p) => /Building/.test(p))
  set("release", swapped && building.length === 0 && w.added === 1, `${swapped ? `swap in ${swapMs} ms` : "never swapped"}, frames added ${w.added}, phases ${w.phases.join(">")}`)

  // The rebuilt frame matches what the app logged at that moment.
  await page.waitForTimeout(300)
  const rb = await h.rt(readApp)
  const rbExp = expectedAt(live.log, live.off, rb.now)
  const rbBad = compare(rb, rbExp)
  set("rebuilt", Math.abs(rb.now - dragT) < 60 && rbBad.length === 0, `at ${Math.round(rb.now)} (asked ${Math.round(dragT)}): count ${rb.count}, "${rb.name}", tick ${rb.tick}${rbBad.length ? "; " + rbBad.join("; ") : ""}`)

  // Play carries on through the recording to the live end.
  await page.click('#wb-dock [data-a="play"]')
  let liveAgain = false
  const tp = Date.now()
  while (!liveAgain && Date.now() - tp < sp.end - dragT + 20_000) {
    await page.waitForTimeout(150)
    liveAgain = await h.rt(() => __retake.isInteractive()).catch(() => false)
  }
  const end = await h.rt(readApp).catch(() => ({}))
  set("play", liveAgain && end.about && end.path === "/about", liveAgain ? `live on ${end.path}` : "never reached the live end")

  // An edit while live hot-updates the page.
  const file = path.join(dir, APPS[name].hmr)
  const original = fs.readFileSync(file, "utf8")
  try {
    fs.writeFileSync(file, original.replace("hmr v1", "hmr v2"))
    let hm = null
    const th = Date.now()
    while (hm !== "hmr v2" && Date.now() - th < 25_000) {
      await page.waitForTimeout(200)
      hm = await h.rt(() => document.querySelector("#hmr") && document.querySelector("#hmr").textContent).catch(() => null)
    }
    const st = await h.state().catch(() => ({}))
    if (hm !== "hmr v2" && process.env.MATRIX_DEBUG) console.error(allMsgs.slice(-40).join("\n"))
    set("hmr", hm === "hmr v2" && st.playing, `${hm === "hmr v2" ? `in ${Date.now() - th} ms` : `shows "${hm}"`}${st.playing ? "" : ", not playing"}`)
  } finally {
    fs.writeFileSync(file, original)
  }
  await page.waitForTimeout(2500)

  // A reload keeps the session: the old moment rebuilds from it.
  await page.click('#wb-dock [data-a="play"]')
  await page.waitForTimeout(1200) // (the dock saves the recording)
  const before = await dock(page, (D) => ({ id: D.activeId, end: (D.branches.find((b) => b.id === D.activeId) || {}).end }))
  await page.reload()
  let back = null
  try {
    await h.settle()
    const after = await dock(page, (D, id) => ({ n: D.branches.length, end: (D.branches.find((b) => b.id === id) || {}).end }), before.id)
    await page.waitForTimeout(800)
    await h.rt(() => __retake.pause())
    await h.seek(tTarget)
    back = await h.rt(readApp)
    const bad = compare(back, expectedAt(live.log, live.off, back.now))
    set("reload", after.end >= before.end - 60 && bad.length === 0, `timeline kept to ${Math.round(after.end)} (was ${Math.round(before.end)}); back at ${Math.round(back.now)}: count ${back.count}, "${back.name}"${bad.length ? "; " + bad.join("; ") : ""}`)
  } catch (e) {
    set("reload", false, e.message.split("\n")[0])
  }
  const errs = [...h.errors, ...consoleMsgs.filter((t) => /\[retake\]/.test(t))]
  return { steps: R, errors: errs.slice(0, 6), hydration: hydration().slice(0, 3) }
}

// ---- main ------------------------------------------------------------------------
function args(argv) {
  const o = { only: null, modes: ["cli", "url"], port: 3360, headed: false, json: null, list: false, keep: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--only") o.only = argv[++i].split(",")
    else if (a === "--modes") o.modes = argv[++i].split(",")
    else if (a === "--port") o.port = Number(argv[++i])
    else if (a === "--headed") o.headed = true
    else if (a === "--json") o.json = argv[++i]
    else if (a === "--list") o.list = true
    else if (a === "--keep") o.keep = true
  }
  return o
}

async function main() {
  const o = args(process.argv.slice(2))
  if (o.list) {
    for (const [k, a] of Object.entries(APPS)) console.log(`${k.padEnd(14)} ${a.label}`)
    return
  }
  const names = o.only || Object.keys(APPS)
  const results = []
  const browser = await chromium.launch({ headless: !o.headed })
  try {
    for (const name of names) {
      let dir
      try {
        dir = appDir(name)
      } catch (e) {
        results.push({ app: name, mode: "-", error: "install failed: " + e.message.split("\n")[0] })
        continue
      }
      for (const [mi, mode] of o.modes.entries()) {
        const base = o.port + mi * 2
        console.error(`[matrix] ${name} (${mode}) on :${base}`)
        let srv = null
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } })
        const page = await ctx.newPage()
        try {
          srv = await start(name, dir, mode, base)
          const r = await scenario(page, name, dir, srv.url, mode)
          results.push({ app: name, mode, ...r })
        } catch (e) {
          results.push({ app: name, mode, error: e.message.split("\n").slice(0, 4).join(" | ") })
          if (srv) for (const p of srv.procs) console.error(`[matrix] ${p.label} output:\n${p.out().slice(-2500)}`)
        } finally {
          await ctx.close()
          if (srv) await srv.stop()
          if (!o.keep) fs.rmSync(path.join(dir, ".retake"), { recursive: true, force: true })
        }
        console.error(`[matrix] ${JSON.stringify(results[results.length - 1])}`)
      }
    }
  } finally {
    await browser.close()
  }
  if (o.json) fs.writeFileSync(o.json, JSON.stringify(results, null, 2))
  // The table.
  const head = ["app", "mode", ...STEPS]
  console.log(`| ${head.join(" | ")} |\n|${head.map(() => "---").join("|")}|`)
  for (const r of results) {
    const cells = STEPS.map((s) => (r.error ? "-" : r.steps[s] ? (r.steps[s].ok ? "pass" : "FAIL") : "-"))
    console.log(`| ${APPS[r.app] ? APPS[r.app].label : r.app} | ${r.mode} | ${cells.join(" | ")} |${r.error ? " " + r.error : ""}`)
  }
  for (const r of results) {
    if (r.error) continue
    const notes = STEPS.filter((s) => r.steps[s] && (r.steps[s].note || !r.steps[s].ok)).map((s) => `${r.steps[s].ok ? "" : "FAIL "}${s}: ${r.steps[s].note}`)
    if (r.errors.length) notes.push("errors: " + r.errors.join(" / "))
    if (notes.length) console.log(`\n${r.app} (${r.mode}):\n  ${notes.join("\n  ")}`)
  }
  const failed = results.some((r) => r.error || STEPS.some((s) => r.steps[s] && !r.steps[s].ok))
  process.exitCode = failed ? 1 : 0
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
