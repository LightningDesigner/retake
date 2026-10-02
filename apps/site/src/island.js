// The island: click to morph through four states (Ready, Recording, Going
// back, Take 2 started). Size and shape change on CSS transitions, so dragging
// the timeline back shows the frames in between. Used by the landing page's
// "Try it" grid and by the playground (/try); both use the same markup (app/island.js).
const two = (n) => String(n).padStart(2, "0")

export function island(root = document) {
  const el = root.querySelector("#island")
  if (!el) return
  const dots = [...root.querySelectorAll("#island-stage .steps-dots i")]
  const clock = root.querySelector("#island-clock")
  let state = 0
  let since = 0
  setInterval(() => {
    if (state !== 1) return
    const s = Math.floor((performance.now() - since) / 1000)
    clock.textContent = `${Math.floor(s / 60)}:${two(s % 60)}`
  }, 250)
  el.addEventListener("click", () => {
    state = (state + 1) % 4
    if (state === 1) {
      since = performance.now()
      clock.textContent = "0:00"
    }
    el.dataset.state = String(state)
    dots.forEach((d, i) => d.classList.toggle("on", i === state))
  })
}
