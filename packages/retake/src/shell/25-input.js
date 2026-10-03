// Moving through time. Press anywhere on the ruler or the active lane and drag:
// the playhead follows, snapping to clip edges and markers within 8px (hold
// alt to move freely). Dragging back shows the past live; letting go keeps it
// on screen and builds that moment for real behind it (goTo). Keys: ← → a
// frame, shift+← → the previous or next edge, space play/pause, F fit all,
// + a new timeline from here.

const SNAP_PX = 8
const GRAB_PX = 4 // a press this close to the playhead picks it up where it is
const DEAD_PX = 3 // a press that moves less than this is a click, not a drag
const FRAME_MS = 1000 / 60

// Moments worth landing on: clip edges, markers, bookmarks, notes, where
// timelines split, and the ends. Input lands just after it happened (+1), so
// its effect shows.
function edges(s) {
  const active = activeBranch()
  const out = [s.start, Math.max(active.end, s.end), active.forkAt]
  const tl = timeline()
  for (const c of tl.clips) {
    out.push(c.start + 1)
    if (c.end != null) out.push(c.end)
  }
  for (const m of tl.markers) out.push(m.t + 1)
  for (const m of D.markers) if (m.branchId === D.activeId) out.push(m.t)
  for (const n of D.notes) if (n.branchId === D.activeId) out.push(n.t)
  for (const b of D.branches) if (b.parentId === D.activeId) out.push(b.forkAt)
  const lo = active.forkAt
  const hi = Math.max(active.end, s.end)
  return [...new Set(out.map((t) => Math.round(t * 100) / 100))].filter((t) => t >= lo && t <= hi).sort((a, b) => a - b)
}

// Where the playhead may go on the active timeline.
function bounds(s) {
  const b = activeBranch()
  return [Math.max(s.start, b.forkAt), Math.max(b.end, s.end)]
}

function snapped(t, s, free) {
  D.snapT = null
  if (free) return t
  const ppm = pxPerMs(geom())
  let best = null
  for (const e of edges(s)) {
    const d = Math.abs(e - t) * ppm
    if (d <= SNAP_PX && (!best || d < best.d)) best = { e, d }
  }
  if (!best) return t
  D.snapT = best.e
  return best.e
}

// ---- going to a moment -------------------------------------------------------------

// Show `t` straight away: a live preview going back, a quick run going forward
// through recorded future (on this page only: past a reload is a rebuild,
// left to the release). goTo() then makes it the real moment.
function scrubTo(t) {
  const pt = D.PT
  if (!pt) return
  let s
  try {
    s = pt.state()
  } catch {
    return
  }
  if (t < s.now - 1) return pt.preview(t, D.scopeEl)
  if (s.previewing) pt.endPreview()
  if (t > s.now + 1 && s.future && s.storageOk !== false) {
    const to = s.segEnd != null ? Math.min(t, s.segEnd - 1) : t
    if (to <= s.now + 1) return
    // The frame on show runs its app: nothing else may (one frame at a time).
    cancelBuild()
    quietCheckpoint()
    pt.seek(to)
  }
}

// Going to a moment for real: the one way the dock moves the playhead there
// (a release, a key step, a note, a bookmark, +, Play from a preview).
//  - already there (a press on the playhead): nothing to build;
//  - forward on the same page: the frame on show seeks there in place;
//  - anywhere else: shown at once as a preview, and built for real in a
//    hidden frame that swaps in when ready. The user only waits for it if
//    they ask for the real moment first (play, fork), or if the preview can't
//    show it (a moment on an earlier page).
function goTo(t, { play = false, fork = false } = {}) {
  const pt = D.PT
  if (!pt) return
  // A switch to another timeline is still being built: the frame on show is
  // the timeline being left, so the moment is that build's to go to.
  const sw = D.building
  if (sw && sw.target != null && sw.branchId === D.activeId && D.frameBranch !== D.activeId) return goToSwitching(sw, t, play, fork)
  let s
  try {
    s = pt.state()
  } catch {
    return
  }
  if (D.scopeEl && !play && !fork) return // a scoped preview stays a picture
  if (s.playing) {
    pt.pause()
    s = pt.state()
  }
  const docStart = s.docStart != null ? s.docStart : s.start
  const here = samePlace(s.now, t) // the frame on show stands at that moment
  const shown = here || (t < s.now && t >= docStart) // it's there, or the preview can show it
  const showIt = () => {
    if (here) {
      if (s.previewing) pt.endPreview()
      return
    }
    if (t >= s.now) return
    const at = Math.max(t, docStart)
    if (!(s.previewing && s.previewAt === at)) pt.preview(at, null)
  }
  const b = D.building
  if (b && b.target != null && b.branchId === D.activeId && samePlace(b.target, t)) {
    // That's the moment being built already: keep it.
    showIt()
    b.play = b.play || play
    b.fork = b.fork || fork
    b.visible = !shown
    return
  }
  // This frame can run its app as it is. (If not, another frame has changed
  // its IndexedDB: even the moment it stands at is built again behind it,
  // and only Play or + wait for that.)
  const mine = s.storageOk !== false
  if (mine && here) {
    cancelBuild()
    if (s.previewing) pt.endPreview()
    if (fork) return forkNow()
    if (play) {
      quietCheckpoint()
      pt.play()
    }
    return
  }
  if (t > s.now && s.future && mine && (s.segEnd == null || t < s.segEnd)) {
    cancelBuild()
    if (s.previewing) pt.endPreview()
    quietCheckpoint()
    pt.seek(t, play)
    if (fork) pendingFork = t
    return
  }
  showIt()
  if (typeof pt.buildAt !== "function") return pt.seek(t, play) // an older runtime: it builds in view
  pt.buildAt(t) // rebuild() keeps, moves on or replaces the frame being built
  const nb = D.building
  if (nb && nb.target != null) {
    nb.play = play
    nb.fork = fork
    nb.visible = !shown
  }
}

// Mid-switch: the build moves on to t, or is made again there from the
// timeline's own recording (never from the frame on show, which is another).
function goToSwitching(b, t, play, fork) {
  if (Math.abs(b.target - t) >= 1 && !retargetBuild(b, t)) {
    const br = activeBranch()
    if (!br || !br.json) return
    D.PT.load(br.json, t)
  }
  const nb = D.building
  if (!nb) return
  nb.play = nb.play || play
  nb.fork = nb.fork || fork
}

// While the pointer's down, a frame still building behind works in idle
// time, so the preview under the pointer stays smooth.
function setBuildBackground(on) {
  const b = D.building
  try {
    if (b && b.pt && typeof b.pt.setBackground === "function") b.pt.setBackground(on)
  } catch {}
}

let pendingT = null
function scrubSoon(t) {
  if (pendingT == null)
    requestAnimationFrame(() => {
      const t = pendingT
      pendingT = null
      if (t != null) scrubTo(t)
    })
  pendingT = t
}

// The moment the readout and playhead show: under the pointer, where the keys
// took it, the moment being built, the one previewed, or the frame's own.
const shownTime = (s) =>
  D.dragT != null ? D.dragT : D.keyT != null ? D.keyT : D.building && D.building.target != null ? D.building.target : s.previewing ? s.previewAt : s.now

// Arrow keys: a frame at a time (the recorded frame boundaries when there are
// some), or edge to edge with shift. The moment is built once the keys rest.
let keyTimer = 0
function stepBy(dir, toEdge) {
  const s = state()
  if (!D.PT || !s || !s.started) return
  if (s.playing) D.PT.pause()
  const cur = shownTime(s)
  const [lo, hi] = bounds(s)
  let t
  if (toEdge) {
    const es = edges(s)
    t = dir > 0 ? es.find((e) => e > cur + 0.5) : es.reverse().find((e) => e < cur - 0.5)
    if (t == null) t = dir > 0 ? hi : lo
  } else {
    let frames = null
    try {
      frames = D.PT.history().frames
    } catch {}
    t = cur + dir * FRAME_MS
    if (frames && frames.length) {
      const next = dir > 0 ? frames.find((f) => f > cur + 0.01) : findLast(frames, (f) => f < cur - 0.01)
      if (next != null) t = next
    }
  }
  t = clamp(t, lo, hi)
  D.keyT = t
  scrubTo(t)
  keepInView(t)
  clearTimeout(keyTimer)
  keyTimer = setTimeout(() => {
    D.keyT = null
    goTo(t)
  }, 350)
}
function findLast(arr, fn) {
  for (let i = arr.length - 1; i >= 0; i--) if (fn(arr[i])) return arr[i]
}
function keepInView(t) {
  const span = D.view.to - D.view.from
  if (t < D.view.from || t > D.view.to) setView(t - span / 2, t + span / 2)
}

// ---- pointer on the track -----------------------------------------------------------

function startScrub(e, s) {
  track.setPointerCapture(e.pointerId)
  document.body.classList.add("scrubbing")
  if (s.playing) D.PT.pause()
  const [lo, hi] = bounds(s)
  const g = geom()
  const shown = shownTime(s)
  // On the playhead (or within 4px of it): pick it up where it is, so a
  // click there is no move at all.
  if (Math.abs(e.clientX - (g.left + xOf(shown, g))) <= GRAB_PX) {
    D.snapT = null
    D.dragT = shown
  } else D.dragT = clamp(snapped(timeAt(e.clientX, g), s, e.altKey), lo, hi)
  D.dragX0 = e.clientX
  D.dragMoved = false
  setBuildBackground(true)
  hideTip()
  scrubSoon(D.dragT)
}

function endScrub() {
  if (D.dragT == null) return
  const t = D.dragT
  D.dragT = null
  D.snapT = null
  document.body.classList.remove("scrubbing")
  setBuildBackground(false)
  if (!D.PT) return
  pendingT = null
  scrubTo(t)
  goTo(t)
}

// Pressing on the track: Control-click branches the active timeline at that
// moment; a click on another timeline's lane selects it; anywhere else moves
// the playhead (and dragging scrubs).
track.addEventListener("pointerdown", (e) => {
  const s = D.last
  if (!D.PT || !s || !s.started || e.button !== 0) return
  menuEl.hidden = true
  if (e.ctrlKey) {
    e.preventDefault()
    const t = branchTimeAt(e.clientX, s, e.altKey)
    D.branchT = null
    document.body.classList.remove("branching")
    return newTimelineAt(t)
  }
  const hit = hitAt(e.clientX, e.clientY)
  if (hit && hit.kind === "note") return goToNoteId(hit.id)
  if (hit && hit.kind === "capsule") {
    // ⌘ held on one of the element's animations: fit it, go to its start.
    const c = hit.clip
    fitRange(c.start, c.end == null ? s.end : c.end)
    goTo(c.start + 1)
    return
  }
  if (hit && hit.kind === "bookmark") {
    const m = D.markers.find((x) => String(x.id) === String(hit.id))
    if (m) goTo(m.t)
    return
  }
  if (hit && hit.kind === "lane" && !hit.active) {
    const b = branchById(hit.id)
    if (b) switchTo(b.id, clamp(shownTime(s), b.forkAt, b.end)).then((ok) => ok || flash("Couldn't switch to that timeline"))
    return
  }
  startScrub(e, s)
})

// Where a Control-click would branch: on the active timeline, snapped.
function branchTimeAt(clientX, s, free) {
  const [lo, hi] = bounds(s)
  const t = clamp(snapped(timeAt(clientX), s, free), lo, hi)
  D.snapT = null
  return t
}

// Holding Control over the track shows the branch guide.
let overTrack = null // the last pointer event over the track
function setBranchGuide(on, e) {
  const s = D.last
  const show = !!(on && e && s && s.started && D.dragT == null)
  D.branchT = show ? branchTimeAt(e.clientX, s, e.altKey) : null
  document.body.classList.toggle("branching", show)
}
window.addEventListener("keydown", (e) => e.key === "Control" && overTrack && setBranchGuide(true, overTrack))
window.addEventListener("keyup", (e) => e.key === "Control" && setBranchGuide(false))
window.addEventListener("blur", () => setBranchGuide(false))

track.addEventListener("pointermove", (e) => {
  const s = D.last
  if (!s || !s.started) return
  const g = geom()
  overTrack = e
  if (D.dragT != null) {
    if (!D.dragMoved && Math.abs(e.clientX - D.dragX0) < DEAD_PX) return
    D.dragMoved = true
    const [lo, hi] = bounds(s)
    D.dragT = clamp(snapped(timeAt(e.clientX, g), s, e.altKey), lo, hi)
    // The first move of each dock frame previews straight away (it paints in
    // this frame); any more wait for the next one.
    if (D.scrubbedAt !== D.frameNo) {
      D.scrubbedAt = D.frameNo
      pendingT = null
      scrubTo(D.dragT)
    } else scrubSoon(D.dragT)
    return
  }
  setBranchGuide(e.ctrlKey, e)
  if (e.ctrlKey) return
  hover(e, s, g)
})
track.addEventListener("pointerup", endScrub)
track.addEventListener("pointercancel", endScrub)
track.addEventListener("pointerleave", () => {
  overTrack = null
  setBranchGuide(false)
  D.hoverRow = null
})

// Hovering the track: which row the pointer is on (for its faint band).
function hover(e, s, g) {
  const hit = hitAt(e.clientX, e.clientY)
  D.hoverRow = hit && hit.kind === "lane" ? hit.id : null
}

// The component that wrote the clip's element, found the way notes find it
// (owner chain, library wrappers skipped); else the runtime's guess.
function clipComponent(c) {
  try {
    const el = c.selector && D.frame.contentDocument.querySelector(c.selector)
    const names = el ? reactComponents(el) : []
    if (names.length) return names[0]
  } catch {}
  return c.component && !INTERNAL.test(c.component) ? c.component : ""
}

const clipName = (c) => (c.kind === "transition" ? c.property || "transition" : c.label || c.property || "animation")
const msWord = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(ms >= 10000 ? 0 : 1)}s` : `${Math.round(ms)}ms`)

function setHot(h) {
  D.hot = h
}

function hideTip() {
  tip.hidden = true
}

// ⌘-scroll or pinch zooms around the pointer; a sideways scroll pans.
track.addEventListener(
  "wheel",
  (e) => {
    const s = D.last
    if (!s || !s.started) return
    const g = geom()
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault()
      const at = timeAt(e.clientX, g)
      const factor = Math.exp(clamp(e.deltaY, -60, 60) * (e.ctrlKey && !e.metaKey ? 0.012 : 0.004))
      const full = fullRange(s)
      const span = clamp((D.view.to - D.view.from) * factor, 12, (full.to - full.from) * 3)
      const frac = (at - D.view.from) / (D.view.to - D.view.from)
      setView(at - frac * span, at - frac * span + span, { animate: false })
      return
    }
    const dx = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.shiftKey ? e.deltaY : 0
    if (!dx) return
    e.preventDefault()
    const dt = dx / pxPerMs(g)
    setView(D.view.from + dt, D.view.to + dt, { animate: false })
  },
  { passive: false },
)

// ---- lanes: switch, rename, delete ------------------------------------------------

const menuEl = $("#wb-menu")
function openLaneMenu(e, b) {
  e.preventDefault()
  menuEl.innerHTML = b.parentId
    ? `<button data-rename-timeline="${b.id}">Rename</button><button class="danger" data-delete-timeline="${b.id}">Delete ${esc(b.name)}</button>`
    : `<button data-rename-timeline="${b.id}">Rename</button><div class="menu-note">The first timeline can't be deleted</div>`
  menuEl.hidden = false
  menuEl.style.left = Math.min(e.clientX, innerWidth - 200) + "px"
  menuEl.style.top = e.clientY - menuEl.offsetHeight - 6 + "px"
}
track.addEventListener("contextmenu", (e) => {
  e.preventDefault()
  // On a Mac, Control-click is also a right-click: that one was a branch.
  if (e.ctrlKey) return
  const hit = hitAt(e.clientX, e.clientY)
  const b = hit && hit.kind === "lane" && branchById(hit.id)
  if (b) openLaneMenu(e, b)
})
gutter.addEventListener("contextmenu", (e) => {
  const el = e.target.closest("[data-lane]")
  const b = el && branchById(Number(el.dataset.lane))
  if (b) openLaneMenu(e, b)
})
gutter.addEventListener("click", (e) => {
  const el = e.target.closest("[data-lane]")
  const b = el && branchById(Number(el.dataset.lane))
  if (!b || b.id === D.activeId || el.querySelector("input")) return
  const t = D.last ? shownTime(D.last) : b.forkAt
  switchTo(b.id, clamp(t, b.forkAt, b.end)).then((ok) => ok || flash("Couldn't switch to that timeline"))
})
gutter.addEventListener("dblclick", (e) => {
  const el = e.target.closest("[data-lane]")
  if (el) renameLane(Number(el.dataset.lane))
})
document.addEventListener("pointerdown", (e) => {
  if (!menuEl.hidden && !/** @type {Element} */ (e.target).closest("#wb-menu")) menuEl.hidden = true
})

function renameLane(id) {
  const b = branchById(id)
  const el = gutter.querySelector(`[data-lane="${id}"]`)
  if (!b || !el) return
  el.classList.remove("thin")
  el.innerHTML = `<input value="${esc(b.name)}" aria-label="Timeline name" maxlength="40">`
  const input = el.querySelector("input")
  input.focus()
  input.select()
  let done = false
  const finish = (save) => {
    if (done) return
    done = true
    const v = input.value.trim()
    if (save && v) b.name = v
    invalidateGutter()
    input.remove()
  }
  input.addEventListener("keydown", (e) => {
    e.stopPropagation()
    if (e.key === "Enter") finish(true)
    if (e.key === "Escape") finish(false)
  })
  input.addEventListener("blur", () => finish(true))
}

async function deleteTimeline(id) {
  const b = branchById(id)
  if (!b || !b.parentId) return false
  const doomed = new Set([id])
  for (let grew = true; grew; ) {
    grew = false
    for (const x of D.branches) {
      if (x.parentId && doomed.has(x.parentId) && !doomed.has(x.id)) {
        doomed.add(x.id)
        grew = true
      }
    }
  }
  // Standing on it? Step back onto its parent first (that restores the
  // parent's code too). If that didn't happen, delete nothing.
  if (doomed.has(D.activeId) && !(await switchTo(b.parentId, b.forkAt))) return false
  D.branches = D.branches.filter((x) => !doomed.has(x.id))
  D.notes = D.notes.filter((n) => !doomed.has(n.branchId))
  D.markers = D.markers.filter((m) => !doomed.has(m.branchId))
  return true
}

// ---- keys -----------------------------------------------------------------------

const typing = (el) => el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)

// Returns true if the key was the dock's. fromApp: handed over by a view-only
// app (its fields can't be typed in then, so a key in one is still the dock's).
function dockKey(e, fromApp) {
  if (e.metaKey || e.ctrlKey || (!fromApp && typing(e.target))) return false
  const s = D.last
  if (!s || !s.started) return false
  if (e.code === "Space" || (e.altKey && e.code === "KeyP")) {
    togglePlay()
    return true
  }
  if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
    stepBy(e.key === "ArrowRight" ? 1 : -1, e.shiftKey)
    return true
  }
  if (e.altKey && e.code === "KeyT") {
    setCollapsed(!D.collapsed)
    return true
  }
  if (e.altKey) return false
  if (e.code === "KeyF") {
    fitAll()
    return true
  }
  if (e.key === "+" || e.key === "=") {
    newTimelineAt(shownTime(s))
    return true
  }
  if (e.code === "KeyM") {
    addFlag()
    return true
  }
  return false
}
