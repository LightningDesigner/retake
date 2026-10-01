// End-to-end walk of the "Try it" flow through the real dock, the way a person
// would: use the prototype, drag back to the 150ms heart tap, zoom in, leave a
// note, press +, check the new timeline, switch back. Needs `pnpm dev` running.
//   node scripts/walkthrough.mjs [url] [screens-dir]
import fs from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const retake = path.resolve(here, "../../../packages/retake")
const { chromium } = createRequire(path.join(retake, "package.json"))("@playwright/test")
const { openDock } = await import(path.join(retake, "test/engine/helpers.js"))

const URL = process.argv[2] || "http://localhost:3300/"
const OUT = process.argv[3] || path.resolve(here, "../../../.coord/screens")
fs.mkdirSync(OUT, { recursive: true })

const results = []
const check = (name, ok, detail = "") => {
  results.push({ name, ok: !!ok, detail })
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`)
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
// A hang reports where it stopped instead of running until something kills it.
let stepName = "start"
const step = (name) => { stepName = name; if (process.env.DEBUG) console.log("…", name) }
const watchdog = setTimeout(() => {
  check("walkthrough finished in 3 minutes", false, `stuck at: ${stepName}`)
  fs.writeFileSync(path.join(OUT, "site-walkthrough.json"), JSON.stringify(results, null, 2))
  process.exit(1)
}, 180000)

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const shot = (name) => page.screenshot({ path: path.join(OUT, `site-${name}.png`) })
const dock = (fn, arg) => page.evaluate(`(${fn})(window.__waybackDock.state, ${JSON.stringify(arg ?? null)})`)
// Client x of a time on the timeline, from the dock's own view (as the shell specs do).
const xOf = (t) =>
  page.evaluate((t) => {
    const D = window.__waybackDock.state
    const r = document.querySelector(".lines").getBoundingClientRect()
    return r.left + 12 + ((t - D.view.from) / (D.view.to - D.view.from)) * (r.width - 30)
  }, t)
const laneY = (id) => dock((D, id) => D.lanes.get(id ?? D.activeId).y + document.querySelector(".lines").getBoundingClientRect().top, id)

try {
  step("open dock")
  const h = await openDock(page, URL)
  await h.rt(() => document.getElementById("try").scrollIntoView({ block: "center" }))
  await wait(400)

  step("1 use the prototype")
  // 1. Use the prototype, live.
  await h.click('[data-plan="Studio"]')
  await wait(300)
  await h.click('.card[data-step="0"] [data-next]')
  await wait(900)
  await h.click("#ask")
  const streamed = []
  for (let i = 0; i < 80; i++) {
    const s = await h.rt(() => ({ text: document.querySelector(".msg.bot")?.textContent || "", done: !!document.querySelector(".msg.bot:not(.streaming)") }))
    if (s.text && streamed[streamed.length - 1] !== s.text.length) streamed.push(s.text.length)
    if (s.done) break
    await wait(100)
  }
  check("reply streams in live, not all at once", streamed.length >= 4, `${streamed.length} distinct lengths`)
  const reply = await h.rt(() => document.querySelector(".msg.bot").textContent)
  await wait(300)
  const likeT = (await h.state()).now
  await h.click("#like")
  await wait(600)
  await h.click('.card[data-step="1"] [data-next]')
  await wait(1600)
  const order = await h.rt(() => document.getElementById("p-order").textContent)
  const at = await h.rt(() => document.getElementById("p-at").textContent)
  check("flow reaches step 3 live", /^RT-\d{4}$/.test(order), `${order} at ${at}`)
  await shot("01-live")

  step("2 drag back")
  // 2. Pause, then drag the playhead back to 60ms into the heart tap.
  await page.locator('#wb-dock [data-a="play"]').click()
  await wait(300)
  const s0 = await h.settle()
  const y = await laneY()
  const target = likeT + 60
  await page.mouse.move(await xOf(s0.now), y)
  await page.mouse.down()
  await page.mouse.move(await xOf(s0.now - (s0.now - target) / 2), y, { steps: 6 })
  await page.mouse.move(await xOf(target), y, { steps: 6 })
  await page.mouse.up()
  await wait(300)
  let s1 = await h.settle()
  check("drag back lands near the heart tap", Math.abs(s1.now - target) < 120, `now ${Math.round(s1.now)} vs ${Math.round(target)}`)
  // The dock's view is coarse at full zoom, so nudge to the exact moment.
  if (Math.abs(s1.now - target) > 20) s1 = await h.seek(target)
  const card = await h.rt(() => ({ step: [...document.querySelectorAll(".card")].findIndex((c) => !c.hidden), pop: document.getElementById("like").classList.contains("pop") }))
  check("in the past: back on step 2 with the heart mid-pop", card.step === 1 && card.pop, JSON.stringify(card))
  check("the past is view-only", (await h.rt(() => __wayback.isInteractive())) === false)

  step("3 zoom")
  // 3. Zoom in on the tap with ⌘-scroll over the playhead.
  const spanBefore = await dock((D) => D.view.to - D.view.from)
  await page.mouse.move(await xOf(s1.now), y)
  await page.keyboard.down("Meta")
  for (let i = 0; i < 12; i++) {
    await page.mouse.wheel(0, -60)
    await wait(30)
  }
  await page.keyboard.up("Meta")
  await wait(300)
  const spanAfter = await dock((D) => D.view.to - D.view.from)
  check("⌘-scroll zooms in on the tap", spanAfter < spanBefore / 4, `${Math.round(spanBefore)}ms → ${Math.round(spanAfter)}ms`)
  const clips = await h.rt((t) => __wayback.timeline().clips.filter((c) => c.start <= t + 200 && (c.end ?? Infinity) >= t - 200).map((c) => `${c.kind}:${c.property || c.label}`), s1.now)
  check("the dock has a clip for the tap", clips.length > 0, clips.slice(0, 4).join(", "))
  await shot("02-zoomed-tap")

  step("4 note")
  // 4. ⌘-click the heart and leave a note.
  await page.keyboard.down("Meta")
  const b = await h.box("#like")
  await page.mouse.move(b.x + b.w / 2, b.y + b.h / 2)
  await page.mouse.click(b.x + b.w / 2, b.y + b.h / 2)
  await page.keyboard.up("Meta")
  const ta = page.locator("#wb-note textarea")
  await ta.waitFor({ state: "visible", timeout: 5000 })
  await ta.fill("Pop is over before you see it. Try 220ms with a softer overshoot.")
  await shot("03-note-typing")
  await ta.press("Enter")
  await wait(400)
  const note = await dock((D) => D.notes[D.notes.length - 1])
  check("note saved on the heart, with its moment", note && /like/.test(note.selector || note.el?.selector || "") && Math.abs(note.t - s1.now) < 50, note ? `${note.selector || note.el?.selector} @${Math.round(note.t)} clip=${JSON.stringify(note.clip)}` : "none")
  await shot("04-note-pinned")

  step("5 plus")
  // 5. Press + at this moment: a new, live timeline. The + key works on any
  // dock; older docks also showed a + button on hover over the lane.
  await page.keyboard.press("+")
  for (let i = 0; i < 50 && (await dock((D) => D.branches.length)) < 2; i++) await wait(100)
  const br = await dock((D) => ({ n: D.branches.length, active: D.activeId, forkAt: D.branches[1]?.forkAt }))
  check("+ makes timeline 2 and switches to it", br.n === 2 && br.active === 2, JSON.stringify(br))
  await wait(500)
  // Newer docks leave the new timeline paused at its split; play makes it live.
  if (!(await h.state()).playing) {
    check("+ leaves the new timeline at its own live edge", !(await h.state()).future)
    await page.locator('#wb-dock [data-a="play"]').click()
  }
  await wait(500)
  if (process.env.DEBUG) console.log("after +", JSON.stringify(await h.state().then(({ playing, future, now, end, started, seeking }) => ({ playing, future, now, end, started, seeking }))), await h.rt(() => __wayback.isInteractive()), await page.locator("#wb-shield").isVisible(), await page.locator("#wb-dock .hint, #wb-dock [aria-live]").allTextContents())
  const live = await h.state()
  check("the new timeline is live", live.playing && !live.future && (await h.rt(() => __wayback.isInteractive())), `playing=${live.playing}`)
  // Try something else: skip the like, just continue.
  await h.click('.card[data-step="1"] [data-next]')
  await wait(1600)
  const order2 = await h.rt(() => document.getElementById("p-order")?.textContent)
  check("timeline 2 takes new input", /^RT-\d{4}$/.test(order2) && order2 !== "RT-0000" && order2 !== order, order2)
  await shot("05-new-timeline")

  step("6 switch back")
  // 6. Switch back to timeline 1 by clicking its grey lane, near its end.
  await page.locator('#wb-dock [data-a="play"]').click()
  await wait(300)
  await h.settle()
  await page.keyboard.press("f").catch(() => {})
  await wait(400)
  const end1 = await dock((D) => D.branches.find((b) => b.id === 1).end)
  const y1 = await laneY(1)
  await page.mouse.click((await xOf(end1)) - 4, y1)
  for (let i = 0; i < 80 && (await dock((D) => D.activeId)) !== 1; i++) await wait(100)
  await h.settle()
  check("clicking the grey lane switches back to timeline 1", (await dock((D) => D.activeId)) === 1)
  const back = await h.rt(() => ({ order: document.getElementById("p-order").textContent, at: document.getElementById("p-at").textContent, reply: document.querySelector(".msg.bot")?.textContent || "", liked: document.getElementById("like").getAttribute("aria-pressed") }))
  check("timeline 1 replays the same random order id and Date", back.order === order && back.at === at, `${back.order} ${back.at} (was ${order} ${at})`)
  check("timeline 1 replays the same streamed reply", back.reply === reply, back.reply.slice(0, 40))
  await shot("06-switched-back")

  const errs = [...h.errors]
  check("no page errors", errs.length === 0, errs.slice(0, 3).join(" | "))
} catch (e) {
  check("walkthrough finished", false, e.message.split("\n")[0])
  await shot("99-failure").catch(() => {})
} finally {
  clearTimeout(watchdog)
  await browser.close()
}

fs.writeFileSync(path.join(OUT, "site-walkthrough.json"), JSON.stringify(results, null, 2))
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length ? 1 : 0)
