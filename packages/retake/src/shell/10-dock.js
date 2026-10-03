// The dock. Lives in the top window; the prototype runs in a frame on the
// stage above it, with the time runtime inside. Going to another moment builds
// it in a second frame behind the visible one (invisible, one at a time) and
// swaps it in when it's ready, so there's no flash; going back, the visible
// frame previews the moment meanwhile (goTo() in 25-input.js).
const stage = $("#wb-stage")
const dock = $("#wb-dock")
const track = $(".track")
const cv = $(".lines") // the timeline canvas

// Timelines are "Timeline 1", "Timeline 2"... until the user renames one.
const defaultName = (id) => `Timeline ${id}`
// Older sessions named them "Main" and "Take N": those defaults
// (and only those) read as the new ones.
const migratedName = (b) => (b.name === (b.id === 1 ? "Main" : `Take ${b.id}`) ? defaultName(b.id) : b.name)
const newBranch = (forkAt, parentId = null) => {
  const id = ++D.branchSeq
  const b = { id, name: defaultName(id), forkAt, parentId, json: null, end: forkAt, born: performance.now() }
  D.branches.push(b)
  return b
}
function resetBranches() {
  D.branches = []
  D.branchSeq = 0
  D.activeId = newBranch(0).id
}
resetBranches()

// The Vite plugin knows the dock's frame by `?__wb=app` in its URL. Behind the
// front server (marker "header") the URL stays the app's own: the server knows
// a frame by its Sec-Fetch-Dest, and the runtime by isAppFrame() below.
const MARKER = (window.__retakeConfig && window.__retakeConfig.marker) || "url"
const appUrl = (() => {
  const u = new URL(location.href)
  if (MARKER !== "header") u.searchParams.set("__wb", "app")
  return u.pathname + u.search + u.hash
})()
// Every frame the dock makes (the one on show, one being built, checkpoints).
const appFrames = new WeakSet()

// A static build has no server to tell `?__wb=app` from the dock's own page,
// so it ships the app as a file of its own and the frame always loads that.
const APP_PAGE = window.__retakeConfig && window.__retakeConfig.appPage

function makeFrame(src, stash) {
  if (APP_PAGE) {
    const u = new URL(src, location.href)
    u.pathname = APP_PAGE
    src = u.pathname + u.search + u.hash
  }
  const f = document.createElement("iframe")
  appFrames.add(f)
  f.title = "Prototype"
  f.className = "building"
  if (stash) f.__retakeStash = stash
  f.src = src
  stage.prepend(f)
  return f
}

const frameRuntime = (f) => {
  try {
    return f.contentWindow.__retake || null
  } catch {
    return null
  }
}

// The frame built behind takes the visible one's place, in one task: it shows
// the moment the old one was previewing, scrolled where the user had it, so
// nothing on screen moves (a page with a canvas, whose pixels the preview
// couldn't take back, fades in over 120ms).
function swapIn(b) {
  const f = b.frame
  const pt = b.pt
  const old = D.frame && D.frame !== f ? D.frame : null
  // What the user scrolled to look at, copied into this window (the old frame
  // is going) and taken by the new one in its own (no frame keeps another alive).
  // Only into a moment of a recording: a fresh frame (Start fresh) is a live
  // page recording from its first moment, where a scroll it didn't record
  // would be lost on the next rebuild.
  let view = []
  try {
    if (old && b.target != null && D.PT && typeof D.PT.viewScroll === "function") view = JSON.parse(JSON.stringify(D.PT.viewScroll()))
  } catch {}
  // Built at the recorded size; the visible frame fills the stage again.
  f.style.width = f.style.height = ""
  try {
    if (view.length && typeof pt.applyView === "function") pt.applyView(view)
  } catch {}
  f.className = "live"
  f.removeAttribute("aria-hidden")
  // The new frame is the one on show before the old one goes: the old one
  // blurs as it's removed, which must not read as ⌘ let go (F99).
  D.frame = f
  D.PT = pt
  if (old) {
    let canvas = false
    try {
      canvas = !!old.contentDocument.querySelector("canvas")
    } catch {}
    if (canvas) {
      f.dataset.enter = ""
      old.className = "leaving"
      setTimeout(() => old.remove(), 140)
      setTimeout(() => delete f.dataset.enter, 200)
    } else old.remove()
  }
  D.frameBranch = b.branchId != null ? b.branchId : D.activeId
  D.building = null
  window.__retakeShell.rebuilding = false
  D.scopeEl = null // an element of the old frame
  noteBuilt(b)
  hookFrameKeys(f.contentWindow)
  // A tool that's on stays on, in the new frame, over what's under the pointer.
  syncPicking()
  if (b.fork) forkNow()
  else if (b.play) pt.play()
}

window.__retakeShell = {
  rebuilding: false,
  storageOwner: null, // which frame's app last ran (see takeStorage in the runtime)
  fastReplay: true, // false: every replay settle is a full task round trip (a kill switch)
  // The runtime hands over keys it blocks in the view-only past (or that a
  // frame built behind got because its replay focused a field). True if the
  // dock used it.
  key(e) {
    try {
      return dockKey(e, true)
    } catch {
      return false
    }
  },
  // Did the dock make this iframe? The injected runtime asks before it runs
  // (an iframe the app embeds gets `__retake = { inert: true }`).
  isAppFrame(el) {
    return !!el && appFrames.has(el)
  },
  // Is this window the frame on show? (One built behind, a checkpoint or one
  // fading out isn't: its keys are the dock's, ⌥P too.)
  shows(win) {
    try {
      return !!D.frame && D.frame.contentWindow === win
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
        mine = "__retakeStash" in f && !!f.contentWindow.__retake
      } catch {}
      if (!mine) continue
      const p = f.__retakeStash
      delete f.__retakeStash
      return p
    }
    return null
  },
  attach(pt) {
    const b = D.building
    const cp = D.cp
    if (b && b.frame && frameRuntime(b.frame) === pt) {
      // A frame that reloaded itself mid-build (a Vite full reload) comes back
      // as something else: build it again, never swap that in.
      if (b.id != null && pt.buildId !== b.id) return restartBuild(b)
      b.pt = pt
      try {
        if (b.target != null && typeof pt.retarget === "function") pt.retarget(b.target)
        if (typeof pt.setBackground === "function") pt.setBackground(D.dragT != null || D.keyT != null)
      } catch {}
      return
    }
    if (cp && frameRuntime(cp.frame) === pt) {
      if (cp.id != null && pt.buildId !== cp.id) return dropCheckpoint()
      cp.pt = pt
      try {
        if (typeof pt.setBackground === "function") pt.setBackground(true)
      } catch {}
      return
    }
    if (!D.frame || frameRuntime(D.frame) === pt) {
      // The frame on show started again (it reloaded itself under a preview):
      // the page it shows now is the truth, and its recording has grown, so a
      // moment of this timeline being built behind is out of date.
      if (D.PT && D.PT !== pt && b && b.target != null && b.branchId === D.frameBranch) cancelBuild()
      D.PT = pt
      if (D.frame) hookFrameKeys(D.frame.contentWindow)
    }
  },
  // Build a moment (a history and a time) in a frame behind the visible one,
  // swap it in when it's ready. There's only ever one: a request for the
  // moment already building keeps it, a later moment of the same recording on
  // the same page moves it on (retarget), anything else replaces it.
  rebuild(payload) {
    const b = D.building
    const sameRec = !!b && b.target != null && b.branchId === D.activeId && payload.sig != null && b.sig === payload.sig
    if (sameRec && samePlace(b.target, payload.target)) {
      b.play = b.play || !!payload.play
      b.visible = true // asked for directly (the API): the dock's goTo() says otherwise if a preview shows it
      return
    }
    if (sameRec && retargetBuild(b, payload.target)) {
      b.via = "retarget"
      b.play = !!payload.play
      b.visible = true
      return
    }
    cancelBuild()
    // A frame built behind never plays by itself: the dock plays it once it's
    // in (Play pressed meanwhile can be taken back).
    const play = !!payload.play
    payload = { ...payload, play: false }
    if (useCheckpoint(payload)) {
      Object.assign(D.building, { play, fork: false, visible: true, sig: payload.sig != null ? payload.sig : null })
      return
    }
    // Copied into this window: the payload object was made in the old frame,
    // and the new frame keeps what take() gives it for its whole life, so
    // passing it on would keep every earlier frame alive in a chain.
    const stash = own(payload)
    stash.buildId = ++D.buildSeq
    let rec = null
    const parsed = () => rec || (rec = JSON.parse(payload.rec))
    // The page the target moment was on (the runtime says, per segment).
    const u = new URL(payload.url || urlAt(parsed(), payload.target), location.href)
    // Replay at the size it was recorded at, or layout, media queries and
    // virtual lists come out differently (F18).
    const vp = okViewport(stash.viewport) || recordedViewport(parsed())
    window.__retakeShell.rebuilding = true
    // It's built for whichever timeline is active now (a switch sets that
    // before it loads the target's recording).
    D.building = {
      id: stash.buildId,
      frame: null,
      pt: null,
      stash,
      url: u.pathname + u.search + u.hash,
      viewport: vp,
      branchId: D.activeId,
      sig: payload.sig != null ? payload.sig : null,
      target: payload.target,
      play,
      fork: false,
      visible: true,
      startedAt: performance.now(),
      via: "replay",
      restarts: 0,
    }
    startBuildFrame(D.building)
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
    flash(`${b.name} started`, { warn: false })
  },
}

// The page a recording was on at t: its segment's (each reload or navigation
// of the app starts one), else where it began.
function urlAt(rec, t) {
  let url = rec.url
  for (const n of rec.segments || rec.navs || []) if (n.t <= t && n.url) url = new URL(n.url, rec.url).href
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
const okViewport = (v) => (v && v.w > 0 && v.h > 0 ? { w: v.w, h: v.h } : null)
function recordedViewport(rec) {
  if (okViewport(rec.viewport)) return okViewport(rec.viewport)
  try {
    const v = D.PT && D.PT.timeline && D.PT.timeline().viewport
    if (okViewport(v)) return okViewport(v)
  } catch {}
  return null
}

// Behind the front server (config.docs) every page the frame loads is kept as
// it came, and a build asks for the copy its recording was made on with a
// one-shot cookie (the server takes it out as it serves it), so a server whose
// data or clock has moved on doesn't change the rebuilt page (F56).
const DOCS = !!(window.__retakeConfig && window.__retakeConfig.docs)
function askStoredDoc(doc, url) {
  if (!DOCS || !doc || !/^[0-9a-f]{16}$/.test(doc)) return
  try {
    document.cookie = `__retake_doc=${doc}; path=${new URL(url, location.href).pathname}; max-age=10; samesite=strict`
  } catch {}
}

// The frame for a build (again, after a restart), hidden behind the visible one.
function startBuildFrame(b) {
  askStoredDoc(b.stash && b.stash.doc, b.url)
  b.frame = makeFrame(b.url, b.stash)
  b.frame.setAttribute("aria-hidden", "true")
  if (b.viewport) {
    b.frame.style.width = b.viewport.w + "px"
    b.frame.style.height = b.viewport.h + "px"
  }
  b.pt = null
  b.startedAt = performance.now()
}

// Does the frame on show (its state vs) show the moment build b is making:
// previewing it, or standing at it (a build of its own recording: an API seek,
// or a frame whose IndexedDB another frame has changed since)?
function showsMoment(vs, b) {
  if (!vs || b.branchId !== D.frameBranch) return false
  if (vs.previewing) return samePlace(vs.previewAt, b.target)
  return b.sig != null && !vs.seeking && vs.target == null && samePlace(vs.now, b.target)
}

// Which page (segment) of the active recording a moment is on.
function segOf(t) {
  let i = 0
  try {
    for (const s of D.PT.history().segments || []) if (s.t <= t) i++
  } catch {}
  return i
}

// Move the build in flight on to t, if it can get there (same page, not
// past it already). Before its runtime starts that's just a new target in
// the stash it will take (if the dock can tell it's the same page: it's the
// recording on show); after, the runtime decides (PT.retarget).
function retargetBuild(b, t) {
  if (!b.frame) return false
  if (!b.pt) {
    if (!b.stash || b.sig == null || segOf(t) !== segOf(b.target)) return false
    b.stash.target = b.target = t
    return true
  }
  let ok = false
  try {
    ok = typeof b.pt.retarget === "function" && !!b.pt.retarget(t)
  } catch {}
  if (ok) b.target = t
  return ok
}

// The same build from the start in a new frame (its frame reloaded itself,
// never started, or ran by itself). Twice at most.
function restartBuild(b) {
  if (D.building !== b) return
  if (b.restarts >= 2 || (!b.stash && !(b.target != null && b.branchId === D.frameBranch && D.PT && typeof D.PT.buildAt === "function"))) {
    cancelBuild()
    flash("Couldn't build that moment")
    return
  }
  if (!b.stash) {
    // A checkpoint's frame (there's no stash to start it from again): the
    // frame on show asks for the moment afresh, and the user's wishes carry over.
    const { target, play, fork, restarts } = b
    cancelBuild()
    try {
      D.PT.buildAt(target)
    } catch {}
    const nb = D.building
    if (nb && nb !== b) Object.assign(nb, { play, fork, restarts: restarts + 1 })
    return
  }
  b.restarts++
  try {
    b.frame.remove()
  } catch {}
  b.stash = { ...own(b.stash), target: b.target, buildId: b.id }
  startBuildFrame(b)
}

// A build whose frame hasn't started after a while (D.buildWatchdogMs): a page
// that finished loading without starting it (an error page, a page without the
// runtime) never will. One still loading (a slow module script, a cold dev
// server optimizing its dependencies) is left to load, unless it takes
// absurdly long.
const BUILD_GIVE_UP = 60000
function buildStalled(b) {
  const waited = performance.now() - b.startedAt
  if (waited <= D.buildWatchdogMs) return false
  let doc = null
  try {
    doc = b.frame.contentDocument
  } catch {}
  if (!doc) return true // not this app's page any more (another origin, an error page)
  if (doc.readyState === "complete" && doc.URL !== "about:blank") return true
  return waited > BUILD_GIVE_UP
}

// Drop the build in flight (and a checkpoint still being built: one frame
// runs the app at a time). A checkpoint that's ready stays.
function cancelBuild() {
  if (D.cp && !checkpointReady(D.cp)) dropCheckpoint()
  const b = D.building
  if (!b) return
  D.building = null
  window.__retakeShell.rebuilding = false
  if (b.frame && b.frame !== D.frame) b.frame.remove()
}

// A fresh prototype: no history.
function freshFrame() {
  cancelBuild()
  dropCheckpoint()
  D.building = { id: null, frame: makeFrame(appUrl), pt: null, branchId: D.activeId, target: null, play: false, fork: false, visible: true, startedAt: performance.now(), via: "fresh", restarts: 0 }
  window.__retakeShell.rebuilding = true
}

// The first frame is opened by restore() (15-session.js) once it knows what
// was saved: always at the page the user asked for, live, never a rebuild.
function openFirstFrame(stash, branchId) {
  if (D.frame) return
  D.frame = makeFrame(appUrl, stash)
  D.frame.className = "live"
  D.frameBranch = branchId
}

// Each dock frame: keep the build in flight honest, and swap it in once it's
// at its moment. Unless the user is waiting for it, that also waits for
// nothing to be in hand: a drag, a key step, a note being written, a picking
// tool, a scoped preview (they all point into the frame on show).
function checkBuilding() {
  const b = D.building
  if (!b) return
  let vs = null
  try {
    vs = D.PT && D.PT.state()
  } catch {}
  if (b.target != null) {
    // Built for a timeline we've since left.
    if (b.branchId !== D.activeId) return cancelBuild()
    // The frame on show runs its app again (played, ⌥P, an in-place seek
    // somewhere; not one just stopped for a preview): that's where the user
    // is now, not this moment.
    if (vs && (vs.playing || (vs.seeking && vs.target != null && vs.target > vs.now))) return cancelBuild()
    // The Select tool scoped a preview: it stays a picture.
    if (D.scopeEl && !waits(b)) return cancelBuild()
  }
  // Is the moment on screen meanwhile (the frame on show previews it, or is
  // at it)? If not (the preview was ended from elsewhere, or it's on an
  // earlier page), the user is waiting for it.
  if (b.target != null && D.dragT == null && D.keyT == null) b.visible = !showsMoment(vs, b)
  if (!b.pt) {
    if (buildStalled(b)) restartBuild(b)
    return
  }
  let s
  try {
    s = b.pt.state()
  } catch {
    return
  }
  // A moment built behind never runs by itself (only the dock plays a frame,
  // once it's in): one that does has left its moment. Build it again. (A fresh
  // frame does: it records from its first moment.)
  if (b.target != null && s.playing) {
    try {
      b.pt.pause()
    } catch {}
    return restartBuild(b)
  }
  if (!s.booted || s.seeking || s.target != null) return
  if (b.target != null && !samePlace(s.now, b.target)) return
  if (D.holdSwap) return
  if (!waits(b) && (D.dragT != null || D.keyT != null || composing() || mode() || D.scopeEl)) return
  if (frameRuntime(b.frame) !== b.pt) return // it reloaded itself; attach() starts it again
  swapIn(b)
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
  D.markers.push({ id: ++D.markerSeq, t: shownTime(s), branchId: D.activeId })
}

// Keep the address bar and title in step with the prototype's own route (the
// route at the moment previewed, while a preview is on show).
setInterval(() => {
  try {
    const inner = new URL(D.frame.contentWindow.location.href)
    inner.searchParams.delete("__wb")
    const s = D.PT && D.PT.state()
    const next = (s && s.previewing && s.route) || inner.pathname + inner.search + inner.hash
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
  D.frameNo++
  checkBuilding()
  dropStaleResume()
  tendCheckpoint()
  guardFocus()
  // The active timeline can vanish under us (a delete racing a switch); stand
  // on the first one rather than draw nothing.
  if (!activeBranch()) D.activeId = D.branches[0].id
  const s = state()
  const dh = dockHeight()
  dock.style.height = dh + "px"
  document.body.style.setProperty("--dock-h", dh + "px")
  tellDock(D.collapsed ? 0 : dh)
  if (!s || !D.frame) return
  autoStart(s)
  if (D.perfNoDraw) return // (perf measurements: the runtime alone)
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
  renderFocusOverlay(s)
  if (D.collapsed && fab.dataset.phase !== readoutPhase.dataset.phase) fab.dataset.phase = readoutPhase.dataset.phase
}

// The app is full-window under the dock. So that it can leave room, the frame
// on show gets `window.__retakeDockHeight` (the px the dock covers at the
// bottom, 0 when folded) and a `retake:dock` event ({ detail: { height } })
// whenever that changes.
function tellDock(height) {
  try {
    const win = /** @type {any} */ (D.frame && D.frame.contentWindow)
    if (!win || win.__retakeDockHeight === height) return
    win.__retakeDockHeight = height
    win.dispatchEvent(new win.CustomEvent("retake:dock", { detail: { height } }))
  } catch {}
}

// A frame built behind can take the window's focus (its replay focused a
// field). If the user was typing in the dock (a note, a timeline's name),
// they get it back.
let dockField = null
document.addEventListener("focusin", (e) => {
  const el = /** @type {HTMLElement | null} */ (e.target)
  if (el && (el.tagName === "TEXTAREA" || el.tagName === "INPUT" || el.isContentEditable)) dockField = el
})
function guardFocus() {
  if (!dockField) return
  const a = document.activeElement
  if (a === dockField) return
  if (dockField.isConnected && a && a.tagName === "IFRAME" && (a.classList.contains("building") || a.classList.contains("checkpoint"))) {
    try {
      dockField.focus({ preventScroll: true })
      return
    } catch {}
  }
  dockField = null
}

// A frame that reloads itself leaves shell.__resume for its next document.
// A frame we removed can leave one too (pagehide runs as it goes), and that
// object, made in its realm, would keep the whole old window alive.
function dropStaleResume() {
  const r = window.__retakeShell.__resume
  if (r && (!r.frame || !r.frame.isConnected)) window.__retakeShell.__resume = null
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
  if (!block) {
    if (wasBlocked) restoreFocus()
    else noteFocus(D.frame)
  }
  wasBlocked = block
}
// Pausing takes focus off the app's field (clicking the dock alone does);
// playing again gives it back, with the caret where it was. Remembered while
// the app is interactive, and only given back to that same document: a
// rebuilt frame's focus is its replay's business.
let wasBlocked = false
let lastFocus = null
function noteFocus(frame) {
  try {
    const doc = frame && frame.contentDocument
    const el = doc && doc.activeElement
    // Focus on the page itself: the user left the field (keep what we had
    // only if focus went out to the dock instead).
    if (!el || el === doc.body) {
      if (doc.hasFocus()) lastFocus = null
      return
    }
    lastFocus = { frame, doc, el, sel: typeof el.selectionStart === "number" ? [el.selectionStart, el.selectionEnd] : null }
  } catch {}
}
function restoreFocus() {
  const f = lastFocus
  lastFocus = null
  try {
    if (!f || f.frame !== D.frame || f.frame.contentDocument !== f.doc || !f.el.isConnected) return
    D.frame.focus()
    f.el.focus({ preventScroll: true })
    if (f.sel && f.el.setSelectionRange) f.el.setSelectionRange(f.sel[0], f.sel[1])
  } catch {}
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
  const target = /** @type {Element} */ (e.target)
  const b = /** @type {HTMLButtonElement | null} */ (target.closest("button, [data-branch], [data-note]"))
  // A press on the track while writing a note (the element row, a range, the
  // playhead) keeps the note open.
  const held = D.focusHold
  D.focusHold = false
  if (!b) {
    if (!target.closest(".card") && !(held && target.closest(".track"))) closeCard()
    return
  }
  const a = b.dataset.a
  if (a === "expand") return setCollapsed(false)
  if (a === "play") togglePlay()
  if (a === "fresh") return startFresh()
  if (a === "undo") return undoFresh()
  if (a === "live") return followLive()
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
const MIN_H = 96
const DEFAULT_H = 200
// Never so short that the lanes (at their closest) don't fit under the ruler.
const minDockHeight = () => Math.max(MIN_H, 56 + 24 + D.branches.length * 10 + 16)
const dockHeight = () => {
  const min = minDockHeight()
  return Math.round(clamp(D.height, min, Math.max(min, innerHeight * 0.7)))
}

// Resize by dragging the top edge, like docked DevTools. Below the minimum
// height the dock keeps following the pointer: it slides down (a transform, so
// neither its layout nor the app's changes mid-drag) all the way off the edge.
// Let go far enough down and it settles into the corner icon; anywhere higher
// it springs back up to the minimum.
const divider = $(".divider")
divider.addEventListener("pointerdown", (e) => {
  divider.setPointerCapture(e.pointerId)
  document.body.classList.add("dragging")
  const startY = e.clientY
  const startH = dock.offsetHeight
  const min = minDockHeight()
  let fold = false
  let lastY = startY
  let raf = 0
  // One write per frame, whatever the pointer's rate.
  const paint = () => {
    raf = 0
    const want = startH + startY - lastY
    D.height = Math.round(clamp(want, min, innerHeight * 0.7))
    const drop = clamp(min - want, 0, min + 24)
    fold = drop > min / 2 || lastY >= innerHeight - FOLD_EDGE
    dock.style.transform = drop ? `translateY(${drop}px)` : ""
    dock.classList.toggle("will-collapse", fold)
  }
  const move = (ev) => {
    lastY = ev.clientY
    if (!raf) raf = requestAnimationFrame(paint)
  }
  // A touch the browser takes back (pointercancel) ends the drag too, or the
  // app would stay unclickable under body.dragging.
  const up = (ev) => {
    for (const type of ["pointermove", "pointerup", "pointercancel", "lostpointercapture"]) divider.removeEventListener(type, type === "pointermove" ? move : up)
    if (raf) cancelAnimationFrame(raf)
    if (ev.type !== "pointercancel" && ev.type !== "lostpointercapture") {
      lastY = ev.clientY
      paint()
    }
    // From where the finger left it: on into the icon, or back up.
    document.body.classList.remove("dragging")
    dock.classList.remove("will-collapse")
    dock.style.transform = ""
    store.set("height", D.height)
    if (fold && ev.type !== "pointercancel") setCollapsed(true)
  }
  divider.addEventListener("pointermove", move)
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) divider.addEventListener(type, up)
})

// Folded: the timeline is a round button (bottom-right at first) and the app
// has the whole window. It keeps recording; the button (or ⌥T) brings the dock
// back at its default height. Remembered across reloads.
const FOLD_EDGE = 48 // px from the bottom edge: let go there and it folds
const fab = $("#wb-fab")
function applyCollapsed() {
  document.body.classList.toggle("collapsed", D.collapsed)
  fab.hidden = !D.collapsed
  dock.inert = D.collapsed
  if (D.collapsed) placeFab()
}

// The button can be dragged anywhere (mouse or finger). Past a few px it's a
// drag, not a click; let go and it eases to the nearer side edge. Where it is
// (`D.fab`: that side, and how far down) is stored, so a reload or a resized
// window puts it back in the same place, always fully on screen.
const FAB_SIZE = 44
const FAB_MARGIN = 16
const FAB_SLOP = 5 // px a press may move and still be a click
let fabDragged = false // the press that just ended was a drag: not a click
// The notch and the home bar (viewport-fit=cover), measured once per layout.
const safeProbe = document.createElement("div")
safeProbe.style.cssText =
  "position:fixed;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)"
document.body.appendChild(safeProbe)
function fabBounds() {
  const cs = getComputedStyle(safeProbe)
  const left = FAB_MARGIN + (parseFloat(cs.paddingLeft) || 0)
  const top = FAB_MARGIN + (parseFloat(cs.paddingTop) || 0)
  const right = Math.max(left, innerWidth - FAB_SIZE - FAB_MARGIN - (parseFloat(cs.paddingRight) || 0))
  const bottom = Math.max(top, innerHeight - FAB_SIZE - FAB_MARGIN - (parseFloat(cs.paddingBottom) || 0))
  return { left, top, right, bottom }
}
function moveFab(x, y) {
  fab.style.left = Math.round(x) + "px"
  fab.style.top = Math.round(y) + "px"
}
function placeFab() {
  const b = fabBounds()
  moveFab(D.fab.side === "left" ? b.left : b.right, b.top + D.fab.y * (b.bottom - b.top))
}
applyCollapsed()
addEventListener("resize", () => D.collapsed && !fab.classList.contains("moving") && placeFab())

fab.addEventListener("pointerdown", (e) => {
  fabDragged = false
  if (e.button !== 0) return
  const r = fab.getBoundingClientRect()
  const grabX = e.clientX - r.left
  const grabY = e.clientY - r.top
  const x0 = e.clientX
  const y0 = e.clientY
  let moving = false
  fab.setPointerCapture(e.pointerId)
  const move = (ev) => {
    if (!moving && Math.hypot(ev.clientX - x0, ev.clientY - y0) < FAB_SLOP) return
    if (!moving) {
      moving = true
      fab.classList.remove("snapping")
      fab.classList.add("moving")
    }
    const b = fabBounds()
    moveFab(clamp(ev.clientX - grabX, b.left, b.right), clamp(ev.clientY - grabY, b.top, b.bottom))
  }
  const up = () => {
    for (const type of ["pointermove", "pointerup", "pointercancel"]) fab.removeEventListener(type, type === "pointermove" ? move : up)
    if (!moving) return
    fabDragged = true
    fab.classList.remove("moving")
    // Where it was let go (its left/top: the rect would include the lift's scale).
    const b = fabBounds()
    const x = parseFloat(fab.style.left) || 0
    const y = parseFloat(fab.style.top) || 0
    D.fab = {
      side: x + FAB_SIZE / 2 < innerWidth / 2 ? "left" : "right",
      y: b.bottom > b.top ? clamp((y - b.top) / (b.bottom - b.top), 0, 1) : 1,
    }
    store.set("fab", D.fab)
    fab.classList.add("snapping")
    placeFab()
    setTimeout(() => fab.classList.remove("snapping"), 400)
  }
  fab.addEventListener("pointermove", move)
  fab.addEventListener("pointerup", up)
  fab.addEventListener("pointercancel", up)
})
// The click that ends a drag doesn't open the dock.
fab.addEventListener(
  "click",
  (e) => {
    if (!fabDragged) return
    fabDragged = false
    e.stopPropagation()
    e.preventDefault()
  },
  true,
)
function setCollapsed(on) {
  if (on === D.collapsed) return
  const hadFocus = on ? dock.contains(document.activeElement) : document.activeElement === fab
  if (on) {
    setPicking(null)
    closeCard()
  } else {
    D.height = DEFAULT_H
    store.set("height", D.height)
  }
  D.collapsed = on
  store.set("collapsed", on)
  applyCollapsed()
  if (hadFocus) (on ? fab : playBtn).focus({ preventScroll: true })
}

window.addEventListener("keydown", (e) => {
  if (e.key === "Meta") return window.__retakeShell.meta(true)
  // The corner button is a real button: Enter and Space press it.
  if (e.target === fab && (e.key === "Enter" || e.code === "Space")) return
  // Not while typing in the dock (a note, a timeline's name): ⌥T types there († on a Mac).
  if (e.altKey && e.code === "KeyT" && !typing(e.target)) {
    e.preventDefault()
    return setCollapsed(!D.collapsed)
  }
  // Tab with the dock's window focused cycles what's under the pointer, as in the app.
  if (e.key === "Tab" && !e.metaKey && mode() && !typing(e.target) && layers.length > 1) {
    e.preventDefault()
    return cycleLayer(e.shiftKey ? -1 : 1)
  }
  if (e.key === "Escape") {
    // An open clip closes first, then a selected range, then the note.
    if (closeFocusClip() || clearRange()) return
    setPicking(null)
    closeCard()
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
window.addEventListener("keyup", (e) => e.key === "Meta" && setMeta(false))
// The dock's window losing focus lets go of ⌘, unless the focus only went
// into the app's frame (whose own blur, if it goes, says so).
window.addEventListener("blur", () => {
  const a = document.activeElement
  if (a && a.tagName === "IFRAME") return
  window.__retakeShell.meta(false)
})
