// Shell spec helpers. Drives the dock through its markup and reads its state
// through window.__waybackDock (a test handle, see src/shell/90-handle.js).
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { openDock as openEngineDock } from "../engine/helpers.js"
import { SHELL_PORTS } from "./servers.js"
import { shellHtml } from "../../src/plugin.js"
// openDock, plus `dockErrors`: anything the dock logged as an error. Specs assert it stays empty.
export async function openDock(page, url) {
  const dockErrors = []
  page.on("console", (m) => m.type() === "error" && m.text().includes("[retake]") && dockErrors.push(m.text()))
  const h = await openEngineDock(page, url)
  h.dockErrors = dockErrors
  return h
}

const here = path.dirname(fileURLToPath(import.meta.url))
export const DOCK_URL = `http://localhost:${SHELL_PORTS.dock}/`
export const SCREENS = path.resolve(here, "../../../../.coord/screens")

// The shell's concatenated script, for static checks.
export const shellScript = () => shellHtml().split("<script>").pop().split("</script>")[0]
export const shellCss = () => fs.readFileSync(path.resolve(here, "../../src/shell/shell.css"), "utf8")

export const dockState = (page, fn) => page.evaluate(fn)

// Record a little: click things in the app with real events, with pauses.
export async function recordSome(h, steps = ["#toggle", "#spinner", "#toggle"]) {
  const s = await h.state()
  if (!s.started) await h.record()
  for (const sel of steps) {
    await h.page.waitForTimeout(350)
    await h.click(sel)
  }
  await h.page.waitForTimeout(700)
}

export async function shot(page, name) {
  fs.mkdirSync(SCREENS, { recursive: true })
  await page.screenshot({ path: path.join(SCREENS, name) })
}
