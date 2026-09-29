import { chromium } from "playwright"
const b = await chromium.launch(); const errs = []
for (const [w, h, name] of [[1440, 900, "site"], [390, 844, "site-mobile"]]) {
  const p = await b.newPage({ viewport: { width: w, height: h } })
  p.on("pageerror", (e) => errs.push(e.message))
  await p.goto("file://" + process.cwd() + "/site/index.html"); await p.waitForTimeout(9000)
  await p.screenshot({ path: `test/out/${name}.png` })
  if (name === "site") await p.screenshot({ path: "test/out/site-full.png", fullPage: true })
  console.log(name, "overflow-x:", await p.evaluate(() => document.documentElement.scrollWidth > innerWidth))
}
console.log("errors", errs); await b.close()
