// F51: replay targets were child-index paths from <html>, so anything a script
// adds in real time (a cookie banner) shifted them, and the replay clicked
// nothing ("replay target missing"). Paths now start at the nearest id and
// count elements only. The probe's ?banner: a third-party script (quick live,
// slow on a rebuild) adds a banner before the app's toast does, live only.
import { test, expect } from "@playwright/test"
import { openDock, pick } from "./helpers.js"
import { PORTS } from "./servers.js"

test("a click after content a script added in real time replays on its element (F51)", async ({ page }) => {
  const warnings = []
  page.on("console", (m) => m.type() === "warning" && warnings.push(m.text()))
  const run = Math.random().toString(36).slice(2)
  const h = await openDock(page, `http://localhost:${PORTS.probe}/?banner=${run}`)
  await expect.poll(() => h.rt(() => !!document.querySelector("#toast")), { timeout: 5000 }).toBe(true)
  expect(await h.rt(() => document.getElementById("toast").previousElementSibling.id)).toBe("banner")
  await h.click("#toast button")
  await page.waitForTimeout(300)
  await h.pause()
  expect(pick(await h.log(), "toast")).toHaveLength(1)
  expect(await h.rt(() => __retake.history().pathV)).toBe(2)
  const T = (await h.state()).now
  await h.seek(T - 10)
  // Rebuilt before the (now slow) banner script came back: the toast is where the banner was.
  expect(await h.rt(() => !!document.getElementById("banner"))).toBe(false)
  expect(pick(await h.log(), "toast")).toHaveLength(1)
  expect(warnings.filter((w) => w.includes("target missing"))).toEqual([])
})

test("recordings made before paths started at ids still replay (pathV 1)", async ({ page }) => {
  const h = await openDock(page, `http://localhost:${PORTS.probe}/`)
  await page.waitForTimeout(300)
  await h.click("#go")
  await page.waitForTimeout(500)
  await h.pause()
  const live = await h.log()
  // The same recording as an older runtime made it: index paths from <html>, no pathV.
  const old = await h.rt(() => {
    // (The in-memory recording: JSON.stringify would pack its paths into a table.)
    const h = __retake.history()
    const r = { ...h, events: h.events.map((e) => ({ ...e })), clips: (h.clips || []).map((c) => ({ ...c })) }
    const SKIP = /^(SCRIPT|STYLE|LINK|NOSCRIPT|TEMPLATE)$/
    const v2 = (path) => {
      let n = document.documentElement
      let i = 0
      if (typeof path[0] === "string") (n = document.getElementById(path[0].slice(1))), (i = 1)
      for (; i < path.length && n; i++) n = path[i] < 0 ? n.childNodes[-1 - path[i]] : [...n.children].filter((c) => !SKIP.test(c.tagName))[path[i]]
      return n
    }
    const v1 = (el) => {
      const p = []
      for (let n = el; n && n !== document.documentElement; n = n.parentNode) p.unshift([...n.parentNode.childNodes].indexOf(n))
      return p
    }
    delete r.pathV
    for (const ev of r.events) for (const k of ["path", "related"]) if (Array.isArray(ev[k])) ev[k] = v1(v2(ev[k]))
    for (const c of r.clips) if (Array.isArray(c.path)) c.path = v1(v2(c.path))
    return JSON.stringify(r)
  })
  expect(JSON.parse(old).events.some((e) => Array.isArray(e.path) && typeof e.path[0] === "string")).toBe(false)
  await h.rt(({ json }) => __retake.load(json, JSON.parse(json).end - 5), { json: old })
  await page.waitForTimeout(300)
  await h.settle()
  expect(pick(await h.log(), "click-random")).toEqual(pick(live, "click-random"))
})
