// Fixture dev servers for shell specs (ports 3200-3299 belong to S2).
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { BIN } from "../engine/servers.js"
const here = path.dirname(fileURLToPath(import.meta.url))
export const SHELL_PORTS = { dock: 3210, reactNotes: 3211, codeBranches: 3212 }
// --code-branches rewrites files, so it only ever runs on a throwaway copy.
function throwawayCopy(dir) {
  const to = fs.mkdtempSync(path.join(os.tmpdir(), "retake-shell-cb-"))
  fs.cpSync(path.join(here, "fixtures", dir), to, { recursive: true, filter: (p) => !p.includes(".retake") })
  return to
}

const serve = (dir, port, extra = "") => ({
  command: `node ${JSON.stringify(BIN)} ${JSON.stringify(path.isAbsolute(dir) ? dir : path.join(here, "fixtures", dir))} --port ${port}${extra}`,
  url: `http://localhost:${port}/`,
  reuseExistingServer: !process.env.CI,
  stdout: "ignore",
  stderr: "pipe",
  timeout: 60_000,
})
export const servers = [
  serve("dock-app", SHELL_PORTS.dock),
  serve("react-notes", SHELL_PORTS.reactNotes),
  serve(throwawayCopy("dock-app"), SHELL_PORTS.codeBranches, " --code-branches"),
]
