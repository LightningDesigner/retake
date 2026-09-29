// Branching: go back, act differently, then step back into the first timeline.
import { chromium } from "playwright"
const base = process.argv[2] || "http://localhost:3014/demo/chat-storyboard"
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on("pageerror", (e) => errors.push("pageerror: " + e.message))
await page.addInitScript(() => { try { localStorage.setItem("wayback:enabled", "true") } catch {} })
await page.goto(base)
await page.waitForTimeout(2500)
const app = () => page.frames().find((f) => f.url().includes("__wb=app"))
const st = () => app().evaluate(() => __wayback.state())
const idle = async () => { for (let i = 0; i < 150; i++) { await page.waitForTimeout(200); const q = await st().catch(() => null); if (q && !q.seeking && q.now > 0) return q } }
const lanes = () => page.evaluate(() => [...document.querySelectorAll(".lanes .lane")].map((l) => l.dataset.branch))
await app().evaluate(() => window.focus())
for (let i = 0; i < 2; i++) { await page.keyboard.press("Space"); await page.waitForTimeout(600); await page.keyboard.press("Space"); await page.waitForTimeout(7000) }
const end1 = (await st()).now
// go back to 40% and type something new instead
await page.evaluate(() => {}) 
const r = await page.locator(".track").boundingBox()
await page.mouse.click(r.x + r.width * 0.4, r.y + r.height / 2)
const back = await idle()
console.log("timeline 1 ran to", Math.round(end1), "went back to", Math.round(back.now))
await app().evaluate(() => window.focus())
await app().locator("[data-chat-composer] textarea").fill("")
await app().locator("[data-chat-composer] textarea").click()
await page.keyboard.type("A heist in Goa instead", { delay: 20 })
await page.waitForTimeout(3000)
console.log("after new input: lanes", await lanes(), "future?", (await st()).future)
await page.screenshot({ path: "test/out/branch-2.png" })
// step into Timeline 1 near its end
const lane = await page.locator(".lanes .lane").first().boundingBox()
await page.mouse.click(lane.x + lane.width * 0.95, lane.y + lane.height / 2)
const q = await idle()
console.log("switched: now", Math.round(q.now), "lanes", await lanes())
await page.screenshot({ path: "test/out/branch-1.png" })
console.log("errors", errors)
await browser.close()
