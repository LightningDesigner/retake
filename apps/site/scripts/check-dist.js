// Fails if any Retake code made it into the production build.
import fs from "node:fs"
import path from "node:path"

const dist = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "dist")
const needles = ["__wayback", "__wb", "wb-dock", "data-wayback", "__retake", "/api/reply"]
const hits = []
const walk = (d) => {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f)
    if (fs.statSync(p).isDirectory()) walk(p)
    else {
      const s = fs.readFileSync(p, "utf8")
      for (const n of needles) if (s.includes(n)) hits.push(`${path.relative(dist, p)}: ${n}`)
    }
  }
}
walk(dist)
if (hits.length) { console.error("Retake code found in dist:\n  " + hits.join("\n  ")); process.exit(1) }
console.log("dist is clean: no Retake code.")
