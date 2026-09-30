// The dock. Lives in the top window; the prototype runs in a frame on the
// stage above it, with the time runtime inside. Going to another moment builds
// it in a second frame behind the visible one and swaps it in when it's ready,
// so there's no flash.
const stage = $("#wb-stage")
const dock = $("#wb-dock")
const track = $(".track")
const svg = $(".lines")

const newBranch = (forkAt, parentId = null) => {
  const id = ++D.branchSeq
  const b = { id, name: `Timeline ${id}`, forkAt, parentId, json: null, end: forkAt, born: performance.now() }
  D.branches.push(b)
  return b
}
function resetBranches() {
  D.branches = []
  D.branchSeq = 0
  D.activeId = newBranch(0).id
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
  if (D.frame && D.frame !== f) D.frame.remove()
  D.frame = f
  D.frame.className = "live"
  // Built at the recorded size; the visible frame fills the stage again.
  D.frame.style.width = D.frame.style.height = ""
  D.PT = pt
  D.building = null
  window.__waybackShell.rebuilding = false
}

window.__waybackShell = {
  rebuilding: false,
  take() {
    const p = D.stash
    D.stash = null
    return p
  },
  attach(pt) {
    if (D.building && D.building.frame.contentWindow.__wayback === pt) D.building.pt = pt
    else if (!D.frame || D.frame.contentWindow.__wayback === pt) D.PT = pt
  },
  // Build a moment (a history and a time) in a fresh frame, swap when ready.
  rebuild(payload) {
    if (D.building) D.building.frame.remove()
    D.stash = payload
    window.__waybackShell.rebuilding = true
    const rec = JSON.parse(payload.rec)
    const url = new URL(rec.url)
    D.building = { frame: makeFrame(url.pathname + url.search + url.hash), pt: null }
    // Replay at the size it was recorded at, or layout, media queries and
    // virtual lists come out differently (F18).
    const vp = recordedViewport(rec)
    if (vp) {
      D.building.frame.style.width = vp.w + "px"
      D.building.frame.style.height = vp.h + "px"
    }
  },
  // The runtime is about to cut off its future at `at`: keep it as a branch.
  branchOff(json, end, at) {
    const old = activeBranch()
    old.json = json
    old.end = end
    const b = newBranch(at, old.id)
    b.version = old.version // a new timeline starts on its parent's code
    D.activeId = b.id
  },
}

// The viewport a recording was made at: the recording says, or the runtime's
// timeline() does.
function recordedViewport(rec) {
  const ok = (v) => v && v.w > 0 && v.h > 0
  if (ok(rec.viewport)) return rec.viewport
  try {
    const v = D.PT && D.PT.timeline && D.PT.timeline().viewport
    if (ok(v)) return v
  } catch {}
  return null
}

// A fresh prototype: no history.
function freshFrame() {
  if (D.building) D.building.frame.remove()
  D.stash = null
  D.building = { frame: makeFrame(appUrl), pt: null }
  window.__waybackShell.rebuilding = true
}

D.frame = makeFrame(appUrl)
D.frame.className = "live"

// The frame being built is ready once its runtime has booted and reached its
// moment.
function checkBuilding() {
  const b = D.building
  if (!b || !b.pt) return
  let s
  try {
    s = b.pt.state()
  } catch {
    return
  }
  if (s.booted && s.target == null && !s.seeking) swapIn(b.frame, b.pt)
}

// Returns true only if the switch happened.
async function switchTo(id, t) {
  const target = branchById(id)
  if (!D.PT || !target || D.switching || id === D.activeId) return false
  D.switching = true
  try {
    const json = await recordingOf(target)
    if (!json || !D.PT) return false
    const cur = activeBranch()
    // A timeline made on other code runs on its own version of the code.
    if (target.version && cur && cur.version && target.version !== cur.version && !(await checkoutCode(target.version))) return false
    if (cur) {
      cur.json = JSON.stringify(D.PT.history())
      cur.end = D.PT.state().end
    }
    D.activeId = id
    D.PT.load(json, clamp(t, target.forkAt, target.end))
    return true
  } finally {
    D.switching = false
  }
}

// Bookmarks: dropped on a timeline at a moment, to come back to.
function addFlag() {
  const s = state()
  if (!s || !s.started) return
  const t = D.dragT != null ? D.dragT : s.previewing ? s.previewAt : s.now
  D.markers.push({ id: ++D.markerSeq, t, branchId: D.activeId })
}

// Keep the address bar and title in step with the prototype's own route.
setInterval(() => {
  try {
    const inner = new URL(D.frame.contentWindow.location.href)
    inner.searchParams.delete("__wb")
    const next = inner.pathname + inner.search + inner.hash
    if (next !== location.pathname + location.search + location.hash) history.replaceState(null, "", next)
    if (D.frame.contentDocument.title) document.title = D.frame.contentDocument.title
  } catch {}
}, 400)

const state = () => {
  try {
    if (D.PT) D.last = D.PT.state()
  } catch {
    D.PT = null
  }
  return D.last
}

function render() {
  checkBuilding()
  // The active timeline can vanish under us (a delete racing a switch); stand
  // on the first one rather than draw nothing.
  if (!activeBranch()) D.activeId = D.branches[0].id
  const s = state()
  dock.style.height = dockHeight() + "px"
  if (!s) return
  const active = activeBranch()
  if (s.started) active.end = Math.max(active.end, s.end)
  // Dragging the playhead pauses, and the Pause button says so straight away.
  $('[data-a="pause"]').classList.toggle("on", !!s.started && (!s.recording || D.dragT != null))
  $(".rec").classList.toggle("on", !!s.recording && D.dragT == null)
  const shownT = D.dragT != null ? D.dragT : s.previewing ? s.previewAt : s.now
  renderTimeline(s, shownT)
  renderExtras(s)
}
// One bad frame must never stop the dock: log it and keep going.
let renderErrors = 0
requestAnimationFrame(function loop() {
  try {
    render()
  } catch (err) {
    if (renderErrors++ < 5) console.error("[retake] dock render failed", err)
  }
  requestAnimationFrame(loop)
})

const refocus = () => D.frame && D.frame.contentWindow && D.frame.contentWindow.focus()

function toggleRecord() {
  const s = state()
  if (!D.PT || !s) return
  if (s.recording) D.PT.pause()
  else D.PT.record()
}

document.addEventListener("click", (e) => {
  const b = e.target.closest("button, [data-branch], [data-note]")
  if (!b) {
    if (!e.target.closest(".card")) closeCard()
    return
  }
  const a = b.dataset.a
  if (a === "record" && D.PT && !(D.last && D.last.recording)) D.PT.record()
  if (a === "pause" && D.PT) D.PT.pause()
  if (a === "flag") addFlag()
  if (a === "fresh") return confirmFresh(b)
  if (b.dataset.deleteTimeline) {
    menuEl.hidden = true
    deleteTimeline(Number(b.dataset.deleteTimeline))
    return
  }
  // Tools: Hand (nothing picked, just use the prototype), Select, Comment.
  if (b.dataset.tool && !b.disabled) setPicking(b.dataset.tool === "hand" ? null : b.dataset.tool)
  if (handleNoteClick(b)) return
  refocus()
})

// The dock never grows by itself (that would resize the app mid-recording);
// only the divider changes it.
const MIN_H = 96
const dockHeight = () => Math.round(clamp(D.height, MIN_H, Math.max(MIN_H, innerHeight * 0.7)))

// Start fresh asks once: the first click arms it for three seconds.
function confirmFresh(btn) {
  if (btn.classList.contains("armed")) {
    btn.classList.remove("armed")
    btn.textContent = "Start fresh"
    return startFresh()
  }
  btn.classList.add("armed")
  btn.textContent = "Clear everything?"
  setTimeout(() => {
    btn.classList.remove("armed")
    btn.textContent = "Start fresh"
  }, 3000)
}

// Resize by dragging the top edge, like docked DevTools.
const divider = $(".divider")
divider.addEventListener("pointerdown", (e) => {
  divider.setPointerCapture(e.pointerId)
  document.body.classList.add("dragging")
  const startY = e.clientY
  const startH = dock.offsetHeight
  const move = (ev) => {
    D.height = Math.round(clamp(startH + startY - ev.clientY, MIN_H, innerHeight * 0.7))
  }
  const up = () => {
    document.body.classList.remove("dragging")
    divider.removeEventListener("pointermove", move)
    divider.removeEventListener("pointerup", up)
    store.set("height", D.height)
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
