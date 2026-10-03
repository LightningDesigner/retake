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

// ---- flags for the rewind specs (?tall, ?smooth, ?store, ?idb, ?canvas, ?busy, ?smil, ?bottom) ---------
const flags = new URLSearchParams(location.search)
// Every resize the app hears (paused, it must hear none).
window.__resizes = 0
addEventListener("resize", () => window.__resizes++)
// ?tall: a long page with a button far down (scrolling specs).
if (flags.has("tall")) {
  const spacer = document.createElement("div")
  spacer.id = "spacer"
  spacer.style.height = "3000px"
  const low = document.createElement("button")
  low.id = "low"
  low.textContent = "Low"
  low.style.transition = "background-color 300ms linear"
  low.addEventListener("click", () => {
    low.style.backgroundColor = low.style.backgroundColor ? "" : "rgb(46, 160, 67)"
  })
  document.body.append(spacer, low)
}
// ?smooth: the page scrolls smoothly (setting scrollTop animates).
if (flags.has("smooth")) {
  const st = document.createElement("style")
  st.textContent = "html { scroll-behavior: smooth; }"
  document.head.appendChild(st)
}
// ?store: each toggle writes the count to localStorage.
if (flags.has("store")) $("#toggle").addEventListener("click", () => localStorage.setItem("count", String(n)))
// ?idb: each toggle writes the count to IndexedDB.
if (flags.has("idb")) {
  $("#toggle").addEventListener("click", () => {
    const req = indexedDB.open("dock-app", 1)
    req.onupgradeneeded = () => req.result.createObjectStore("kv")
    req.onsuccess = () => {
      const db = req.result
      const tx = db.transaction("kv", "readwrite")
      tx.objectStore("kv").put(n, "count")
      tx.oncomplete = () => db.close()
    }
  })
}
// ?canvas: a canvas painted on each toggle (green, then red, ...).
if (flags.has("canvas")) {
  const cv = document.createElement("canvas")
  cv.id = "cv"
  cv.width = cv.height = 40
  const paint = () => {
    const g = cv.getContext("2d")
    g.fillStyle = n % 2 ? "rgb(220, 40, 40)" : "rgb(40, 200, 80)"
    g.fillRect(0, 0, 40, 40)
  }
  paint()
  $("#toggle").addEventListener("click", paint)
  document.body.insertBefore(cv, $("#count"))
}
// ?smil: an SVG that animates itself (SMIL <animate>, a 1s loop), like the landing page's.
if (flags.has("smil")) {
  const box = document.createElement("div")
  box.innerHTML = `<svg id="smil" width="100" height="10" viewBox="0 0 100 10"><rect id="bar" width="10" height="10" fill="#52a8ff"><animate attributeName="width" values="10;90" dur="1s" repeatCount="indefinite"/></rect></svg>`
  document.body.insertBefore(box, $("#count"))
}
// ?busy: every frame does a little work, like a heavy page (a rebuild's replay takes a while).
if (flags.has("busy")) {
  let acc = 0
  const spin = () => {
    for (let i = 0; i < 3000000; i++) acc += i % 7
    $("#count").dataset.acc = String(acc % 1000)
    requestAnimationFrame(spin)
  }
  requestAnimationFrame(spin)
}
// ?bottom: a bar fixed to the bottom of the app (a cookie banner), under the dock unless it's kept clear.
if (flags.has("bottom")) {
  const bar = document.createElement("div")
  bar.id = "bottom"
  bar.style.cssText = "position:fixed;left:0;right:0;bottom:0;height:40px;background:#eee"
  bar.innerHTML = `<button id="accept" style="margin:6px 40px">Accept all</button>`
  bar.querySelector("button").addEventListener("click", () => (bar.dataset.clicked = String(Number(bar.dataset.clicked || 0) + 1)))
  document.body.appendChild(bar)
}
// ?ext: a link to another site, and a button that redirects there.
if (flags.has("ext")) {
  const a = document.createElement("a")
  a.id = "ext"
  a.href = "https://example.com/elsewhere"
  a.textContent = "elsewhere"
  document.body.appendChild(a)
}
