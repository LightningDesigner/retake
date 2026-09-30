// Fixture dev servers for engine specs (ports 3100-3199 belong to S1).
import path from "node:path"
import { fileURLToPath } from "node:url"
const here = path.dirname(fileURLToPath(import.meta.url))
export const BIN = path.resolve(here, "../../bin/retake.js")
export const FIXTURES = path.resolve(here, "../fixtures")
export const PORTS = { probe: 3110, react: 3111 }
const serve = (name) => ({
  command: `node ${JSON.stringify(BIN)} ${JSON.stringify(path.join(FIXTURES, name))} --port ${PORTS[name]}`,
  url: `http://localhost:${PORTS[name]}/`,
  reuseExistingServer: !process.env.CI,
  stdout: "ignore",
  stderr: "pipe",
  timeout: 60_000,
})
export const SERVERS = [serve("probe"), serve("react")]
