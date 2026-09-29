// End-to-end through the dock: enable, drive the flow, drag back, compare.
import { chromium } from "playwright"
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on("pageerror", (e) => errors.push("pageerror: " + e.message))
page.on("console", (m) => { if (["error", "warning"].includes(m.type())) errors.push(m.text().slice(0, 160)) })
await page.addInitScript(() => { try { localStorage.setItem("wayback:enabled", "true") } catch {} })
await page.goto("http://localhost:3014/demo/chat-storyboard")
await page.waitForTimeout(2500)
const app = () => page.frames().find((f) => f.url().includes("__wb=app"))
const st = () => app().evaluate(() => __wayback.state())
await app().evaluate(() => window.focus())
for (let i = 0; i < 2; i++) { await page.keyboard.press("Space"); await page.waitForTimeout(600); await page.keyboard.press("Space"); await page.waitForTimeout(6000) }
await page.click(".play") // pause
const A = await st()
await page.waitForTimeout(300)
await page.screenshot({ path: "test/out/shell-A.png" })
await page.click(".play") // play on
await page.waitForTimeout(4000)
// drag the scrubber back to A's moment
const r = await page.locator(".track").boundingBox()
const s = await st()
const x = r.x + ((A.now - s.start) / (s.end - s.start)) * r.width
await page.mouse.move(r.x + r.width - 2, r.y + r.height / 2); await page.mouse.down()
await page.mouse.move(x, r.y + r.height / 2, { steps: 6 }); await page.mouse.up()
const t0 = Date.now()
for (let i = 0; i < 100; i++) { await page.waitForTimeout(200); const q = await st().catch(() => null); if (q && !q.seeking && q.now > 0) break }
const B = await st()
console.log("A", Math.round(A.now), "-> back to", Math.round(B.now), "in", Date.now() - t0, "ms; future kept:", B.future)
await page.waitForTimeout(300)
await page.screenshot({ path: "test/out/shell-B.png" })
// new input from here overwrites the future
await app().evaluate(() => window.focus()); await page.keyboard.press("Space"); await page.waitForTimeout(300)
console.log("after input, future:", (await st()).future, "playing:", (await st()).playing)
// switch off
await page.click(".switch"); await page.waitForTimeout(300)
console.log("off:", await st().then((q) => ({ enabled: q.enabled, playing: q.playing })), "dock h", await page.locator("#pt-dock").evaluate((d) => d.offsetHeight), "frame h", await page.locator("#pt-app").evaluate((d) => d.offsetHeight))
console.log("errors", errors)
await browser.close()
