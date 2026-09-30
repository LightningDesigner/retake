// A small app with the three kinds of motion the dock draws as clips:
// CSS transitions, CSS animations and Web Animations.
const $ = (s) => document.querySelector(s)
let n = 0
$("#toggle").addEventListener("click", () => {
  $("#card").classList.toggle("off")
  $("#count").textContent = String(++n)
})
$("#spinner").addEventListener("click", () => {
  const s = $("#spin")
  s.classList.remove("go")
  void s.offsetWidth
  s.classList.add("go")
})
$("#wave").addEventListener("click", () => {
  $("#count").animate([{ transform: "scale(1)" }, { transform: "scale(1.6)" }, { transform: "scale(1)" }], { duration: 500 })
})
$("#f").addEventListener("submit", (e) => {
  e.preventDefault()
  $("#count").textContent = $("#q").value
})

// Enter sends what's typed, like a chat box: needs focus on the textarea.
$("#idea").addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return
  e.preventDefault()
  $("#sent").textContent = "sent: " + $("#idea").value
})
