// The dock. Lives in the top window; the prototype runs in a frame on the
// stage above it, with the time runtime inside. Going to another moment builds
// it in a second frame behind the visible one and swaps it in when it's ready,
// so there's no flash.
const stage = $("#wb-stage")
const dock = $("#wb-dock")
const track = $(".track")
const cv = $(".lines") // the timeline canvas

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

function makeFrame(src, stash) {
  const f = document.createElement("iframe")
  f.title = "Prototype"
  f.className = "building"
  if (stash) f.__retakeStash = stash
  f.src = src
  stage.prepend(f)
  return f
}

function swapIn(f, pt) {
  if (D.frame && D.frame !== f) D.frame.remove()
  D.frame = f
  D.frameBranch = D.building ? D.building.branchId : D.activeId
  noteBuilt(D.building)
  D.frame.className = "live"
  // Built at the recorded size; the visible frame fills the stage again.
  D.frame.style.width = D.frame.style.height = ""
  D.PT = pt
  D.building = null
  window.__waybackShell.rebuilding = false
  hookFrameKeys(f.contentWindow)
}

window.__waybackShell = {
  rebuilding: false,
  // The runtime hands over keys it blocks in the view-only past. True if the
  // dock used it.
  key(e) {
    try {
      return dockKey(e)
    } catch {
      return false
    }
  },
  // A booting runtime asks for the history it should build. Several frames
  // can be booting (a rewind, a checkpoint), so each keeps its own; the one
  // asking is the one whose runtime exists and hasn't taken it yet.
  take() {
    for (const f of stage.querySelectorAll("iframe")) {
      let mine = false
      try {
        mine = "__retakeStash" in f && !!f.contentWindow.__wayback
      } catch {}
      if (!mine) continue
      const p = f.__retakeStash
      delete f.__retakeStash
      return p
    }
    return null
  },
  attach(pt) {
    if (D.building && D.building.frame.contentWindow.__wayback === pt) D.building.pt = pt
    else if (D.cp && D.cp.frame.contentWindow.__wayback === pt) D.cp.pt = pt
    else if (!D.frame || D.frame.contentWindow.__wayback === pt) {
      D.PT = pt
      hookFrameKeys(D.frame.contentWindow)
    }
  },
  // Build a moment (a history and a time) in a fresh frame, swap when ready.
  rebuild(payload) {
    if (D.building) D.building.frame.remove()
    if (useCheckpoint(payload)) return
    // Copied into this window: the payload object was made in the old frame,
    // and the new frame keeps what take() gives it for its whole life, so
    // passing it on would keep every earlier frame alive in a chain.
    const stash = own(payload)
    window.__waybackShell.rebuilding = true
    const rec = JSON.parse(payload.rec)
    const url = new URL(urlAt(rec, payload.target))
    // It's built for whichever timeline is active now (a switch sets that
    // before it loads the target's recording).
    D.building = { frame: makeFrame(url.pathname + url.search + url.hash, stash), pt: null, branchId: D.activeId, target: payload.target, startedAt: performance.now() }
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
    // A moment still being built belongs to the timeline we're leaving; if it
    // landed now it would bring that timeline's future onto the new one.
    cancelBuild()
    const old = activeBranch()
    old.json = json
    old.end = end
    const b = newBranch(at, old.id)
    b.version = old.version // a new timeline starts on its parent's code
    D.activeId = b.id
    D.frameBranch = b.id // the visible frame carries on as the new timeline
  },
}

// The page a recording was on at t: after a navigation or reload the dock
// continued it through (rec.navs), that page; before, where it began.
function urlAt(rec, t) {
  let url = rec.url
  for (const n of rec.navs || []) if (n.t <= t && n.url) url = new URL(n.url, rec.url).href
  return url
}

// A plain copy made in the dock's realm (values only).
function own(payload) {
  const out = {}
  for (const k of Object.keys(payload)) {
    const v = payload[k]
    out[k] = v !== null && typeof v === "object" ? JSON.parse(JSON.stringify(v)) : v
  }
  return out
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

function cancelBuild() {
  dropCheckpoint()
  if (!D.building) return
  D.building.frame.remove()
  D.building = null
  window.__waybackShell.rebuilding = false
}

// A fresh prototype: no history.
function freshFrame() {
  if (D.building) D.building.frame.remove()
  dropCheckpoint()
  D.building = { frame: makeFrame(appUrl), pt: null, branchId: D.activeId }
  window.__waybackShell.rebuilding = true
}

// The first frame is opened by restore() (15-session.js) once it knows what
// was saved: always at the page the user asked for, live, never a rebuild.
function openFirstFrame(stash, branchId) {
  if (D.frame) return
  D.frame = makeFrame(appUrl, stash)
  D.frame.className = "live"
  D.frameBranch = branchId
}

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
    if (target.version && cur && cur.version && target.version !== cur.version) {
      const r = await checkoutCode(target.version)
      if (!r.ok) return false
      await settleLeftVersion(cur, r)
    }
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
  dropStaleResume()
  tendCheckpoint()
  // The active timeline can vanish under us (a delete racing a switch); stand
  // on the first one rather than draw nothing.
  if (!activeBranch()) D.activeId = D.branches[0].id
  const s = state()
  dock.style.height = dockHeight() + "px"
  if (!s || !D.frame) return
  autoStart(s)
  const active = activeBranch()
  // Only the active timeline's own frame says how far it goes: mid-switch the
  // visible frame is still the timeline we're leaving.
  // Its recording is the truth, which also mends an end saved wrongly before.
  if (s.started && D.frameBranch === D.activeId && !s.seeking) active.end = s.end
  const shownT = shownTime(s)
  renderHead(s, shownT)
  renderShield(s)
  if (s.started) renderTimeline(s, shownT)
  renderExtras(s)
}

// A frame that reloads itself leaves shell.__resume for its next document.
// A frame we removed can leave one too (pagehide runs as it goes), and that
// object, made in its realm, would keep the whole old window alive.
function dropStaleResume() {
  const r = window.__waybackShell.__resume
  if (r && (!r.frame || !r.frame.isConnected)) window.__waybackShell.__resume = null
}

// Recording is always on from page load: a runtime that waits for Record gets
// it once, as soon as it has booted.
// (A WeakSet, so a runtime we've moved on from can be collected.)
const autoStarted = new WeakSet()
function autoStart(s) {
  if (s.started || !s.booted || D.building || autoStarted.has(D.PT)) return
  autoStarted.add(D.PT)
  D.PT.record()
}

// In the past the app is view-only: a clear shield takes its pointer events
// and keyboard focus stays with the dock. The comment and select tools see
// through it (they work on the past).
const shield = $("#wb-shield")
function renderShield(s) {
  const block = !!s.started && !isInteractive(s) && !mode()
  shield.hidden = !block
  // In the past, keys belong to the dock, so the visible frame shouldn't keep
  // focus. Never touch the frame being built: its replay moves focus around
  // (a replayed click on a textarea) and the keys it replays need that focus.
  if (block && D.frame && document.activeElement === D.frame && !D.building) {
    D.frame.blur()
    window.focus()
  }
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

document.addEventListener("click", (e) => {
  const b = e.target.closest("button, [data-branch], [data-note]")
  if (!b) {
    if (!e.target.closest(".card")) closeCard()
    return
  }
  const a = b.dataset.a
  if (a === "play") togglePlay()
  if (a === "fresh") return startFresh()
  if (a === "undo") return undoFresh()
  if (a === "live") return followLive()
  if (a === "notes") return toggleList()
  if (b.dataset.deleteTimeline) {
    menuEl.hidden = true
    deleteTimeline(Number(b.dataset.deleteTimeline)).then((ok) => ok || flash("Couldn't delete that timeline right now"))
    return
  }
  if (b.dataset.renameTimeline) {
    menuEl.hidden = true
    renameLane(Number(b.dataset.renameTimeline))
    return
  }
  // Tools: Hand (nothing picked, just use the prototype), Select, Comment.
  if (b.dataset.tool && !b.disabled) setPicking(b.dataset.tool === "hand" ? null : b.dataset.tool)
  if (handleNoteClick(b)) return
  if (isInteractive()) refocus()
})

// The dock never grows by itself (that would resize the app mid-recording);
// only the divider changes it.
const MIN_H = 150
const dockHeight = () => Math.round(clamp(D.height, MIN_H, Math.max(MIN_H, innerHeight * 0.7)))

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
    closeList()
    return
  }
  if (e.altKey && e.code === "KeyP") {
    e.preventDefault()
    return togglePlay()
  }
  if (dockKey(e)) e.preventDefault()
})
// Keys pressed inside a view-only app are the dock's too.
function hookFrameKeys(win) {
  try {
    if (!win || win.__retakeKeys) return
    win.__retakeKeys = true
    win.addEventListener(
      "keydown",
      (e) => {
        if (isInteractive() || !dockKey(e)) return
        e.preventDefault()
        e.stopImmediatePropagation()
      },
      true,
    )
  } catch {}
}
window.addEventListener("keyup", (e) => e.key === "Meta" && window.__waybackShell.meta(false))
window.addEventListener("blur", () => window.__waybackShell.meta(false))
