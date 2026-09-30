// Dev-only guarantee: nothing of Retake ends up in a production build.
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { test, expect } from "@playwright/test"
import { FIXTURES } from "./servers.js"

test("vite build with the plugin ships no runtime or dock", () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "retake-build-"))
  const cfg = path.join(FIXTURES, "probe", "vite.retake-build.config.mjs")
  const plugin = new URL("../../src/plugin.js", import.meta.url).href
  fs.writeFileSync(cfg, `import { retake } from ${JSON.stringify(plugin)}\nexport default { plugins: [retake({ codeBranches: true })], build: { outDir: ${JSON.stringify(out)}, emptyOutDir: true }, logLevel: "error" }\n`)
  try {
    const vite = path.resolve(new URL(".", import.meta.url).pathname, "../../node_modules/vite/bin/vite.js")
    execFileSync(process.execPath, [vite, "build", "--config", cfg], { cwd: path.join(FIXTURES, "probe"), stdio: "pipe" })
  } finally {
    fs.rmSync(cfg, { force: true })
  }
  const files = fs.readdirSync(out, { recursive: true }).filter((f) => /\.(js|html|css)$/.test(f))
  expect(files.length).toBeGreaterThan(0)
  for (const f of files) {
    const text = fs.readFileSync(path.join(out, f), "utf8")
    for (const needle of ["__wayback", "wb-dock", "data-wayback", "__wb"]) expect(text, `${f} contains ${needle}`).not.toContain(needle)
  }
})
