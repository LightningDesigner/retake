const log = []
window.__probe = { log }
const now = () => Math.round(performance.now())
const L = (k, v) => log.push({ vt: now(), k, v })

L("random", Math.random())
L("uuid", crypto.randomUUID())
L("getRandomValues", crypto.getRandomValues(new Uint32Array(1))[0])
L("date", Date.now())
L("storage", localStorage.getItem("count"))
L("cookie", document.cookie)
requestIdleCallback(() => L("ric", "idle"))
queueMicrotask(() => L("microtask", "m"))

// IndexedDB: count rows on load
const idb = new Promise((res) => {
  const r = indexedDB.open("probe", 1)
  r.onupgradeneeded = () => r.result.createObjectStore("rows", { autoIncrement: true })
  r.onsuccess = () => res(r.result)
})
idb.then((db) => { const q = db.transaction("rows").objectStore("rows").count(); q.onsuccess = () => L("idb-count", q.result) })

new Worker(new URL("./worker.js", import.meta.url)).onmessage = (e) => L("worker", e.data)

let ticks = 0
setInterval(() => { ticks++; if (ticks % 5 === 0) L("tick", ticks) }, 100)

const late = document.getElementById("late")
new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && L("io", "visible"))).observe(late)
new ResizeObserver(() => L("ro", late.offsetHeight)).observe(late)

document.getElementById("go").addEventListener("click", async () => {
  L("click-random", Math.random())
  const c = Number(localStorage.getItem("count") || 0) + 1
  localStorage.setItem("count", c)
  document.cookie = "c=" + c
  idb.then((db) => db.transaction("rows", "readwrite").objectStore("rows").add({ c }))
  late.classList.add("show")
  const box = document.getElementById("box")
  box.addEventListener("transitionend", () => L("transitionend", ""), { once: true })
  box.classList.add("on")
  box.animate([{ opacity: 1 }, { opacity: 0.2 }], 300).finished.then(() => L("waapi-finished", ""))
  fetch("/api/json?c=" + c).then((r) => r.json()).then((j) => L("json", j))
  const x = new XMLHttpRequest(); x.open("GET", "/api/xhr"); x.onload = () => L("xhr", x.responseText); x.send()
  const res = await fetch("/api/stream")
  L("stream-headers", "")
  const reader = res.body.getReader(); const dec = new TextDecoder()
  for (;;) { const { done, value } = await reader.read(); if (done) break; L("stream-chunk", dec.decode(value)) }
  L("stream-done", "")
})
document.getElementById("sse").addEventListener("click", () => {
  const es = new EventSource("/api/sse")
  es.onmessage = (e) => { L("sse", e.data); if (e.data.startsWith("sse3")) es.close() }
})
document.getElementById("slow").addEventListener("click", () => {
  const ac = new AbortController()
  fetch("/api/slow", { signal: ac.signal }).then(() => L("slow", "ok"), (e) => L("slow-err", e.name))
  setTimeout(() => ac.abort(), 50)
})
document.getElementById("f").addEventListener("submit", (e) => { e.preventDefault(); L("submit", document.getElementById("q").value) })
document.getElementById("q").addEventListener("keydown", (e) => L("keycode", e.keyCode))
let changes = 0
document.getElementById("cb").addEventListener("change", (e) => L("change", [++changes, e.target.checked]))
const slider = document.getElementById("slider")
let dragging = false, val = 0
slider.addEventListener("pointerdown", (e) => { try { slider.setPointerCapture(e.pointerId); L("capture", "ok") } catch (err) { L("capture", err.name) } dragging = true })
slider.addEventListener("pointermove", (e) => { if (dragging) val = Math.round(e.clientX - slider.getBoundingClientRect().left) })
slider.addEventListener("pointerup", () => { dragging = false; L("slider", val) })
let moves = 0
const pad = document.getElementById("pad")
pad.addEventListener("mousemove", () => moves++)
pad.addEventListener("click", () => L("mousemoves", moves))

document.getElementById("ws").addEventListener("click", () => {
  const ws = new WebSocket(`ws://${location.host}/ws-probe`)
  ws.onopen = () => L("ws-open", "")
  ws.onmessage = (e) => L("ws", e.data)
  ws.onclose = (e) => L("ws-close", e.code)
})
document.getElementById("bytes").addEventListener("click", async () => {
  const buf = new Uint8Array(await (await fetch("/api/bytes")).arrayBuffer())
  L("bytes", [buf.length, buf[0], buf[255], buf.reduce((a, b) => a + b, 0)])
})
let posts = 0
document.getElementById("post").addEventListener("click", async () => {
  posts++
  const a = await (await fetch("/api/echo", { method: "POST", body: "first-" + posts })).json()
  const b = await (await fetch("/api/echo", { method: "POST", body: "second-" + posts })).json()
  L("post", [a.body, b.body])
})
document.getElementById("llm").addEventListener("click", async () => {
  const res = await fetch("/api/llm")
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
  let text = ""
  for (;;) { const { done, value } = await reader.read(); if (done) break; text += value; L("token", text) }
  L("llm-done", text)
})
let wheel = 0
pad.addEventListener("wheel", (e) => { wheel += e.deltaY; L("wheel", Math.round(wheel)) }, { passive: true })
const page = () => new URLSearchParams(location.search).get("p") || "0"
addEventListener("popstate", () => L("page", page()))
document.getElementById("next").addEventListener("click", () => { const u = new URL(location.href); u.searchParams.set("p", Number(page()) + 1); history.pushState({ p: Number(page()) + 1 }, "", u); L("page", page()) })

// A background media file gates part of the UI (like Sherpa's onboarding video).
const gated = document.getElementById("gated")
document.getElementById("aud").addEventListener("loadeddata", () => { L("media", "loadeddata"); gated.hidden = false })
document.getElementById("pic").addEventListener("load", () => L("img", "load"))
gated.addEventListener("input", () => L("gated", gated.value))

document.getElementById("conf").addEventListener("click", () => {
  const c = document.createElement("canvas")
  c.width = 100; c.height = 50
  document.body.appendChild(c)
  const off = c.transferControlToOffscreen()
  const w = new Worker(new URL("./conf-worker.js", import.meta.url))
  w.onmessage = (e) => L("conf", e.data)
  w.postMessage({ canvas: off }, [off])
})

// Like Sherpa's POST: only the status is looked at, the body is never read.
document.getElementById("unread").addEventListener("click", async () => {
  const res = await fetch("/api/stream?unread=1")
  L("unread", res.status)
})
