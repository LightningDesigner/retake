// The island: click to morph through four states (Ready, Recording, Now
// playing, Upload done). Size and shape change on CSS transitions, so
// dragging the timeline back shows the frames in between. On the playground
// (app/island.tsx is its markup).
const two = (n: number) => String(n).padStart(2, "0")

export function island(root: ParentNode = document) {
  const el = root.querySelector<HTMLElement>("#island")
  if (!el) return
  const dots = [...root.querySelectorAll("#island-stage .steps-dots i")]
  const clock = root.querySelector("#island-clock")!
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
