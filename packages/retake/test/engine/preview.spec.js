// F50: the preview forgot media removed from the page, so going back to a
// moment when it was there showed it wherever it had stopped. Each element
// keeps its runs on the virtual clock now. The probe's ?rmbg removes its
// looping background audio at 2s.
import { test, expect } from "@playwright/test"
import { openDock } from "./helpers.js"
import { PORTS } from "./servers.js"
test.use({ launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] } })

test("removed media previews at its time then, like a rebuild (F50)", async ({ page }) => {
  const h = await openDock(page, `http://localhost:${PORTS.probe}/?rmbg`)
  await page.waitForTimeout(3200)
  await h.pause()
  expect(await h.rt(() => !!document.getElementById("bg"))).toBe(false)
  await h.rt(() => __retake.preview(1500))
  await page.waitForTimeout(150)
  const previewed = await h.rt(() => document.getElementById("bg").currentTime)
  await h.rt(() => __retake.endPreview())
  await h.seek(1500)
  await page.waitForTimeout(400) // the rebuilt frame's audio loads in real time
  const rebuilt = await h.rt(() => document.getElementById("bg").currentTime)
  expect(Math.abs(previewed - rebuilt)).toBeLessThan(0.2)
})

// F60: the preview leaves the app's history alone, so the dock's address bar
// showed the route the app was on at the live end. state().route is the app's
// route at the moment previewed, and the address bar follows it.
test("previewing a moment before a client-side navigation: state().route and the address bar show that moment's route (F60)", async ({ page }) => {
  const h = await openDock(page, `http://localhost:${PORTS.probe}/`)
  await page.waitForTimeout(400)
  const t0 = (await h.state()).now
  await page.waitForTimeout(300)
  await h.rt(() => history.pushState({}, "", "/second?x=1"))
  await page.waitForTimeout(400)
  await h.pause()
  await expect.poll(() => new URL(page.url()).pathname).toBe("/second")
  await h.rt((t) => __retake.preview(t), t0)
  expect(await h.rt(() => [__retake.state().route, location.pathname])).toEqual(["/", "/second"])
  await expect.poll(() => new URL(page.url()).pathname).toBe("/")
  await h.rt(() => __retake.endPreview())
  expect(await h.rt(() => __retake.state().route)).toBe(null)
  await expect.poll(() => new URL(page.url()).pathname + new URL(page.url()).search).toBe("/second?x=1")
})

// A subtree taken off the page can still change (Astro's ClientRouter swaps the
// body, then React empties the old body's islands): the preview put the old
// subtree back as it was last seen on the page, i.e. emptied.
test("a subtree changed after it was taken off the page previews as it was then", async ({ page }) => {
  const h = await openDock(page, `http://localhost:${PORTS.probe}/`)
  await h.rt(() => {
    const box = document.createElement("section")
    box.id = "offpage"
    box.innerHTML = "<p id='island'>island content</p>"
    document.body.append(box)
  })
  await page.waitForTimeout(300)
  const t0 = (await h.state()).now
  await page.waitForTimeout(200)
  await h.rt(() => {
    const box = document.getElementById("offpage")
    box.remove()
    // Emptied a while later, off the page (an unmount after a body swap).
    setTimeout(() => (box.querySelector("#island").textContent = ""), 100)
    setTimeout(() => box.replaceChildren(), 200)
  })
  await page.waitForTimeout(500)
  await h.pause()
  for (let i = 0; i < 2; i++) {
    // (Twice: a preview disconnects the observer; the subtree stays watched after it.)
    await h.rt((t) => __retake.preview(t), t0)
    expect(await h.rt(() => document.getElementById("island") && document.getElementById("island").textContent)).toBe("island content")
    await h.rt(() => __retake.endPreview())
    expect(await h.rt(() => !!document.getElementById("offpage"))).toBe(false)
    if (i === 0) {
      await h.rt(() => __retake.play())
      await h.rt(() => {
        const s = document.createElement("section")
        s.id = "offpage2"
        s.innerHTML = "<b>two</b>"
        document.body.append(s)
      })
      await page.waitForTimeout(200)
      const t1 = (await h.state()).now
      await page.waitForTimeout(200)
      await h.rt(() => {
        const s = document.getElementById("offpage2")
        s.remove()
        setTimeout(() => s.replaceChildren(), 100)
      })
      await page.waitForTimeout(400)
      await h.pause()
      await h.rt((t) => __retake.preview(t), t1)
      expect(await h.rt(() => document.getElementById("offpage2") && document.getElementById("offpage2").textContent)).toBe("two")
      await h.rt(() => __retake.endPreview())
    }
  }
})

// F75: a field's value and a checkbox's state are properties, not markup, so the
// MutationObserver never saw them: a preview of a moment before the user typed
// showed what they typed later (the landing page's command menu), until the
// rebuilt frame swapped in with the right text. Typing and the app setting a
// value are logged like DOM changes now.
test("previewing a moment before typing shows the field as it was then, like a rebuild (F75)", async ({ page }) => {
  const h = await openDock(page, `http://localhost:${PORTS.probe}/`)
  const field = () => h.rt(() => [document.getElementById("q").value, document.getElementById("cb").checked])
  await page.waitForTimeout(300)
  const t0 = (await h.state()).now
  await h.click("#q")
  await page.keyboard.type("hello", { delay: 30 })
  await page.waitForTimeout(300)
  const t1 = (await h.state()).now
  await h.click("#cb")
  await h.click("#q")
  await page.keyboard.press("End")
  await page.keyboard.type(" world", { delay: 30 })
  await page.waitForTimeout(300)
  const t2 = (await h.state()).now
  await page.waitForTimeout(100)
  // The app sets it too (a command menu clearing its search).
  await h.rt(() => (document.getElementById("q").value = "set by the app"))
  await page.waitForTimeout(300)
  await h.pause()
  const live = await field()
  expect(live).toEqual(["set by the app", true])
  const shown = []
  for (const t of [t0, t1, t2]) {
    await h.rt((t) => __retake.preview(t), t)
    shown.push(await field())
  }
  expect(shown).toEqual([["", false], ["hello", false], ["hello world", true]])
  await h.rt(() => __retake.endPreview())
  expect(await field()).toEqual(live)
  // The rebuilt moment agrees with its preview.
  await h.seek(t1)
  expect(await field()).toEqual(["hello", false])
})
