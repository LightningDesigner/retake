// The anim-app fixture (test/shell/fixtures/anim-app), served by the spec that
// uses it, and helpers to drive the focused element's row on the track.
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { createServer } from "vite"
import { retake } from "../../src/plugin.js"
import { openDock, dock } from "./helpers.js"

const here = path.dirname(fileURLToPath(import.meta.url))

export async function serveAnimApp(port) {
  const root = path.join(here, "fixtures/anim-app")
  const server = await createServer({
    root,
    configFile: path.join(root, "vite.config.js"),
    logLevel: "silent",
    cacheDir: path.join(os.tmpdir(), `retake-anim-app-vite-${port}`),
    plugins: [retake({ banner: false })],
    server: { port, strictPort: true, host: "localhost" },
  })
  await server.listen()
  return server
}

// Record: the words rise (#go), then the ticker runs (#tick); pause.
export async function recordAnims(page, url) {
  const h = await openDock(page, url)
  await h.record()
  await page.waitForTimeout(300)
  await h.click("#go")
  await page.waitForTimeout(1900)
  await h.click("#tick")
  await page.waitForTimeout(2600)
  await h.pause()
  await page.waitForTimeout(300)
  const tl = await h.rt(() => __retake.timeline())
  const rise = tl.clips.find((c) => c.label === "rise")
  const ticker = tl.clips.find((c) => c.kind === "waapi" && /ticker/.test(c.selector))
  return { h, rise, ticker }
}

// ⌘-click the element at its centre (or at `at`, a fraction of its box): the composer opens.
export async function metaClick(h, sel, at = { x: 0.5, y: 0.5 }) {
  const { page } = h
  const b = await h.box(sel)
  const x = b.x + b.w * at.x
  const y = b.y + b.h * at.y
  await page.keyboard.down("Meta")
  await page.mouse.move(x - 2, y - 2)
  await page.mouse.move(x, y)
  await page.mouse.click(x, y)
  await page.keyboard.up("Meta")
  await page.locator("#wb-note textarea").waitFor({ state: "visible" })
  await page.waitForFunction(() => !!(window.__retakeDock.state.scene && window.__retakeDock.state.scene.focus))
}

// Client point of a recording time on the focused element's row.
export const rowPoint = (page, t, dy = 0.6) =>
  dock(page, (D, a) => {
    const r = document.querySelector(".lines").getBoundingClientRect()
    const x = r.left + 12 + ((a.t - D.view.from) / (D.view.to - D.view.from)) * (r.width - 30)
    const f = D.scene.focus
    return { x, y: r.top + f.y0 + f.h * a.dy }
  }, { t, dy })

// Click a capsule on the closed element row; the clip opens.
export async function openCapsule(h, clipId) {
  const { page } = h
  const p = await dock(page, (D, id) => {
    const r = document.querySelector(".lines").getBoundingClientRect()
    const c = D.scene.focus.capsules.find((x) => x.clip.id === id)
    return c && { x: r.left + Math.max(c.x0 + 3, Math.min((c.x0 + c.x1) / 2, r.width - 40)), y: r.top + c.y }
  }, clipId)
  if (!p) throw new Error(`no capsule for ${clipId}`)
  await page.mouse.click(p.x, p.y)
  await page.waitForFunction(() => window.__retakeDock.state.scene && window.__retakeDock.state.scene.focus && window.__retakeDock.state.scene.focus.open)
  // The view eases to the clip.
  await page.waitForTimeout(500)
}

export const activeStartOf = (page) => dock(page, (D) => D.focus.open.model.timing.activeStart)
