// Picking an element to comment on (⌘ / the Comment tool) on a marketing-style
// page: a sticky header, an svg underline under a word, overlays, a stretched
// card link, an iframe, shadow DOM, things mid-animation. What the dock picks
// must be what is under the pointer and what the highlight showed, and the note
// must describe that element: its clip, its source, a selector that finds it
// again. Port 3339 (the pick-app fixture, served here).
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { test, expect } from "@playwright/test"
import { createServer } from "vite"
import { retake } from "../../src/plugin.js"
import { openDock, dock } from "./helpers.js"

const here = path.dirname(fileURLToPath(import.meta.url))
const PORT = 3339
const URL = `http://localhost:${PORT}/`

let server
test.beforeAll(async () => {
  const root = path.join(here, "fixtures/pick-app")
  server = await createServer({
    root,
    configFile: path.join(root, "vite.config.js"),
    logLevel: "silent",
    cacheDir: path.join(os.tmpdir(), "retake-pick-app-vite"),
    plugins: [retake({ banner: false })],
    server: { port: PORT, strictPort: true, host: "localhost" },
  })
  await server.listen()
})
test.afterAll(async () => {
  await server?.close()
})

// Record: the subtitle fades in (#show), the pill starts wobbling (#go); pause.
async function setup(page, query = "") {
  const h = await openDock(page, URL + query)
  await h.record()
  await page.waitForTimeout(300)
  await h.click("#show")
  await page.waitForTimeout(200)
  await h.click("#go")
  await page.waitForTimeout(900)
  await h.pause()
  await page.waitForTimeout(300)
  return h
}

async function center(h, sel) {
  await h.rt((s) => document.querySelector(s).scrollIntoView({ block: "center" }), sel)
  await h.page.waitForTimeout(200)
  const b = await h.box(sel)
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 }
}

// ⌘ held, pointer moved onto the spot, click: the note's element.
async function noteAt(h, { x, y }, text = "Change this") {
  const { page } = h
  await page.mouse.move(x - 3, y - 3)
  await page.keyboard.down("Meta")
  await page.mouse.move(x, y)
  await page.mouse.click(x, y)
  await page.keyboard.up("Meta")
  const ta = page.locator("#wb-note textarea")
  await expect(ta).toBeVisible()
  await ta.fill(text)
  await ta.press("Enter")
  return dock(page, (D) => D.notes[D.notes.length - 1])
}

// F90: the highlight and the note disagree. ⌘ pressed with the pointer already
// still over an element highlights that element (syncPicking), but the click
// takes the layer list built on the last ⌘ hover, somewhere else.
test("F90: ⌘ pressed over an element and clicked without moving notes that element, not the last ⌘-hovered one", async ({ page }) => {
  const h = await setup(page)
  const nav = await center(h, ".nav-link")
  await page.mouse.move(nav.x - 2, nav.y)
  await page.keyboard.down("Meta")
  await page.mouse.move(nav.x, nav.y)
  await page.keyboard.up("Meta")
  const lede = await h.box("#lede")
  await page.mouse.move(lede.x + 40, lede.y + lede.h / 2)
  await page.keyboard.down("Meta")
  await expect.poll(() => page.evaluate(() => document.querySelector("#wb-hl").dataset.label)).toBe("<p#lede>")
  await page.mouse.down()
  await page.mouse.up()
  await page.keyboard.up("Meta")
  await expect(page.locator("#wb-note .note-meta .el")).toHaveText("<p#lede>")
})

// F91: a note on a still element borrows a clip from anywhere under one of its
// four nearest ancestors: clipFor walks up, and clipAt matches every clip in
// that ancestor's whole subtree (#root holds the page).
test("F91: a note on a still heading or nav link gets no clip from a sibling's or cousin's animation", async ({ page }) => {
  const h = await setup(page)
  const still = await noteAt(h, await center(h, ".still-title"), "Bigger")
  expect(still.el.selector).toMatch(/h4\.still-title$/)
  expect(still.clip).toBeNull() // was the sibling pill's `wobble`
  const nav = await noteAt(h, await center(h, ".nav-link"), "Bolder")
  expect(nav.clip).toBeNull() // was the pill's `wobble`, in another part of the page
})

// F92: an svg inside anything with an id resolves to that ancestor:
// usable() looks for `closest("button, a, …, [id]")`, so the hand-drawn
// underline under one word becomes the whole hero section.
test("F92: a ⌘-click on an svg underline picks the svg (or its path), not the section with an id around it", async ({ page }) => {
  const h = await setup(page)
  const b = await h.box("#hero .underline")
  const n = await noteAt(h, { x: b.x + b.w * 0.5, y: b.y + b.h * 0.45 })
  expect(n.el.selector).not.toBe("#hero")
  expect(n.el.label).toMatch(/svg|path/)
  expect(n.el.rect.h).toBeLessThan(60)
})

// F93: an invisible element on top (opacity 0: a closed menu sheet, something
// faded out) is picked over the visible badge under it.
test("F93: a ⌘-click picks what is visible, not an opacity-0 layer on top of it", async ({ page }) => {
  const h = await setup(page)
  const n = await noteAt(h, await center(h, "#hero .badge"))
  expect(n.el.label).toBe("<span.badge>") // was <div.menu-sheet>
})

// F94: a stretched link (an empty <a> with inset: 0, the usual way to make a
// whole card clickable) is the first layer everywhere on the card, so a click
// on the card's title notes the empty link.
test("F94: a ⌘-click on a card's title picks the title, not the card's transparent stretched link", async ({ page }) => {
  const h = await setup(page)
  const n = await noteAt(h, await center(h, ".card-title"))
  expect(n.el.label).toBe("<h3.card-title>") // was <a.link-overlay>
})

// F95: an element a server component wrote and passed as children into a
// client component (Next's App Router): its own stack is a server frame, so
// sourceOf walks up to the client parent and names the parent's file.
test("F95: a server-written element passed into a client component isn't given the client component's source", async ({ page }) => {
  const h = await setup(page, "?rsc")
  const n = await noteAt(h, await center(h, ".from-server"))
  expect(n.el.components[0]).toBe("Page")
  await page.waitForTimeout(500) // the source map lookup
  const src = await dock(page, (D) => D.notes[D.notes.length - 1].el.source)
  // Its own line once the dev server maps the chunk, else "unknown": never the client wrapper's (/src/main.jsx).
  expect(src).toBeTruthy()
  expect(src.server).toBe(true)
  if (src.file) expect(src.file).not.toMatch(/main\.jsx/)
  else expect(src.confidence).toBe("unknown")
})

// F96: selectors take an element's first two classes, state classes included
// (`go`, Tailwind's `opacity-100`, `in`, `is-open`), so the selector a note or a
// clip carries finds nothing on a fresh load of the page.
test("F96: a note's selector, and its clip's, still find the element on a fresh load", async ({ page, context }) => {
  const h = await setup(page)
  const n = await noteAt(h, await center(h, ".pill"), "Less wobble")
  expect(await h.rt((s) => document.querySelectorAll(s).length, n.el.selector)).toBe(1)
  const fresh = await context.newPage()
  await fresh.goto(URL + "?__wb=app")
  await fresh.waitForSelector(".pill")
  expect(await fresh.evaluate((s) => document.querySelectorAll(s).length, n.el.selector)).toBe(1) // `… > span.pill.go`: 0
  expect(n.clip).toBeTruthy()
  expect(await fresh.evaluate((s) => document.querySelectorAll(s).length, n.clip.selector)).toBe(1)
  await fresh.close()
})

// F97: an <iframe> inside the app (an embed, a demo) has no runtime in it: ⌘
// over it highlights nothing, a ⌘-click makes no note, and the click reaches
// the embedded page while the app is paused.
test("F97: ⌘-click on an embedded iframe notes the iframe, and the paused embed gets no click", async ({ page }) => {
  const h = await setup(page)
  const p = await center(h, "iframe.embed")
  await page.mouse.move(p.x - 140, p.y - 40)
  await page.keyboard.down("Meta")
  await page.mouse.move(p.x - 80, p.y - 25)
  await page.mouse.click(p.x - 80, p.y - 25)
  await page.keyboard.up("Meta")
  expect(await h.rt(() => window.__innerClicks || 0)).toBe(0)
  await expect(page.locator("#wb-note textarea")).toBeVisible()
  await expect(page.locator("#wb-note .note-meta .el")).toHaveText("<iframe.embed>")
})

// F98: in shadow DOM the pick is the host: elementsFromPoint and the event's
// target are retargeted, so the note is about <fancy-card> (an inline box 18px
// tall), not the button inside it that was clicked.
test("F98: a ⌘-click inside an open shadow root notes the element clicked, not the host", async ({ page }) => {
  const h = await setup(page)
  await h.rt(() => document.querySelector("fancy-card").scrollIntoView({ block: "center" }))
  await page.waitForTimeout(200)
  const r = await h.rt(() => {
    const b = document.querySelector("fancy-card").shadowRoot.querySelector("button").getBoundingClientRect()
    return { x: b.x + b.width / 2, y: b.y + b.height / 2, h: b.height }
  })
  const fb = await (await page.$("#wb-stage iframe.live")).boundingBox()
  const n = await noteAt(h, { x: fb.x + r.x, y: fb.y + r.y })
  expect(n.el.label).toMatch(/button/)
  expect(n.el.rect.h).toBeGreaterThanOrEqual(Math.floor(r.h))
})

// F99: a build that swaps in while ⌘ is held turns the Comment mode off (the
// frame it replaces blurs: shell.meta(false)); the highlight goes, and a ⌘-click
// before the pointer moves goes to the paused app: no note. (While a tool is on,
// a build only swaps in when the user is waiting for it: here the preview ends.)
test("F99: ⌘ held while the hidden build swaps in keeps Comment on; the click notes the element", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 }) // the heading clear of the dock at that moment
  const h = await setup(page)
  const s = await h.state()
  await dock(page, (D) => (D.holdSwap = true))
  await page.evaluate((t) => window.__retakeDock.goTo(t), s.start + 400)
  await page.waitForTimeout(600)
  const b = await h.box(".still-title")
  await page.mouse.move(b.x + 10, b.y + 10)
  await page.keyboard.down("Meta")
  await page.mouse.move(b.x + 12, b.y + 10)
  await expect.poll(() => page.evaluate(() => document.querySelectorAll("#wb-stage iframe.building").length)).toBe(1)
  // The preview ended (the moment isn't on screen): the user is waiting for the build.
  await dock(page, (D) => {
    D.PT.endPreview()
    D.holdSwap = false
  })
  await expect.poll(() => page.evaluate(() => document.querySelectorAll("#wb-stage iframe").length)).toBe(1)
  await page.waitForTimeout(300)
  expect(await dock(page, (D) => D.metaHeld)).toBe(true) // was false
  await page.mouse.down()
  await page.mouse.up()
  await page.keyboard.up("Meta")
  await expect(page.locator("#wb-note textarea")).toBeVisible()
  await expect(page.locator("#wb-note .note-meta .el")).toHaveText("<h4.still-title>")
})

// A decorative overlay that takes pointer events (an aria-hidden halo, no
// pointer-events: none) over a headline: the word under the pointer is picked,
// and the halo is still in the list, dimmed, with why it was skipped.
test("a ⌘-click on headline text under an aria-hidden halo picks the word, not the halo", async ({ page }) => {
  const h = await setup(page)
  const p = await center(h, ".headline .word:nth-of-type(2)")
  await page.mouse.move(p.x - 3, p.y)
  await page.keyboard.down("Meta")
  await page.mouse.move(p.x, p.y)
  await expect(page.locator("#wb-layers .layer.on")).toHaveText("span.word")
  await expect(page.locator("#wb-layers .layer.skipped")).toContainText("div.halo · decorative")
  await page.keyboard.up("Meta")
  const n = await noteAt(h, p, "Heavier")
  expect(n.el.label).toBe("<span.word>")
  expect(n.el.text).toBe("faster")
  // Its selector finds that word, and only it.
  expect(await h.rt((s) => [...document.querySelectorAll(s)].map((e) => e.textContent), n.el.selector)).toEqual(["faster"])
  expect(n.el.matches).toBe(1)
})

// In a Next App Router page an element's owners run through Next's layout
// machinery (SegmentViewNode, the layout routers, boundaries): none of that is
// a component the note means.
test("a note in a Next page names the app's components, not Next's internals", async ({ page }) => {
  const h = await setup(page, "?next")
  const n = await noteAt(h, await center(h, ".next-card"))
  expect(n.el.components).toEqual(["PromoCard", "HomePage"])
  expect(n.el.components.join(" ")).not.toMatch(/SegmentViewNode|LayoutRouter|Boundary|ClientPageRoot|RenderFromTemplateContext|ScrollAndFocusHandler/)
})

// F108: a note's pin sits on the spot that was clicked, so a second ⌘-click
// there hit the pin (which opens the first note), not the element: no second
// note. Picking, pins let the click through; a plain click still opens one.
test("F108: a second ⌘-click on a pinned spot makes a second note; a plain click on the pin opens the first", async ({ page }) => {
  const h = await setup(page)
  const p = await center(h, ".still-title")
  const first = await noteAt(h, p, "Bigger")
  await expect(page.locator(`.canvas-pin[data-note="${first.id}"]`)).toBeVisible()
  const second = await noteAt(h, p, "And bolder")
  expect(second.id).not.toBe(first.id)
  expect(second.el.label).toBe("<h4.still-title>")
  expect(await dock(page, (D) => D.notes.length)).toBe(2)
  expect(await dock(page, (D) => D.metaHeld)).toBe(false)
  await page.mouse.click(p.x, p.y)
  await expect(page.locator("#wb-note .note-text")).toHaveText(/Bigger|And bolder/)
})

// What already works, kept working: a plain pick after scrolling, with the
// sticky header over the page, text spans, components and source lines.
test("picks under the pointer after scrolling: a text span, a heading, a nav link in the sticky header", async ({ page }) => {
  const h = await setup(page)
  const span = await noteAt(h, await center(h, "#hero .accent"))
  expect(span.el.label).toBe("<span.accent>")
  expect(await h.rt((s) => document.querySelectorAll(s).length, span.el.selector)).toBe(1)
  const title = await noteAt(h, await center(h, ".still-title"))
  expect(title.el.components[0]).toBe("Status")
  expect(title.el.source && title.el.source.file).toMatch(/^src\/main\.jsx$/)
  // Scrolled down: the sticky header is on top of the page there.
  await h.rt(() => window.scrollTo(0, 500))
  await page.waitForTimeout(200)
  const nb = await h.box(".nav-link")
  const nav = await noteAt(h, { x: nb.x + nb.w / 2, y: nb.y + nb.h / 2 })
  expect(nav.el.label).toBe("<a.nav-link>")
  expect(nav.el.components[0]).toBe("Header")
  expect(h.dockErrors).toEqual([])
})

// ---- what's stacked under the pointer (a real marketing site's story section) ----
// ?story: a drawn underline (svg, pointer-events: none) under a word with a map
// image laid over it; a floating quote with an emphasised word and an underlined
// word; a word that pops in later (opacity 0 until then). See the fixture.

// A point on an element, as fractions of its box.
async function pointIn(h, sel, fx, fy) {
  await h.rt((s) => document.querySelector(s).scrollIntoView({ block: "center" }), sel)
  await h.page.waitForTimeout(200)
  const b = await h.box(sel)
  return { x: b.x + b.w * fx, y: b.y + b.h * fy }
}
// ⌘ held over a point: the layer list there.
async function hoverMeta(h, { x, y }) {
  await h.page.mouse.move(x - 3, y - 3)
  await h.page.keyboard.down("Meta")
  await h.page.mouse.move(x, y)
}
const noteClip = (page) => dock(page, (D) => D.notes[D.notes.length - 1].clip)

// F124: the stroke is under the image (the image is on top, and the svg has
// pointer-events: none): the image was picked, and the stroke wasn't in the list.
test("F124: ⌘-click on a drawn underline under an overlay image picks the animated stroke; the image stays in the list", async ({ page }) => {
  const h = await setup(page, "?story")
  const p = await pointIn(h, ".rough-svg", 0.21, 0.47)
  await hoverMeta(h, p)
  await expect(page.locator("#wb-layers .layer.on")).toContainText("path")
  await expect(page.locator("#wb-layers .layer.on.anim")).toContainText("rough-draw")
  await expect(page.locator("#wb-layers")).toContainText("img.world-map")
  await page.keyboard.up("Meta")
  const n = await noteAt(h, p, "Draw it slower")
  expect(n.el.label).toMatch(/path/)
  expect((await noteClip(page)).label).toBe("rough-draw")
  expect(h.dockErrors).toEqual([])
})

// F125: an underline drawn under an inline word, inside a quote that floats:
// the point is below the word's line box and the svg takes no pointer events,
// so the quote was picked, with the quote's animation.
test("F125: ⌘-click on the underline of an inline word in a floating quote picks its stroke, not the quote", async ({ page }) => {
  const h = await setup(page, "?story")
  const n = await noteAt(h, await pointIn(h, ".ru-svg", 0.23, 0.49), "Thicker")
  expect(n.el.label).toMatch(/path/)
  expect((await noteClip(page)).label).toBe("rough-underline-draw")
})

// An inline <strong> with its own animation inside the floating quote: the
// strong, with its animation (not the quote's).
test("a ⌘-click on an emphasised word in a floating quote picks the word and its own animation", async ({ page }) => {
  const h = await setup(page, "?story")
  const n = await noteAt(h, await center(h, ".quote .em"), "Warmer")
  expect(n.el.label).toBe("<strong.em>")
  expect((await noteClip(page)).label).toBe("em-glow")
})

// F126: a word that pops in later is at opacity 0 at this moment (in its
// delay): the paragraph around it (which has no animation) was picked.
test("F126: ⌘-click where a word will pop in picks that animated word, not its still paragraph", async ({ page }) => {
  const h = await setup(page, "?story")
  const n = await noteAt(h, await center(h, ".pop"), "Pop sooner")
  expect(n.el.label).toBe("<em.pop>")
  expect((await noteClip(page)).label).toBe("pop-in")
})

// F127: the list only moved with the wheel or Tab, and showed four layers:
// after Tab the list stays put, and a click on any of its rows picks that layer.
test("F127: after Tab the layer list stays put and a click on a row notes that layer", async ({ page }) => {
  const h = await setup(page, "?story")
  const p = await pointIn(h, ".rough-svg", 0.21, 0.47)
  await hoverMeta(h, p)
  await page.keyboard.press("Tab")
  const row = page.locator("#wb-layers .layer", { hasText: "img.world-map" })
  await expect(row).toBeVisible()
  const r = await row.boundingBox()
  // On the way there the pointer crosses the page: the list doesn't follow it.
  await page.mouse.move(p.x + 8, p.y + 8)
  await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2, { steps: 8 })
  await expect(row).toBeVisible()
  await row.click()
  await page.keyboard.up("Meta")
  await expect(page.locator("#wb-note .note-meta .el")).toHaveText("<img.world-map>")
})

// F135: a press on a row opens the card, often right under the pointer; the
// press then ends on the card and the click goes to the page, which closed the
// card at once (a quick click, as people click; a slow press kept it).
test("F135: a quick click on a row of the layer list opens the note on that layer and keeps it open", async ({ page }) => {
  const h = await setup(page, "?story")
  const p = await pointIn(h, ".rough-underline", 0.5, 0.4)
  await hoverMeta(h, p)
  const row = page.locator("#wb-layers .layer", { hasText: "blockquote.quote" })
  await expect(row).toBeVisible()
  const r = await row.boundingBox()
  await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2, { steps: 8 })
  await page.mouse.click(r.x + r.width / 2, r.y + r.height / 2)
  await page.keyboard.up("Meta")
  await page.waitForTimeout(200)
  await expect(page.locator("#wb-note")).toBeVisible()
  await expect(page.locator("#wb-note .note-meta .el")).toHaveText("<blockquote.quote>")
  // It's a note like any other: typed into and saved on that layer.
  const ta = page.locator("#wb-note textarea")
  await ta.fill("Float less")
  await ta.press("Enter")
  await expect(page.locator("#wb-note")).toBeHidden()
  expect(await dock(page, (D) => D.notes[D.notes.length - 1].el.label)).toBe("<blockquote.quote>")
  expect(h.dockErrors).toEqual([])
})

// F142: a heading over a map image, one word underlined by a thin stroke that
// draws in (span > svg > g > path, fill none, the svg out of hit testing and
// below the word). ⌘ on the word listed the span (no animation of its own) and
// what's around it, not the moving path. Over the word's middle the path is
// listed and the word stays the pick (as for the hero's underlined word); at
// the stroke, a few px off it, the path is the pick.
test("F142: ⌘ on an underlined word lists its drawing path, marked; near the stroke it's the pick", async ({ page }) => {
  const h = await setup(page, "?story")
  const mid = await pointIn(h, ".sherpa-rough-underline", 0.5, 0.45)
  await hoverMeta(h, mid)
  await expect(page.locator("#wb-layers .layer.anim", { hasText: "path" })).toContainText("sherpa-rough-underline-draw")
  await expect(page.locator("#wb-layers .layer.on")).toContainText("span.sherpa-rough-underline")
  await page.keyboard.up("Meta")
  const path = await h.box(".sherpa-rough-underline path")
  const p = { x: path.x + path.w / 2, y: path.y + path.h / 2 - 4 }
  // ⌘ pressed with the pointer already there (moved there with ⌘ held, it heads for the list, which stays).
  await page.mouse.move(p.x, p.y)
  await page.keyboard.down("Meta")
  const row = page.locator("#wb-layers .layer", { hasText: "path" })
  await expect(row).toHaveCount(1)
  await expect(row).toHaveClass(/anim/)
  await expect(row).toContainText("sherpa-rough-underline-draw")
  await expect(page.locator("#wb-layers .layer.on")).toContainText("path")
  await expect(page.locator("#wb-layers")).toContainText("span.sherpa-rough-underline")
  await expect(page.locator("#wb-layers")).toContainText("img.sherpa-world-map-image")
  await page.keyboard.up("Meta")
  const n = await noteAt(h, p, "Draw it faster")
  expect(n.el.label).toMatch(/path/)
  expect((await noteClip(page)).label).toBe("sherpa-rough-underline-draw")
  expect(h.dockErrors).toEqual([])
})

// F128: on Next 15 with Turbopack a motion library's code is bundled into the
// same chunk as the app's: every frame of the element's own stack maps into the
// library, and the source stayed the chunk's line ("maps into library code").
// The component that rendered it (app/hero.jsx) is where it's written.
test("F128: an element a library rendered, from a Turbopack chunk shared with the app, gets the app's line", async ({ page }) => {
  const h = await setup(page, "?turbo")
  await noteAt(h, await center(h, ".turbo-underline"), "Thinner")
  await expect.poll(() => dock(page, (D) => D.notes[D.notes.length - 1].el.source)).toMatchObject({ file: "app/hero.jsx", line: 11, mapped: true })
  const src = await dock(page, (D) => D.notes[D.notes.length - 1].el.source)
  expect(src.compiled).toBeFalsy()
})

// F136: on a real Next 15.5 app the library has a chunk of its own
// (node_modules_….js) and every element stack ends in a frame from a script
// inline in the page (Retake's runtime): that frame was taken as the source
// (file "", the page's line 269) instead of the app's line.
test("F136: an element a library rendered from its own chunk gets the app's line, not a frame below React's", async ({ page }) => {
  const h = await setup(page, "?turbo")
  await noteAt(h, await center(h, ".turbo-split"), "Thinner")
  await expect.poll(() => dock(page, (D) => D.notes[D.notes.length - 1].el.source)).toMatchObject({ file: "app/hero.jsx", line: 11, mapped: true })
})
