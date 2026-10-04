// #go: the equalizer bars (#eq, #eq2) and the disc start; bar 5 runs from script.
// #jitter: 40 instant (0ms) translate animations on the disc at once.
// #again: the pulse's @keyframes restarts three times, 400ms apart.
const $ = (s) => document.querySelector(s)
$("#go").addEventListener("click", () => {
  $("#eq").classList.add("on")
  $("#eq2").classList.add("on")
  $("#disc").classList.add("on")
  $("#eq .bar:nth-child(5)").animate([{ transform: "scaleY(0.3)" }, { transform: "scaleY(1)" }], { duration: 600, iterations: Infinity, direction: "alternate", easing: "ease-out" })
})
$("#jitter").addEventListener("click", () => {
  for (let i = 0; i < 40; i++) $("#disc").animate([{ translate: "0px 0px" }, { translate: `0px ${i % 3}px` }], { duration: 0, fill: "none" })
})
$("#again").addEventListener("click", () => {
  const p = $("#pulse")
  let n = 0
  const restart = () => {
    p.classList.remove("on")
    void p.offsetWidth
    p.classList.add("on")
    if (++n < 3) setTimeout(restart, 400)
  }
  restart()
})
