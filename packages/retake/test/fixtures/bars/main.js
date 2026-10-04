import "./bars.css"

// Five bars on CSS keyframes, staggered, plus one on the Web Animations API.
// Replay starts them all again.
const app = document.getElementById("app")
function render() {
  app.innerHTML = `<button id="replay">Replay</button><div class="bars">${[0, 1, 2, 3, 4].map((i) => `<div class="bar" style="--i:${i}"></div>`).join("")}<div class="bar waapi"></div></div>`
  app.querySelector(".waapi").animate([{ transform: "scaleY(0.1)" }, { transform: "scaleY(1)" }], { duration: 600, delay: 400, easing: "ease-out", fill: "both" })
  app.querySelector("#replay").addEventListener("click", render)
}
render()
