// Moving through time. Press anywhere on the ruler or the active lane and drag:
// the playhead follows, snapping to clip edges and markers within 8px (hold
// alt to move freely). Dragging back shows the past live; letting go builds
// that moment for real. Keys: ← → a frame, shift+← → the previous or next
// edge, space play/pause, F fit all, + a new timeline from here.

const SNAP_PX = 8
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
// through recorded future. commitScrub() then builds a past moment for real.
function scrubTo(t) {
  const pt = D.PT
  if (!pt) return
  let s
  try {
    s = pt.state()
  } catch {
    return
  }
  if (t < s.now - 1) pt.preview(t, D.scopeEl)
  else {
    if (s.previewing) pt.endPreview()
    if (t > s.now + 1 && s.future) pt.seek(t)
  }
}
function commitScrub() {
  const pt = D.PT
  if (!pt) return
  const s = pt.state()
  // A scoped preview stays a picture until you act on it.
  if (s.previewing && !D.scopeEl) pt.seek(s.previewAt)
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

const shownTime = (s) => (D.dragT != null ? D.dragT : D.keyT != null ? D.keyT : s.previewing ? s.previewAt : s.now)

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
    commitScrub()
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
  D.dragT = clamp(snapped(timeAt(e.clientX), s, e.altKey), lo, hi)
  D.hoverT = null
  D.hoverX = null
  hideTip()
  scrubSoon(D.dragT)
}

function endScrub() {
  plusPress = null
  if (D.dragT == null) return
  const t = D.dragT
  D.dragT = null
  D.snapT = null
  document.body.classList.remove("scrubbing")
  if (!D.PT) return
  pendingT = null
  scrubTo(t)
  commitScrub()
}

track.addEventListener("pointerdown", (e) => {
  const s = D.last
  if (!D.PT || !s || !s.started || e.button !== 0) return
  if (e.target === plus || e.target.closest("[data-note]")) return
  menuEl.hidden = true
  const lane = e.target.closest("[data-branch]")
  if (lane && !lane.dataset.active) {
    const b = branchById(Number(lane.dataset.branch))
    if (b) switchTo(b.id, clamp(timeAt(e.clientX), b.forkAt, b.end)).then((ok) => ok || flash("Couldn't switch to that timeline"))
    return
  }
  const bm = e.target.closest("[data-bookmark]")
  if (bm) {
    const m = D.markers.find((x) => String(x.id) === bm.dataset.bookmark)
    if (m) {
      scrubTo(m.t)
      commitScrub()
    }
    return
  }
  startScrub(e, s)
})

// The + sits on the lane, so a press on it that moves is a drag along the
// lane (scrubbing), and only a click makes a new timeline.
let plusPress = null
plus.addEventListener("pointerdown", (e) => {
  if (e.button === 0) plusPress = { x: e.clientX, dragged: false }
})

track.addEventListener("pointermove", (e) => {
  const s = D.last
  if (!s || !s.started) return
  const g = geom()
  if (plusPress && !plusPress.dragged && e.buttons & 1 && Math.abs(e.clientX - plusPress.x) > 4) {
    plusPress.dragged = true
    return startScrub(e, s)
  }
  if (D.dragT != null) {
    const [lo, hi] = bounds(s)
    D.dragT = clamp(snapped(timeAt(e.clientX, g), s, e.altKey), lo, hi)
    scrubSoon(D.dragT)
    return
  }
  if (e.target === plus) return
  D.hoverX = r1(e.clientX - g.left) + 0.5
  hover(e, s, g)
})
track.addEventListener("pointerup", endScrub)
track.addEventListener("pointercancel", endScrub)
track.addEventListener("pointerleave", () => {
  if (D.dragT != null) return
  D.hoverX = null
  if (!plusHeld) D.hoverT = null
  hideTip()
  setHot(null)
})
let plusHeld = false
plus.addEventListener("pointerenter", () => (plusHeld = true))
plus.addEventListener("pointerleave", () => (plusHeld = false))

// Hovering: a tooltip for clips, markers and folded lanes; on the active lane
// in the past, a + to start a new timeline there.
function hover(e, s, g) {
  const band = e.target.closest && e.target.closest("[data-band]")
  const mark = e.target.closest && e.target.closest("[data-mark]")
  const lane = e.target.closest && e.target.closest("[data-branch]")
  const tl = timeline()
  if (mark) {
    const m = tl.markers[Number(mark.dataset.mark)]
    setHot({ kind: "mark", i: Number(mark.dataset.mark) })
    if (m) showTip(e, g, `<span class="k">${esc(MARK_WORD[m.kind] || m.kind)}</span>${m.label ? " " + esc(m.label) : ""} <span class="n">${fmt(m.t - s.start)}</span>`)
  } else if (band) {
    const i = Number(band.dataset.band)
    setHot({ kind: "band", i })
    if (D.bands && D.bands[i]) showTip(e, g, bandLabel(D.bands[i], tl, s))
  } else if (lane && !lane.dataset.active) {
    setHot(null)
    showTip(e, g, "Click to select")
  } else {
    setHot(null)
    hideTip()
  }
  // The + follows the pointer along the active lane (and only that one), and
  // snaps to the playhead when it's close: that's where you'd most often start.
  const A = D.lanes && D.lanes.get(D.activeId)
  const y = e.clientY - g.top
  if (!A || Math.abs(y - A.y) > 6) {
    if (!plusHeld) D.hoverT = null
    return
  }
  const [lo, hi] = bounds(s)
  const shown = shownTime(s)
  const t = clamp(timeAt(e.clientX, g), lo, hi)
  D.hoverT = Math.abs(t - shown) * pxPerMs(g) <= SNAP_PX ? shown : snapped(t, s, e.altKey)
  D.snapT = null
}

const MARK_WORD = { click: "Click", key: "Key", input: "Typing", submit: "Submit", route: "Route", fetch: "Fetch", reload: "Reload" }

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

// An animation block's tooltip: what was animating in it (name, element,
// duration), a few lines at most.
function bandLabel(band, tl, s) {
  const rows = band.clips.slice(0, 5).map((i) => {
    const c = tl.clips[i]
    if (!c) return ""
    const dur = c.end == null ? "running" : msWord(c.end - c.start)
    const where = clipComponent(c) || c.selector || ""
    return `<div class="row"><b>${esc(clipName(c))}</b>${where ? `<span>${esc(where)}</span>` : ""}<span class="n">${dur}</span></div>`
  })
  const more = band.clips.length > 5 ? `<div class="more">+${band.clips.length - 5} more</div>` : ""
  return `<div class="k">${band.clips.length} animation${band.clips.length > 1 ? "s" : ""}</div>${rows.join("")}${more}`
}

function setHot(h) {
  D.hot = h
}
// Below the pointer, so it never covers the ruler; above only when there's
// no room below (and then never higher than the ruler's bottom edge).
function showTip(e, g, html) {
  tip.innerHTML = html
  tip.hidden = false
  const w = tip.offsetWidth
  const h = tip.offsetHeight
  const y = e.clientY - g.top
  tip.style.left = clamp(e.clientX - g.left, w / 2 + 4, g.w - w / 2 - 4) + "px"
  tip.style.top = (y + 12 + h <= g.h - 2 ? y + 12 : Math.max(RULER + 2, y - 10 - h)) + "px"
}
function hideTip() {
  tip.hidden = true
}

let plusClick = null
plus.addEventListener("click", (e) => {
  e.stopPropagation()
  const dragged = plusPress && plusPress.dragged
  plusPress = null
  if (dragged) return
  if (plusClick) {
    clearTimeout(plusClick.timer)
    const t = plusClick.t
    plusClick = null
    fitBandAt(t)
    return
  }
  if (D.hoverT == null) return
  const t = D.hoverT
  plusClick = {
    t,
    timer: setTimeout(() => {
      plusClick = null
      D.hoverT = null
      newTimelineAt(t)
    }, 220),
  }
  D.hoverX = null
  plusHeld = false
  setHot(null)
  hideTip()
})

// Double-click an animation block: fit it. A block sits under the active
// lane's +, so the + waits a moment before branching: a second click in that
// time fits the block instead.
function fitBandAt(t) {
  const band = (D.bands || []).find((b) => b.a - 5 <= t && t <= b.b + 5)
  if (!band) return false
  fitRange(band.a, band.b)
  return true
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
  const el = e.target.closest("[data-branch]")
  const b = el && branchById(Number(el.dataset.branch))
  if (b) openLaneMenu(e, b)
  else e.preventDefault()
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
  if (!menuEl.hidden && !e.target.closest("#wb-menu")) menuEl.hidden = true
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

// Returns true if the key was the dock's.
function dockKey(e) {
  if (e.metaKey || e.ctrlKey || typing(e.target)) return false
  const s = D.last
  if (!s || !s.started) return false
  if (e.code === "Space") {
    togglePlay()
    return true
  }
  if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
    stepBy(e.key === "ArrowRight" ? 1 : -1, e.shiftKey)
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
