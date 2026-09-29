// The dock. Lives in the top window; the prototype runs in a frame on the
// stage above it, with the time runtime inside. Nothing is on the timeline
// until Record. Going to another moment builds it in a second frame behind the
// visible one and swaps it in when it's ready, so there's no flash.
const $ = (s) => document.querySelector(s)
const stage = $("#wb-stage")
const dock = $("#wb-dock")
const track = $(".track")
const svg = $(".lines")
const KEY = "wayback:"
const store = {
  get(k, fallback) {
    try {
      const v = localStorage.getItem(KEY + k)
      return v == null ? fallback : JSON.parse(v)
    } catch {
      return fallback
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(KEY + k, JSON.stringify(v))
    } catch {}
  },
}

let height = store.get("height", 104)
let frame = null // the visible prototype frame
let PT = null // its runtime
let building = null // { frame, pt } being built behind it
let last = null // last state seen
let stash = null

// Branches live for the session. The active one's history is in the frame;
// the others keep a serialized copy here.
let branches = []
let activeId = 0
let branchSeq = 0
const newBranch = (forkAt, parentId = null) => {
  const b = { id: ++branchSeq, name: `Timeline ${branchSeq}`, forkAt, parentId, json: null, end: forkAt, born: performance.now() }
  branches.push(b)
  return b
}
const activeBranch = () => branches.find((b) => b.id === activeId)
function resetBranches() {
  branches = []
  branchSeq = 0
  activeId = newBranch(0).id
}
resetBranches()

const appUrl = (() => {
  const u = new URL(location.href)
  u.searchParams.set("__wb", "app")
  return u.pathname + u.search + u.hash
})()

function makeFrame(src) {
  const f = document.createElement("iframe")
  f.title = "Prototype"
  f.className = "building"
  f.src = src
  stage.prepend(f)
  return f
}

function swapIn(f, pt) {
  if (frame && frame !== f) frame.remove()
  frame = f
  frame.className = "live"
  PT = pt
  building = null
  window.__waybackShell.rebuilding = false
}

window.__waybackShell = {
  rebuilding: false,
  stash(p) {
    stash = p
  },
  take() {
    const p = stash
    stash = null
    return p
  },
  attach(pt) {
    if (building && building.frame.contentWindow.__wayback === pt) building.pt = pt
    else if (!frame || frame.contentWindow.__wayback === pt) PT = pt
  },
  // Build a moment (a history and a time) in a fresh frame, swap when ready.
  rebuild(payload) {
    if (building) building.frame.remove()
    stash = payload
    window.__waybackShell.rebuilding = true
    const url = new URL(JSON.parse(payload.rec).url)
    building = { frame: makeFrame(url.pathname + url.search + url.hash), pt: null }
  },
  // The runtime is about to cut off its future at `at`: keep it as a branch.
  branchOff(json, end, at) {
    const old = activeBranch()
    old.json = json
    old.end = end
    activeId = newBranch(at, old.id).id
  },
}

// A fresh prototype: no history, not recording.
function freshFrame() {
  if (building) building.frame.remove()
  stash = null
  building = { frame: makeFrame(appUrl), pt: null }
  window.__waybackShell.rebuilding = true
}

frame = makeFrame(appUrl)
frame.className = "live"

// The frame being built is ready once its runtime has booted and reached its
// moment.
function checkBuilding() {
  if (!building || !building.pt) return
  let s
  try {
    s = building.pt.state()
  } catch {
    return
  }
  if (s.booted && s.target == null && !s.seeking) swapIn(building.frame, building.pt)
}

let switching = false
async function switchTo(id, t) {
  const target = branches.find((b) => b.id === id)
  if (!PT || !target || !target.json || switching) return
  switching = true
  try {
    const cur = activeBranch()
    cur.json = JSON.stringify(PT.history())
    cur.end = PT.state().end
    // A branch made by a code change runs on its own version of the code.
    if (target.version && cur.version && target.version !== cur.version) await checkoutCode(target.version)
    activeId = id
    PT.load(target.json, Math.min(Math.max(t, target.forkAt), target.end))
  } finally {
    switching = false
  }
}

// Markers: flags dropped on a timeline at a moment, to come back to.
let markers = [] // { id, t, branchId }
let markerSeq = 0
function addFlag() {
  const s = state()
  if (!s || !s.started) return
  const t = dragT != null ? dragT : s.previewing ? s.previewAt : s.now
  markers.push({ id: ++markerSeq, t, branchId: activeId })
}

// Keep the address bar and title in step with the prototype's own route.
setInterval(() => {
  try {
    const inner = new URL(frame.contentWindow.location.href)
    inner.searchParams.delete("__wb")
    const next = inner.pathname + inner.search + inner.hash
    if (next !== location.pathname + location.search + location.hash) history.replaceState(null, "", next)
    if (frame.contentDocument.title) document.title = frame.contentDocument.title
  } catch {}
}, 400)

const fmt = (ms) => {
  const s = Math.max(0, ms) / 1000
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${(s % 60).toFixed(2).padStart(5, "0")}`
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c])

const state = () => {
  try {
    if (PT) last = PT.state()
  } catch {
    PT = null
  }
  return last
}

function render() {
  checkBuilding()
  const s = state()
  dock.style.height = Math.max(height, neededHeight()) + "px"
  if (!s) return
  const active = activeBranch()
  if (s.started) active.end = Math.max(active.end, s.end)
  $(".rec").classList.toggle("on", !!s.recording)
  // Dragging the playhead pauses, and the Pause button says so straight away.
  $('[data-a="pause"]').classList.toggle("on", !!s.started && (!s.recording || dragT != null))
  $(".rec").classList.toggle("on", !!s.recording && dragT == null)
  const shownT = dragT != null ? dragT : s.previewing ? s.previewAt : s.now
  renderTimeline(s, shownT)
  renderExtras(s)
}
// First frame after every module has loaded.
requestAnimationFrame(function loop() {
  render()
  requestAnimationFrame(loop)
})

const refocus = () => frame && frame.contentWindow && frame.contentWindow.focus()

function toggleRecord() {
  const s = state()
  if (!PT || !s) return
  if (s.recording) PT.pause()
  else PT.record()
}

document.addEventListener("click", (e) => {
  const b = e.target.closest("button, [data-branch], [data-note]")
  if (!b) {
    if (!e.target.closest(".card")) closeCard()
    return
  }
  const a = b.dataset.a
  if (a === "record" && PT && !(last && last.recording)) PT.record()
  if (a === "pause" && PT) PT.pause()
  if (a === "flag") addFlag()
  // Tools: Hand (nothing picked, just use the prototype), Select, Comment.
  if (b.dataset.tool && !b.disabled) setPicking(b.dataset.tool === "hand" ? null : b.dataset.tool)
  if (handleNoteClick(b)) return
  refocus()
})

// Resize by dragging the top edge, like docked DevTools.
const divider = $(".divider")
divider.addEventListener("pointerdown", (e) => {
  divider.setPointerCapture(e.pointerId)
  document.body.classList.add("dragging")
  const startY = e.clientY
  const startH = dock.offsetHeight
  const move = (ev) => {
    height = Math.round(Math.min(innerHeight * 0.6, Math.max(44, startH + startY - ev.clientY)))
  }
  const up = () => {
    document.body.classList.remove("dragging")
    divider.removeEventListener("pointermove", move)
    divider.removeEventListener("pointerup", up)
    store.set("height", height)
  }
  divider.addEventListener("pointermove", move)
  divider.addEventListener("pointerup", up)
})

window.addEventListener("keydown", (e) => {
  if (e.key === "Meta") return window.__waybackShell.meta(true)
  if (e.key === "Escape") {
    setPicking(null)
    closeCard()
    return
  }
  if (e.code === "KeyM" && !e.metaKey && !e.ctrlKey && !e.altKey && e.target === document.body) addFlag()
  if (e.altKey && e.code === "KeyP") {
    e.preventDefault()
    toggleRecord()
  }
})
window.addEventListener("keyup", (e) => e.key === "Meta" && window.__waybackShell.meta(false))
window.addEventListener("blur", () => window.__waybackShell.meta(false))
