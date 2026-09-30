// Fixture dev servers for shell specs (ports 3200-3299 belong to S2).
import path from "node:path"
import { fileURLToPath } from "node:url"
import { BIN } from "../engine/servers.js"
const here = path.dirname(fileURLToPath(import.meta.url))
export const SHELL_PORTS = { dock: 3210, reactNotes: 3211 }
const serve = (dir, port) => ({
  command: `node ${JSON.stringify(BIN)} ${JSON.stringify(path.join(here, "fixtures", dir))} --port ${port}`,
  url: `http://localhost:${port}/`,
  reuseExistingServer: !process.env.CI,
  stdout: "ignore",
  stderr: "pipe",
  timeout: 60_000,
})
export const servers = [serve("dock-app", SHELL_PORTS.dock)]
