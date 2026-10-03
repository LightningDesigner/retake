// Type checks the package with TypeScript (no emit):
//   1. the regular modules (bin/, src/*.js, src/server/*.js): tsconfig.json
//   2. the runtime (src/runtime/*.js) and the dock (src/shell/*.js): each set is
//      concatenated in the order core.js serves it (one scope per set), into a
//      file in the OS temp dir, and checked against the DOM with the globals in
//      scripts/typecheck/*.d.ts. Errors point back at the source files.
//   3. the public types (types/*.d.ts).
// Exits non-zero on any error. `--keep` leaves the generated files.
import { spawnSync } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"
import { RT_DEFAULTS, setFiles } from "../src/core.js"

const HOME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const TSC = path.join(path.dirname(createRequire(import.meta.url).resolve("typescript/package.json")), "bin", "tsc")
const keep = process.argv.includes("--keep")

const tsc = (project) => {
  const r = spawnSync(process.execPath, [TSC, "-p", project, "--pretty", "false"], { cwd: HOME, encoding: "utf8" })
  if (r.error) throw r.error
  return { ok: r.status === 0, out: (r.stdout || "") + (r.stderr || "") }
}

let failed = false
const report = (name, ok, out) => {
  const errors = out.split("\n").filter((l) => /error TS\d+/.test(l)).length
  console.log(`typecheck ${name}: ${ok ? "ok" : `${errors || "?"} error(s)`}`)
  if (!ok) {
    failed = true
    console.log(out.trim().replace(/^/gm, "  "))
  }
}

// 1. Modules.
{
  const { ok, out } = tsc(path.join(HOME, "tsconfig.json"))
  report("modules", ok, out)
}

// 2. Concatenated sets. Wrapped like core.js wraps them (runtimeSource, shellHtml),
// except that RT is typed as the runtime config rather than one literal setup.
const work = path.join(os.tmpdir(), `retake-typecheck-${crypto.createHash("sha1").update(HOME).digest("hex").slice(0, 10)}`)
fs.rmSync(work, { recursive: true, force: true })
fs.mkdirSync(work, { recursive: true })
const typesFile = JSON.stringify(path.join(HOME, "types", "index.d.ts"))
const SETS = {
  runtime: [
    `;(function () {`,
    `"use strict";`,
    `if (window.__retake) return;`,
    `/** @type {Readonly<Required<import(${typesFile}).RuntimeConfig>>} */`,
    `const RT = Object.freeze(${JSON.stringify(RT_DEFAULTS)});`,
  ],
  shell: [`;(function () {`, `"use strict";`],
}
for (const [set, head] of Object.entries(SETS)) {
  const lines = [...head]
  const map = [] // [first line in the output (1-based), file]
  for (const f of setFiles(set)) {
    if (set === "runtime") lines.push(`// ---- ${f}`)
    map.push([lines.length + 1, f])
    lines.push(...fs.readFileSync(path.join(HOME, "src", set, f), "utf8").split("\n"))
  }
  lines.push(`})();`)
  const out = path.join(work, `${set}.js`)
  fs.writeFileSync(out, lines.join("\n"))
  const config = {
    compilerOptions: {
      target: "es2022",
      lib: ["es2023", "dom", "dom.iterable"],
      types: [],
      allowJs: true,
      checkJs: true,
      noEmit: true,
      // Code that patches the DOM's own classes and globals: strict null checks
      // and implicit any would be noise here (see scripts/typecheck/*.d.ts).
      strict: false,
      skipLibCheck: true,
    },
    files: [out, path.join(HOME, "scripts", "typecheck", `${set}.d.ts`)],
  }
  const project = path.join(work, `tsconfig.${set}.json`)
  fs.writeFileSync(project, JSON.stringify(config, null, 2))
  const { ok, out: text } = tsc(project)
  // runtime.js(120,5): … → src/runtime/10-animations.js(12,5): …
  const where = (line) => {
    let at = null
    for (const m of map) if (m[0] <= line) at = m
    return at ? [`src/${set}/${at[1]}`, line - at[0] + 1] : [`${set}.js (wrapper)`, line]
  }
  const mapped = text.replace(/^(?:.*[\\/])?\w+\.js\((\d+),(\d+)\)/gm, (_, l, c) => {
    const [file, line] = where(Number(l))
    return `${file}(${line},${c})`
  })
  report(set, ok, mapped)
}

// 3. The public types on their own (no skipLibCheck: they're what users get).
{
  const config = {
    compilerOptions: { target: "es2022", module: "nodenext", moduleResolution: "nodenext", lib: ["es2023", "dom"], types: ["node"], typeRoots: [path.join(HOME, "node_modules", "@types")], strict: true, noEmit: true },
    files: [path.join(HOME, "types", "index.d.ts"), path.join(HOME, "types", "client.d.ts")],
  }
  const project = path.join(work, "tsconfig.types.json")
  fs.writeFileSync(project, JSON.stringify(config, null, 2))
  const { ok, out } = tsc(project)
  report("public types", ok, out)
}

if (!keep) fs.rmSync(work, { recursive: true, force: true })
else console.log(`generated files: ${work}`)
process.exit(failed ? 1 : 0)
