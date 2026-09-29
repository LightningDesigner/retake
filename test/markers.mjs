import { chromium } from "playwright"
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on("pageerror", (e) => errors.push("pageerror: " + e.message))
await page.addInitScript(() => { try { localStorage.setItem("wayback:enabled", "true") } catch {} })
await page.goto("http://localhost:3014/demo/chat-storyboard")
await page.waitForTimeout(2500)
const app = () => page.frames().find((f) => f.url().includes("__wb=app"))
await app().evaluate(() => window.focus())
for (let i = 0; i < 6; i++) { await page.keyboard.press("Space"); await page.waitForTimeout(600); await page.keyboard.press("Space"); await page.waitForTimeout(9000) }
await page.waitForTimeout(4000)
const ideas = app().getByText("Write episode 1").first()
if (await ideas.count()) { await ideas.click(); await page.waitForTimeout(6000) }
await page.keyboard.press("Alt+KeyM")
const s = await app().evaluate(() => __wayback.state())
console.log("now", Math.round(s.now), "markers", s.markers.map((m) => `${m.label}@${(m.t / 1000).toFixed(1)}s`))
await page.screenshot({ path: "test/out/markers.png" })
console.log("errors", errors)
await browser.close()
