// Playwright config for retake-dev. Two projects:
//   engine: runtime / server / CLI specs (test/engine), owned by S1
//   shell:  dock + timeline UI specs (test/shell), owned by S2
// Dev servers for fixtures are started here. S2 can add more servers for shell
// specs by exporting `servers` (an array of Playwright webServer entries) from
// test/shell/servers.js; it's picked up if it exists.
import fs from "node:fs"
import { defineConfig } from "@playwright/test"
import { SERVERS } from "./test/engine/servers.js"

let shellServers = []
if (fs.existsSync(new URL("./test/shell/servers.js", import.meta.url))) {
  shellServers = (await import("./test/shell/servers.js")).servers || []
}

export default defineConfig({
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { viewport: { width: 1280, height: 800 } },
  projects: [
    { name: "engine", testDir: "test/engine" },
    { name: "shell", testDir: "test/shell" },
  ],
  webServer: [...SERVERS, ...shellServers],
})
