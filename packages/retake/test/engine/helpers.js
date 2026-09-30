// Drives the dock + app frame from Playwright. Works against the runtime API
// (window.__wayback in the app frame) so specs don't depend on dock markup.
// Start every spec from an empty persisted session (the dock restores
// <project>/.retake/session.json on load).
export async function resetSession(request, url) {
  const origin = new URL(url).origin
  const html = await (await request.get(origin + "/")).text()
  const m = html.match(/__WAYBACK_TOKEN = "([0-9a-f]+)"/)
  if (!m) return
  await request.put(origin + "/__wayback/session", { data: { branches: [], activeId: null, markers: [], notes: [] }, headers: { "x-wayback-token": m[1] } })
}

export async function openDock(page, url, { fresh = true } = {}) {
  if (fresh) await resetSession(page.request, url)
  const errors = []
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message))
  await page.goto(url)
  const h = { page, errors }
  h.liveFrame = async () => {
    for (let i = 0; i < 100; i++) {
      const el = await page.$("#wb-stage iframe.live")
      const f = el && (await el.contentFrame())
      if (f) {
        const ok = await f.evaluate(() => !!(window.__wayback && window.__wayback.state)).catch(() => false)
        if (ok) return f
      }
      await page.waitForTimeout(100)
    }
    throw new Error("no live app frame")
  }
  h.rt = async (fn, arg) => (await h.liveFrame()).evaluate(fn, arg)
  h.state = () => h.rt(() => __wayback.state())
  h.settle = async () => {
    for (let i = 0; i < 600; i++) {
      await page.waitForTimeout(100)
      const n = await page.evaluate(() => document.querySelectorAll("#wb-stage iframe").length)
      if (n > 1) continue
      const s = await h.state().catch(() => null)
      if (s && s.booted && !s.seeking && s.target == null) return s
    }
    throw new Error("dock never settled")
  }
  h.record = () => h.rt(() => __wayback.record())
  h.pause = () => h.rt(() => __wayback.pause())
  h.seek = async (t) => {
    await h.rt((t) => __wayback.seek(t), t)
    await page.waitForTimeout(150)
    return h.settle()
  }
  // Real (trusted) mouse click on an element inside the app frame.
  h.click = async (sel) => {
    const f = await h.liveFrame()
    const fb = await (await page.$("#wb-stage iframe.live")).boundingBox()
    const b = await (await f.$(sel)).boundingBox()
    await page.mouse.click(fb.x + b.x + b.width / 2, fb.y + b.y + b.height / 2)
  }
  h.box = async (sel) => {
    const f = await h.liveFrame()
    const fb = await (await page.$("#wb-stage iframe.live")).boundingBox()
    const b = await (await f.$(sel)).boundingBox()
    return { x: fb.x + b.x, y: fb.y + b.y, w: b.width, h: b.height }
  }
  h.log = () => h.rt(() => JSON.parse(JSON.stringify(window.__probe ? window.__probe.log : [])))
  await h.settle()
  return h
}

// Entries of kind k (optionally at or before virtual perf time t).
export const pick = (log, k, t = Infinity) => log.filter((e) => e.k === k && e.vt <= t)
