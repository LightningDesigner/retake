// Agent evals for animation notes (by hand, not in `pnpm test`).
//
//   node scripts/anim-evals.mjs setup [--fresh]   write the eval apps to $TMPDIR/retake-anim-evals/<id>/
//   node scripts/anim-evals.mjs note <id>         record the app with Retake, leave the eval's note through the
//                                                 dock (⌘-click, open the clip, click or drag on its row), save
//                                                 what an agent gets (Copy for agent, MCP get_note / get_moment /
//                                                 get_animation) to <id>/payload/, and the values before the edit
//   node scripts/anim-evals.mjs measure <id>      after a coding agent edited <id>/ from the payload alone:
//                                                 record again, sample the same local times, compare
//
// Each app is one Vite page with the Retake plugin on port 3370. Values are
// read through Retake itself: record, pause, then seek to each sample time
// (recording time = the clip's start + its delay + local) and read the
// element's computed transform and opacity in the rebuilt moment.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import { chromium } from "@playwright/test"
import { createServer } from "vite"
import { retake } from "../src/plugin.js"
import { openDock } from "../test/engine/helpers.js"

const here = path.dirname(fileURLToPath(import.meta.url))
const PKG = path.resolve(here, "..")
const ROOT = path.join(os.tmpdir(), "retake-anim-evals")
const PORT = 3370
const URL = `http://localhost:${PORT}/`

const page = (body, { css = "", js = "main.js", title = "Eval" } = {}) => ({
  "index.html": `<!doctype html>
<html><head><meta charset="utf-8"><title>${title}</title><link rel="stylesheet" href="/style.css"></head>
<body>
${body}
<script type="module" src="/${js}"></script>
</body></html>
`,
  "style.css": `body { font: 16px system-ui, sans-serif; margin: 0; padding: 40px; background: #fafafa; }
button { font: inherit; padding: 6px 14px; }
.stage { position: relative; margin-top: 60px; height: 200px; }
${css}`,
})

// The evals. `note` says how the note is left: on the element's own row
// (`point` at a local time, or `range` from–to; `end` = past the clip's end),
// or `after` (a plain ⌘-click after the animation ended). `samples` are local
// times; `check(before, after)` says what must stay and what must change.
const near = (a, b, tol) => Math.abs(a - b) <= tol
const EVALS = {
  e1: {
    title: "frame-level, CSS @keyframes",
    files: page(`<button id="go">Go</button><div class="stage"><div class="card">Card</div></div>`, {
      css: `.card { width: 160px; height: 90px; background: #4f46e5; color: #fff; border-radius: 12px; display: grid; place-items: center; opacity: 0; }
.stage.in .card { animation: rise 1200ms 300ms both; }
@keyframes rise {
  0% { transform: translateY(40px); opacity: 0; animation-timing-function: ease-out; }
  40% { transform: translateY(-8px); opacity: 1; animation-timing-function: ease-in-out; }
  70% { transform: translateY(4px); opacity: 1; }
  100% { transform: translateY(0); opacity: 1; }
}
`,
    }),
    js: `document.querySelector("#go").addEventListener("click", () => document.querySelector(".stage").classList.add("in"))\n`,
    target: ".card",
    delay: 300,
    note: { kind: "point", local: 240 },
    text: "at this point it should already be fully visible (opacity 1); don't change how it moves",
    samples: [0, 60, 120, 180, 240, 300, 360, 420, 480, 600, 720, 840, 960, 1080, 1190],
    check(b, a) {
      const out = []
      for (let i = 0; i < b.length; i++) {
        const L = b[i].local
        out.push({ L, what: "ty same", ok: near(a[i].ty, b[i].ty, 1) })
        if (L >= 480 || L === 0) out.push({ L, what: "opacity same (outside the segment)", ok: near(a[i].opacity, b[i].opacity, 0.01) })
        if (L === 240) out.push({ L, what: "opacity 1 at 240ms", ok: near(a[i].opacity, 1, 0.02) })
      }
      return out
    },
  },
  e2: {
    title: "range 200–400ms of a 500ms CSS animation (hold)",
    files: page(`<button id="go">Go</button><div class="stage"><div class="bar"></div></div>`, {
      css: `.bar { width: 80px; height: 40px; background: #059669; border-radius: 8px; }
.bar.go { animation: slide 500ms ease-in-out both; }
@keyframes slide {
  from { transform: translateX(0); }
  to { transform: translateX(250px); }
}
`,
    }),
    js: `document.querySelector("#go").addEventListener("click", () => document.querySelector(".bar").classList.add("go"))\n`,
    target: ".bar",
    delay: 0,
    note: { kind: "range", from: 200, to: 400 },
    text: "between 200 and 400 ms it should stay still where it is at 200ms; from 400ms on, exactly as now",
    samples: [0, 50, 100, 150, 190, 200, 250, 300, 350, 390, 420, 450, 490],
    check(b, a) {
      const at200 = b.find((x) => x.local === 200).tx
      return b.map((x, i) => {
        const L = x.local
        if (L > 200 && L < 400) return { L, what: `tx held at ${at200.toFixed(1)}`, ok: near(a[i].tx, at200, 1.5) }
        return { L, what: "tx same (outside)", ok: near(a[i].tx, x.tx, 1) }
      })
    },
  },
  e3: {
    title: "hold then fade out (element.animate)",
    files: page(`<button id="go">Show toast</button><div class="stage"><div class="toast">Saved</div></div>`, {
      css: `.toast { width: 200px; padding: 14px; background: #111; color: #fff; border-radius: 10px; opacity: 0; }\n`,
    }),
    js: `document.querySelector("#go").addEventListener("click", () => {
  document.querySelector(".toast").animate(
    [
      { opacity: 0, transform: "translateY(12px)" },
      { offset: 0.15, opacity: 1, transform: "translateY(0px)" },
      { opacity: 1, transform: "translateY(0px)" },
    ],
    { duration: 2000, easing: "linear", fill: "forwards" },
  )
})
`,
    target: ".toast",
    delay: 0,
    note: { kind: "range", from: 1200, to: "end" },
    text: "hold it until here, then fade it out to 0 by the end",
    samples: [0, 100, 200, 300, 600, 900, 1100, 1200, 1400, 1600, 1800, 1990],
    check(b, a) {
      const out = []
      for (let i = 0; i < b.length; i++) {
        const L = b[i].local
        out.push({ L, what: "ty same", ok: near(a[i].ty, b[i].ty, 1) })
        if (L <= 1200) out.push({ L, what: "opacity same (before the range)", ok: near(a[i].opacity, b[i].opacity, 0.01) })
      }
      const op = (L) => a[b.findIndex((x) => x.local === L)].opacity
      out.push({ L: 1400, what: "fading: 1400 < 1200", ok: op(1400) < op(1200) - 0.05 })
      out.push({ L: 1600, what: "fading: 1600 < 1400", ok: op(1600) < op(1400) - 0.05 })
      out.push({ L: 1990, what: "near 0 at the end", ok: op(1990) <= 0.05 })
      return out
    },
  },
  e4: {
    title: "coordinates: end 20px further left",
    files: page(`<button id="go">Go</button><div class="stage"><div class="puck"></div></div>`, {
      css: `.puck { width: 48px; height: 48px; background: #db2777; border-radius: 50%; }
.puck.go { animation: push 800ms ease-in-out both; }
@keyframes push {
  from { transform: translateX(0); }
  to { transform: translateX(300px); }
}
`,
    }),
    js: `document.querySelector("#go").addEventListener("click", () => document.querySelector(".puck").classList.add("go"))\n`,
    target: ".puck",
    delay: 0,
    note: { kind: "after", local: 1100 },
    text: "it should end 20px further left",
    samples: [0, 200, 400, 600, 790, 1000],
    check(b, a) {
      const out = []
      for (let i = 0; i < b.length; i++) out.push({ L: b[i].local, what: "ty same", ok: near(a[i].ty, b[i].ty, 0.5) })
      out.push({ L: 0, what: "starts where it did", ok: near(a[0].tx, b[0].tx, 1) })
      out.push({ L: 1000, what: "ends 20px further left", ok: near(a[5].tx, b[5].tx - 20, 1) })
      out.push({ L: 790, what: "still ends at 800ms (duration kept)", ok: near(a[4].tx, b[4].tx - 20, 2.5) })
      return out
    },
  },
  e5: {
    title: "CSS transition: cut the tail from 300ms",
    files: page(`<button id="go">Go</button><div class="stage"><a class="cta" href="#">Get started</a></div>`, {
      css: `.cta { display: inline-block; padding: 12px 22px; background: #2563eb; color: #fff; border-radius: 999px; text-decoration: none;
  transform: translateY(24px); opacity: 0; transition: transform 400ms ease-out, opacity 400ms ease-out; }
.cta.in { transform: none; opacity: 1; }
`,
    }),
    js: `document.querySelector("#go").addEventListener("click", () => document.querySelector(".cta").classList.add("in"))\n`,
    target: ".cta",
    clip: (c) => c.kind === "transition" && c.property === "transform",
    delay: 0,
    note: { kind: "range", from: 300, to: "end" },
    text: "from here on it should already be at its final position (no slow tail); before this, exactly as now",
    samples: [0, 50, 100, 150, 200, 250, 290, 310, 340, 370, 395],
    check(b, a) {
      const out = []
      for (let i = 0; i < b.length; i++) {
        const L = b[i].local
        out.push({ L, what: "opacity same (not this note's)", ok: near(a[i].opacity, b[i].opacity, 0.01) })
        if (L < 300) out.push({ L, what: "ty same (before 300ms)", ok: near(a[i].ty, b[i].ty, 0.5) })
        else out.push({ L, what: "ty at the final 0", ok: near(a[i].ty, 0, 0.3) })
      }
      return out
    },
  },
  e6: {
    title: "element.animate() with effect easing: a hop over 600–900ms",
    files: page(`<button id="go">Go</button><div class="stage"><div class="ticker"></div></div>`, {
      css: `.ticker { width: 60px; height: 60px; background: #f59e0b; border-radius: 10px; }\n`,
    }),
    js: `document.querySelector("#go").addEventListener("click", () => {
  document.querySelector(".ticker").animate(
    [
      { offset: 0, transform: "translateX(0px)" },
      { offset: 0.3, transform: "translateX(300px)" },
      { offset: 0.6, transform: "translateX(300px) rotate(0deg)" },
      { offset: 1, transform: "translateX(0px) rotate(90deg)" },
    ],
    { duration: 2000, delay: 200, easing: "ease-in-out", fill: "none" },
  )
})
`,
    target: ".ticker",
    delay: 200,
    note: { kind: "range", from: 600, to: 900 },
    text: "between 600 and 900 ms add a small hop: 30px up and back down by 900ms; everything else as it is",
    samples: [0, 200, 400, 500, 590, 600, 675, 750, 825, 900, 910, 1000, 1200, 1500, 1800, 1990],
    check(b, a) {
      const out = []
      for (let i = 0; i < b.length; i++) {
        const L = b[i].local
        if (L <= 600 || L >= 900) out.push({ L, what: "transform same (outside)", ok: near(a[i].tx, b[i].tx, 1) && near(a[i].ty, b[i].ty, 1) && near(a[i].rot, b[i].rot, 0.5) })
        else out.push({ L, what: "tx and rotation same inside", ok: near(a[i].tx, b[i].tx, 1) && near(a[i].rot, b[i].rot, 0.5) })
      }
      const ty = (L) => a[b.findIndex((x) => x.local === L)].ty
      out.push({ L: 750, what: "about 30px up in the middle", ok: near(Math.min(ty(675), ty(750), ty(825)), -30, 4) })
      return out
    },
  },
  e7: {
    title: "Motion keyframes (x with times): a rise over 360–720ms",
    files: page(`<div id="root"></div>`, { css: `.dot { width: 44px; height: 44px; border-radius: 50%; background: #7c3aed; margin-top: 60px; }\n`, js: "main.jsx" }),
    jsName: "main.jsx",
    js: `import { useState } from "react"
import { createRoot } from "react-dom/client"
import { motion } from "framer-motion"

function App() {
  const [go, setGo] = useState(false)
  return (
    <div>
      <button id="go" onClick={() => setGo(true)}>Go</button>
      <motion.div
        className="dot"
        initial={{ x: 0 }}
        animate={go ? { x: [0, 120, 120, 240] } : { x: 0 }}
        transition={{ duration: 1.2, times: [0, 0.3, 0.6, 1], ease: "easeInOut" }}
      />
    </div>
  )
}

createRoot(document.getElementById("root")).render(<App />)
`,
    target: ".dot",
    delay: 0,
    motion: true,
    // Motion writes nothing at local 0: the first recorded write is a frame or so in. Its x says how far
    // (x goes 0 → 120 over the first 360ms, easeInOut), so every run is sampled on the same clock.
    lead(clip) {
      const m = /translateX\((-?[\d.]+)px\)/.exec((clip.first && clip.first.transform) || "")
      if (!m) return 0
      const ease = (x) => { let lo = 0, hi = 1; for (let i = 0; i < 40; i++) { const t = (lo + hi) / 2, bx = 3 * 0.42 * (1 - t) * (1 - t) * t + 3 * 0.58 * (1 - t) * t * t + t * t * t; bx < x ? (lo = t) : (hi = t) } const t = (lo + hi) / 2; return 3 * (1 - t) * t * t + t * t * t }
      let lo = 0, hi = 1
      for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; ease(mid) * 120 < Number(m[1]) ? (lo = mid) : (hi = mid) }
      return ((lo + hi) / 2) * 360
    },
    note: { kind: "range", from: 360, to: 720 },
    text: "between 360 and 720 ms it should rise 20px and come back down by 720ms; x stays as it is",
    samples: [0, 120, 240, 350, 420, 480, 540, 600, 660, 740, 840, 960, 1080],
    check(b, a) {
      const out = []
      for (let i = 0; i < b.length; i++) {
        const L = b[i].local
        out.push({ L, what: "x same", ok: near(a[i].tx, b[i].tx, 2) })
        if (L < 360 || L > 720) out.push({ L, what: "y same (outside)", ok: near(a[i].ty, b[i].ty, 1) })
      }
      const ty = (L) => a[b.findIndex((x) => x.local === L)].ty
      out.push({ L: 540, what: "about 20px up in the middle", ok: near(Math.min(ty(480), ty(540), ty(600)), -20, 3) })
      return out
    },
  },
}

function setup(fresh) {
  fs.mkdirSync(ROOT, { recursive: true })
  for (const [id, e] of Object.entries(EVALS)) {
    const dir = path.join(ROOT, id)
    if (fs.existsSync(dir) && !fresh) continue
    fs.rmSync(dir, { recursive: true, force: true })
    fs.mkdirSync(dir, { recursive: true })
    for (const [f, body] of Object.entries(e.files)) fs.writeFileSync(path.join(dir, f), body)
    fs.writeFileSync(path.join(dir, e.jsName || "main.js"), e.js)
    // React and framer-motion come from the package's own devDependencies.
    if (e.motion) fs.symlinkSync(path.join(PKG, "node_modules"), path.join(dir, "node_modules"))
    console.log("wrote", dir)
  }
}

async function serve(dir) {
  const server = await createServer({
    root: dir,
    configFile: false,
    logLevel: "silent",
    cacheDir: path.join(os.tmpdir(), `retake-anim-evals-vite-${path.basename(dir)}`),
    esbuild: { jsx: "automatic" },
    plugins: [retake({ banner: false })],
    server: { port: PORT, strictPort: true, host: "localhost" },
  })
  await server.listen()
  return server
}

// Record: click the trigger, wait it out, pause. Returns the target's clip.
async function recordOnce(h, e) {
  await h.record()
  await h.page.waitForTimeout(400)
  await h.click("#go")
  await h.page.waitForTimeout(2600)
  await h.pause()
  await h.page.waitForTimeout(400)
  const tl = await h.rt(() => __retake.timeline())
  const cls = e.target.replace(/^\./, "")
  const mine = tl.clips.filter((c) => new RegExp(`\\.${cls}\\b`).test(c.selector || "") && (!e.clip || e.clip(c))).sort((x, y) => x.start - y.start)
  if (!mine.length) throw new Error(`no clip on ${e.target}: ${JSON.stringify(tl.clips.map((c) => [c.kind, c.selector, c.label]))}`)
  return { clip: mine[0], clips: mine }
}

// The target's transform (taken apart) and opacity at each local time, read after a seek.
async function sample(h, e, clip) {
  const out = []
  const lead = e.lead ? e.lead(clip) : 0
  for (const local of e.samples) {
    const T = clip.start - lead + e.delay + local
    await h.seek(T)
    const v = await h.rt((sel) => {
      const el = document.querySelector(sel)
      const cs = getComputedStyle(el)
      const m = cs.transform && cs.transform !== "none" ? new DOMMatrix(cs.transform) : new DOMMatrix()
      return { tx: m.e, ty: m.f, rot: (Math.atan2(m.b, m.a) * 180) / Math.PI, opacity: Number(cs.opacity) }
    }, e.target)
    out.push({ local, ...v })
  }
  return out
}

function mcp(url) {
  const child = spawn(process.execPath, [path.join(PKG, "bin/retake.js"), "mcp", "--url", url], { stdio: ["pipe", "pipe", "pipe"] })
  let buf = ""
  const waiting = new Map()
  child.stdout.setEncoding("utf8")
  child.stdout.on("data", (d) => {
    buf += d
    let i
    while ((i = buf.indexOf("\n")) >= 0) {
      const msg = JSON.parse(buf.slice(0, i))
      buf = buf.slice(i + 1)
      waiting.get(msg.id)?.(msg)
    }
  })
  let seq = 0
  const rpc = (method, params) =>
    new Promise((resolve) => {
      const id = ++seq
      waiting.set(id, resolve)
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n")
    })
  const tool = async (name, args = {}) => (await rpc("tools/call", { name, arguments: args })).result.content[0].text
  return { rpc, tool, close: () => child.kill() }
}

const dockEval = (pg, fn, arg) => pg.evaluate(`(${fn})(window.__retakeDock.state, ${JSON.stringify(arg ?? null)})`)
// Client point of a recording time on the focused element's row.
const rowPoint = (pg, t) =>
  dockEval(pg, (D, t) => {
    const r = document.querySelector(".lines").getBoundingClientRect()
    const f = D.scene.focus
    return { x: r.left + 12 + ((t - D.view.from) / (D.view.to - D.view.from)) * (r.width - 30), y: r.top + f.y0 + f.h * 0.6 }
  }, t)

async function metaClick(h, sel) {
  const pg = h.page
  const b = await h.box(sel)
  const x = b.x + b.w / 2
  const y = b.y + b.h / 2
  await pg.keyboard.down("Meta")
  await pg.mouse.move(x - 2, y - 2)
  await pg.mouse.move(x, y)
  await pg.mouse.click(x, y)
  await pg.keyboard.up("Meta")
  await pg.locator("#wb-note textarea").waitFor({ state: "visible" })
}

async function leaveNote(h, e, clip) {
  const pg = h.page
  const a0 = clip.start + e.delay
  if (e.note.kind === "after") await h.seek(a0 + e.note.local)
  else await h.seek(a0 + (e.note.local != null ? e.note.local : e.note.from) + 5)
  await metaClick(h, e.target)
  if (e.note.kind !== "after") {
    // Open the clip: its capsule on the element's row.
    await pg.waitForFunction(() => window.__retakeDock.state.scene && window.__retakeDock.state.scene.focus)
    const p = await dockEval(pg, (D, id) => {
      const r = document.querySelector(".lines").getBoundingClientRect()
      const c = D.scene.focus.capsules.find((x) => x.clip.id === id)
      return c && { x: r.left + Math.max(c.x0 + 3, Math.min((c.x0 + c.x1) / 2, r.width - 40)), y: r.top + c.y }
    }, clip.id)
    if (!p) throw new Error("no capsule for the clip on the element's row")
    await pg.mouse.click(p.x, p.y)
    await pg.waitForFunction(() => window.__retakeDock.state.scene.focus && window.__retakeDock.state.scene.focus.open)
    await pg.waitForTimeout(700)
    const as = await dockEval(pg, (D) => D.focus.open.model.timing.activeStart)
    if (e.note.kind === "point") {
      const q = await rowPoint(pg, as + e.note.local)
      await pg.mouse.click(q.x, q.y)
    } else {
      const q0 = await rowPoint(pg, as + e.note.from)
      const endT = e.note.to === "end" ? (await dockEval(pg, (D) => D.focus.open.clip.end)) + 60 : as + e.note.to
      const q1 = await rowPoint(pg, endT)
      await pg.mouse.move(q0.x, q0.y)
      await pg.mouse.down()
      await pg.mouse.move((q0.x + q1.x) / 2, q0.y, { steps: 5 })
      await pg.mouse.move(q1.x, q1.y, { steps: 5 })
      await pg.mouse.up()
    }
    await pg.waitForTimeout(600)
  }
  const at = await pg.locator("#wb-note .note-at").textContent().catch(() => "")
  const ta = pg.locator("#wb-note textarea")
  await ta.fill(e.text)
  await pg.waitForTimeout(200)
  await ta.press("Enter")
  await pg.locator("#wb-note").waitFor({ state: "hidden" })
  return at
}

async function withDock(id, fn) {
  const e = EVALS[id]
  if (!e) throw new Error(`no eval ${id}`)
  const dir = path.join(ROOT, id)
  const server = await serve(dir)
  const browser = await chromium.launch()
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ["clipboard-read", "clipboard-write"] })
    const pg = await ctx.newPage()
    pg.on("console", (m) => m.type() === "error" && /retake/.test(m.text()) && console.log("[dock error]", m.text()))
    pg.on("pageerror", (err) => console.log("[page error]", err.message))
    const h = await openDock(pg, URL)
    return await fn(h, e, dir)
  } finally {
    await browser.close()
    await server.close()
  }
}

async function note(id) {
  await withDock(id, async (h, e, dir) => {
    const pg = h.page
    const { clip } = await recordOnce(h, e)
    const before = await sample(h, e, clip)
    const composer = await leaveNote(h, e, clip)
    // Copy for agent, through the note's pin and its button.
    await pg.waitForTimeout(500)
    await pg.locator("#wb-pins .canvas-pin").last().click()
    await pg.locator('#wb-note [data-note-a="copy"]').click()
    const copied = await pg.evaluate(() => navigator.clipboard.readText())
    // The session reaches the server; then what `retake mcp` says.
    const m = mcp(URL.replace(/\/$/, ""))
    let list = ""
    for (let i = 0; i < 40; i++) {
      list = await m.tool("list_notes")
      if (/"count":\s*[1-9]/.test(list)) break
      await pg.waitForTimeout(250)
    }
    const nid = JSON.parse(list).notes[0].id
    const getNote = await m.tool("get_note", { id: nid })
    const getMoment = await m.tool("get_moment", { id: nid })
    const getAnim = await m.tool("get_animation", { id: nid })
    m.close()
    const out = path.join(dir, "payload")
    fs.mkdirSync(out, { recursive: true })
    fs.writeFileSync(path.join(out, "copy-for-agent.txt"), copied)
    fs.writeFileSync(path.join(out, "get_note.txt"), getNote)
    fs.writeFileSync(path.join(out, "get_moment.txt"), getMoment)
    fs.writeFileSync(path.join(out, "get_animation.txt"), getAnim)
    fs.writeFileSync(path.join(ROOT, `${id}.before.json`), JSON.stringify({ composer, clip: { id: clip.id, start: clip.start, kind: clip.kind }, before }, null, 2))
    console.log(`${id}: composer "${composer}"`)
    console.log(copied)
    console.log("before:", JSON.stringify(before.map((x) => [x.local, +x.tx.toFixed(1), +x.ty.toFixed(1), +x.rot.toFixed(1), +x.opacity.toFixed(3)])))
  })
}

async function measure(id) {
  const prev = JSON.parse(fs.readFileSync(path.join(ROOT, `${id}.before.json`), "utf8"))
  await withDock(id, async (h, e) => {
    const { clip, clips } = await recordOnce(h, e)
    const after = await sample(h, e, clip)
    const rows = e.check(prev.before, after)
    const bad = rows.filter((r) => !r.ok)
    console.log(`${id} (${e.title}): clips now ${clips.map((c) => `${c.kind}:${c.label || c.property || ""}`).join(", ")}`)
    console.log("before:", JSON.stringify(prev.before.map((x) => [x.local, +x.tx.toFixed(1), +x.ty.toFixed(1), +x.rot.toFixed(1), +x.opacity.toFixed(3)])))
    console.log("after: ", JSON.stringify(after.map((x) => [x.local, +x.tx.toFixed(1), +x.ty.toFixed(1), +x.rot.toFixed(1), +x.opacity.toFixed(3)])))
    for (const r of bad) console.log(`  FAIL at ${r.L}ms: ${r.what}`)
    console.log(`${id}: ${bad.length ? "FAIL" : "PASS"} (${rows.length - bad.length}/${rows.length} checks)`)
    fs.writeFileSync(path.join(ROOT, `${id}.after.json`), JSON.stringify({ after, rows }, null, 2))
  })
}

const [cmd, id] = process.argv.slice(2)
if (cmd === "setup") setup(process.argv.includes("--fresh"))
else if (cmd === "note") await note(id)
else if (cmd === "measure") await measure(id)
else console.log("usage: node scripts/anim-evals.mjs setup [--fresh] | note <id> | measure <id>")
