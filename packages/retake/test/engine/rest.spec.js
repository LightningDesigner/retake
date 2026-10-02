// F55: a seek that ends between two recorded frames rests the clock at its
// target, but a timer due before the target (after the last frame) hadn't run
// yet; when time moved on it ran at the target instead of its own moment, so
// an interval drifted by up to a frame (on the Next fixture: a random() log
// stamped 1400 instead of 1390). It runs at its own moment now.
import { test, expect } from "@playwright/test"
import { openDock, pick } from "./helpers.js"
import { PORTS } from "./servers.js"

test("a timer due just before a resting seek's target runs at its own moment when time moves on (F55)", async ({ page }) => {
  const h = await openDock(page, `http://localhost:${PORTS.probe}/`)
  await page.waitForTimeout(2500)
  await h.pause()
  const live = await h.log()
  const frames = await h.rt(() => __retake.history().frames)
  // A tick that ran well before the next frame: rest just before that frame.
  let rest = null
  for (const e of pick(live, "tick")) {
    const due = e.vt - 1000
    const next = frames.find((f) => f > due + 0.5)
    if (next != null && next - due > 3) {
      rest = next - 0.25
      break
    }
  }
  expect(rest).not.toBeNull()
  const end = (await h.state()).end - 5
  await h.seek(rest)
  await h.seek(end)
  const upTo = end + 1000 - 1
  expect(pick(await h.log(), "tick", upTo)).toEqual(pick(live, "tick", upTo))
})
