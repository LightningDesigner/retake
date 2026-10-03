// Fails unless the Next build ships the dock on every page (run after
// `next build`; `pnpm check:build` does both). For each page in src/site.ts:
//   - the page itself is prerendered, plain (no runtime in it)
//   - its dock (app/retake-dock) is prerendered with the page's title, and
//     loads its frame by Sec-Fetch-Dest (marker "header"), no module scripts
//   - the runtime (app/retake-runtime) is prerendered as one script tag
//   - the proxy's matcher covers the page
// Then it starts `next start` on a free port and asks for each page as a
// top-level load (the dock), as the dock's frame (the page with the runtime
// as its first script), and with ?retake=0 (the plain page). See proxy.ts.
import fs from "node:fs"
import http from "node:http"
import net, { type AddressInfo } from "node:net"
import path from "node:path"
import { spawn } from "node:child_process"
import { createRequire } from "node:module"
import { PAGES, type Page } from "../src/site.ts"

const site = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..")
const out = path.join(site, ".next", "server")
const read = (...p: string[]) => (fs.existsSync(path.join(out, ...p)) ? fs.readFileSync(path.join(out, ...p), "utf8") : "")
const problems: string[] = []
const say = (m: string) => problems.push(m)
// A page's prerendered file: / -> index.html, /try -> try.html.
const file = (name: string, p: Page) => (name === "index" ? "index" : p.path.slice(1))

if (!fs.existsSync(out)) say(".next/server is missing (run next build first)")
const runtime = read("app", "retake-runtime.body")
if (!runtime.startsWith("<script data-retake>")) say("retake-runtime isn't a script tag")
if (!runtime.includes("window.__retake") || !runtime.includes('"marker":"header"')) say("retake-runtime isn't the runtime with the header marker")
// The parts of .next/server/functions-config-manifest.json this reads.
interface FunctionsConfig {
  functions: Record<string, { matchers: Array<{ originalSource: string }> } | undefined>
}
let matchers: string[] = []
try {
  const manifest: FunctionsConfig = JSON.parse(read("functions-config-manifest.json"))
  matchers = manifest.functions["/_middleware"]!.matchers.map((m) => m.originalSource)
} catch {
  say("the build has no proxy (proxy.ts)")
}
for (const [name, p] of Object.entries(PAGES)) {
  const page = read("app", `${file(name, p)}.html`)
  const dock = read("app", "retake-dock", `${name}.body`)
  if (!page) say(`${p.path} wasn't prerendered`)
  else if (page.includes("data-retake")) say(`${p.path}: the page itself has the runtime (the proxy adds it for the dock's frame only)`)
  if (!dock.includes('id="wb-dock"')) say(`${p.path}: no dock (retake-dock/${name})`)
  if (!dock.includes('"marker":"header"')) say(`${p.path}: the dock doesn't load its frame by Sec-Fetch-Dest`)
  if (dock.includes('type="module"')) say(`${p.path}: the dock runs module scripts (it should be only the dock)`)
  if (!dock.includes(`<title>${p.title}</title>`)) say(`${p.path}: the dock doesn't carry the page's title`)
  if (!matchers.includes(p.path)) say(`${p.path}: not in the proxy's matcher`)
}

// The same, served: next start on a free port.
if (!problems.length) {
  // CHECK_BUILD_PORT: a port of your own (agents share this machine); else a free one.
  const port = Number(process.env.CHECK_BUILD_PORT) || await new Promise<number>((resolve) => {
    const s = net.createServer().listen(0, "127.0.0.1", () => {
      const { port } = s.address() as AddressInfo
      s.close(() => resolve(port))
    })
  })
  const next = createRequire(path.join(site, "package.json")).resolve("next/dist/bin/next")
  const child = spawn(process.execPath, [next, "start", "--port", String(port), "--hostname", "127.0.0.1"], { cwd: site, stdio: "ignore", env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" } })
  const base = `http://127.0.0.1:${port}`
  // (node:http: fetch() leaves out Sec-Fetch-* headers, as a browser's fetch would.)
  const get = (p: string, dest?: "document" | "iframe") =>
    new Promise<{ status: number | undefined; text: string }>((resolve, reject) => {
      const headers = dest ? { "sec-fetch-mode": "navigate", "sec-fetch-dest": dest } : {}
      http.get(base + p, { headers }, (res) => {
        let text = ""
        res.setEncoding("utf8")
        res.on("data", (d) => (text += d))
        res.on("end", () => resolve({ status: res.statusCode, text }))
      }).on("error", reject)
    })
  try {
    for (let i = 0; ; i++) {
      try {
        await get("/__retake/session")
        break
      } catch {
        if (i > 100) throw new Error("next start didn't come up")
        await new Promise((r) => setTimeout(r, 100))
      }
    }
    for (const p of Object.values(PAGES)) {
      const top = await get(p.path, "document")
      if (!top.text.includes('id="wb-dock"')) say(`${p.path}: a top-level load doesn't get the dock`)
      const frame = await get(p.path, "iframe")
      const first = frame.text.indexOf("<script")
      if (first < 0 || !frame.text.slice(first, first + 40).includes("data-retake")) say(`${p.path}: the dock's frame doesn't start with the runtime`)
      if (!/<script src="\/_next\/static\//.test(frame.text)) say(`${p.path}: the dock's frame lost the page's own scripts`)
      const plain = await get(p.path + "?retake=0", "document")
      if (plain.text.includes("wb-dock") || plain.text.includes("data-retake")) say(`${p.path}?retake=0 isn't the plain page`)
    }
    if ((await get("/__retake/session")).status !== 404) say("/__retake/session isn't a 404 (the dock would look for a server)")
    if ((await get("/retake-dock/index", "document")).status !== 404) say("/retake-dock/index is reachable directly")
  } catch (e) {
    say(e instanceof Error ? e.message : String(e))
  } finally {
    child.kill()
  }
}

if (problems.length) {
  console.error("the build is missing the dock:\n  " + problems.join("\n  "))
  process.exit(1)
}
console.log(`the build ships the dock on every page: ${Object.values(PAGES).map((p) => p.path).join(", ")} (dock for a top-level load, the page with the runtime in its frame).`)
