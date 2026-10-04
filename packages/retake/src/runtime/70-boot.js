// Boot. The prototype runs inside the dock's frame; `shell` is the dock in the
// parent window. A rewind leaves the history with the shell and reloads this
// frame, so on boot we either pick that up or begin a fresh history.

const shell = (() => {
  try {
    return W.parent !== W && W.parent.__retakeShell ? W.parent.__retakeShell : null
  } catch {
    return null
  }
})()

// A full reload of this frame (Vite's full-reload after an edit HMR can't
// apply, or the app calling location.reload()) keeps the recording: on the way
// out it's left on the shell object, keyed by our iframe element, and picked
// up here. A frame the dock is replacing (removed from the page) leaves nothing.
function takeResume() {
  try {
    const r = shell && shell.__resume
    if (r && r.frame === W.frameElement) {
      shell.__resume = null
      return r.payload
    }
  } catch {}
  return null
}
const pending = (shell && shell.take()) || takeResume()
// Time doesn't start until state is in place (IndexedDB is async).
let stateReady
// Set when this page is about to reload itself into another segment's URL.
let handingOff = false
if (pending && (pending.reloaded || pending.continue)) {
  // The app reloaded (or navigated) itself mid-recording: a fresh page, so a
  // new segment of the recording starts here, at this URL, with the storage
  // as it is now. Nothing is replayed; later rebuilds to a moment in this
  // segment start from here too.
  rec = readRec(pending.rec)
  /** @type {Record<string, any>} */
  const seg = {
    t: pending.target,
    ev: rec.events.length,
    fr: rec.frames.length,
    url: location.href,
    storage: { local: snapshotStorage(real.local), session: snapshotStorage(real.session) },
    cookies: snapshotCookies(),
    seed: (rec.seed ^ Math.imul((rec.segments || []).length + 1, 0x85ebca6b)) >>> 0,
    ...(RT.docId ? { doc: RT.docId } : {}), // the front server's kept copy of this page (F56)
  }
  ;(rec.segments || (rec.segments = [])).push(seg)
  // A route marker for where the timeline carried on (a reload, or the URL
  // the user opened the dock at).
  const shown = location.pathname + location.search.replace(/([?&])__wb=app&?/, "$1").replace(/[?&]$/, "") + location.hash
  ;(rec.routes || (rec.routes = [])).push({ t: seg.t, path: shown })
  if (pending.continue) rec.reloads = [...(rec.reloads || []), seg.t]
  clock.now = seg.t
  cursor.event = seg.ev
  cursor.frame = seg.fr
  clock.rate = pending.rate || 1
  stateReady = withIDBGate(async () => {
    const snap = await snapshotIDB()
    if (snap) seg.idb = snap
  })
} else if (pending) {
  rec = readRec(pending.rec)
  const seg = segmentAt(pending.target)
  if (seg.url && sameDocUrl(seg.url) === false) {
    // This moment lives in a segment that started on another URL: go there
    // (the payload rides along on the shell), and rebuild from that page.
    handingOff = true
    try {
      shell.__resume = { frame: W.frameElement, payload: pending, handoff: true }
    } catch {}
    askStoredDoc(seg.doc, seg.url)
    location.replace(seg.url)
  }
  // (If handing off, this page is going away: its clock never starts.)
  // Web storage, cookies and IndexedDB go back to how they were when this
  // segment began (the recording's start, or the reload that began it).
  restoreStorage(real.local, seg.storage.local)
  restoreStorage(real.session, seg.storage.session)
  restoreCookies(seg.cookies)
  stateReady = handingOff ? new Promise(() => {}) : seg.idb != null ? withIDBGate(() => restoreIDB(seg.idb)) : Promise.resolve()
  if (seg.t > 0) {
    clock.now = seg.t
    cursor.event = seg.ev
    cursor.frame = seg.fr
  }
  clock.rate = pending.rate || 1
} else {
  rec = newRecording()
  // Recording is always on from page load (CONTRACT.md).
  rec.start = 0
  rec.cookies = snapshotCookies()
  stateReady = withIDBGate(async () => {
    const snap = await snapshotIDB()
    if (snap) rec.idb = snap // empty too: a replay then clears databases made later
  })
}
epoch = rec.epoch
seedRandom(pending ? segmentAt(clock.now).seed : rec.seed)
// This frame's app is the one about to run: the origin's storage is its own
// now (a rebuild has just put it back to its segment's start).
if (shell && !handingOff) shell.storageOwner = storageId

// Record starts the timeline, or resumes it from where it last got to.
function record() {
  if (previewing) endPreview()
  // Back in time? Record carries on from the end of this timeline, not here.
  if (hasFuture()) return seek(rec.end, play)
  if (rec.start == null) rec.start = clock.now
  play()
}

Object.assign(PT, {
  version: "0.5.4",
  now: () => clock.now,
  record,
  // Play from here: replays the recorded future, then carries on live.
  play: () => {
    if (previewing) endPreview()
    play()
  },
  pause,
  preview,
  endPreview,
  // Going to a moment ends a live preview first (the dock does this itself,
  // but API and MCP callers shouldn't have to).
  seek: (t, andPlay) => {
    if (rec.start == null) return false
    if (previewing) endPreview()
    return seek(Math.max(t, rec.start), andPlay ? play : undefined)
  },
  // Build the moment for real in a new frame (the dock's rebuild), leaving
  // whatever this frame shows (a preview of that moment) as it is meanwhile.
  buildAt(t) {
    if (rec.start == null) return false
    rewind(Math.max(t, rec.start), false)
    return true
  },
  // A frame built (or being built) to one moment goes on to a later one on
  // the same page instead of the dock starting another: before it boots, while
  // it replays, or once it's there. False if it can't (that moment is behind
  // where it has got to, or after a reload).
  retarget(t) {
    if (!pending || pending.reloaded || pending.continue || previewing || clock.playing) return false
    t = Math.max(t, rec.start ?? 0)
    const at = !clock.booted ? pending.target : (seekTarget ?? clock.now)
    if (segmentIndex(t) !== segmentIndex(at)) return false
    if (!clock.booted) {
      pending.target = t // boot() reads it
      return true
    }
    if (t < clock.now) return false
    if (seekTarget != null) {
      seekTarget = t // runSeek reads it at every frame
      return true
    }
    seek(t)
    return true
  },
  // Do a and b show exactly the same thing? Same page, under 50ms apart, and
  // nothing recorded in between: no frame boundary in (lo, hi], no input in [lo, hi).
  sameMoment(a, b) {
    if (a == null || b == null) return false
    const lo = Math.min(a, b)
    const hi = Math.max(a, b)
    if (hi - lo >= 50 || segmentIndex(lo) !== segmentIndex(hi)) return false
    const fr = rec.frames
    let i = 0
    let j = fr.length
    while (i < j) {
      const m = (i + j) >> 1
      if (fr[m] <= lo) i = m + 1
      else j = m
    }
    if (i < fr.length && fr[i] <= hi) return false
    const ev = rec.events
    i = 0
    j = ev.length
    while (i < j) {
      const m = (i + j) >> 1
      if (ev[m].t < lo) i = m + 1
      else j = m
    }
    return !(i < ev.length && ev[i].t < hi)
  },
  // The scrolling the user did to look while paused, and taking it on from
  // the frame this one replaces (see viewScroll in 40-input).
  viewScroll,
  applyView,
  // Which build this frame is (the dock's number, through the stash); a frame
  // that reloaded itself mid-build has none, and isn't swapped in.
  buildId: (pending && pending.buildId) || null,
  // Start a new branch at this moment, even if nothing lies ahead yet.
  // The new timeline starts paused at this moment; recording into it starts
  // when the user presses Play.
  forkHere() {
    pause()
    if (hasFuture()) return fork()
    if (shell && rec.start != null) shell.branchOff(JSON.stringify(rec), rec.end, clock.now)
  },
  isPaused: () => !clock.playing,
  // The recording as JSON, built in idle slices (~8ms each) so saving a long
  // session never blocks a frame. Same format as JSON.stringify(history()).
  async serialize() {
    const r = rec
    const n = r.events.length
    const pk = packer(r)
    const idleWait = () => new Promise((res) => (real.idle ? real.idle(res, { timeout: 100 }) : real.setTimeout(res, 0)))
    const parts = []
    let slice = real.perfNow()
    for (let i = 0; i < n; i += 1000) {
      const chunk = []
      for (let j = i; j < Math.min(n, i + 1000); j++) chunk.push(pk.event(r.events[j]))
      const str = JSON.stringify(chunk)
      if (str.length > 2) parts.push(str.slice(1, -1))
      if (real.perfNow() - slice > 8) {
        await idleWait()
        slice = real.perfNow()
      }
    }
    // Tables are complete once every event (and clip) has been packed.
    const head = pk.head("__EVENTS__")
    return JSON.stringify(head).replace('"__EVENTS__"', () => "[" + parts.join(",") + "]")
  },
  // Checkpoint frames: build in idle slices (true) or at full speed (false).
  setBackground(on) {
    background = !!on
  },
  // Stop a seek in progress where it is (e.g. a checkpoint build the user overtook).
  cancelSeek() {
    if (seekTarget == null) return false
    seekTarget = clock.now
    afterSeek = null
    return true
  },
  // fn({ playing, now }) whenever play state changes; returns an unsubscribe.
  onPlayState(fn) {
    playListeners.add(fn)
    return () => playListeners.delete(fn)
  },
  setRate,
  history: () => rec,
  activity,
  // Jump into another branch's history (a JSON string from history()).
  load: (json, t) => rewind(t, false, json),
  // Checkpoints: a frame already rebuilt to some moment can take a newer copy
  // of the same recording (one that only grew after that moment) and seek
  // forward in place, instead of a rebuild from zero. Returns false (and
  // changes nothing) if the recording doesn't continue this frame's past.
  adopt(json, t, andPlay) {
    const no = (why) => {
      PT.adoptRefused = why
      return false
    }
    let next
    try {
      next = readRec(json)
    } catch {
      return no("not JSON")
    }
    if (!next || clock.seeking || previewing) return no("busy")
    if (!storageOk()) return no("another frame has changed this app's IndexedDB since")
    if (next.seed !== rec.seed || next.epoch !== rec.epoch) return no("a different recording")
    if (next.events.length < cursor.event || next.frames.length < cursor.frame) return no("shorter than this frame's past")
    const same = (a, b) => a === b || (!!a && !!b && a.t === b.t && a.type === b.type)
    for (let i = Math.max(0, cursor.event - 64); i < cursor.event; i++) if (!same(next.events[i], rec.events[i])) return no(`event ${i} differs`)
    if (cursor.frame && next.frames[cursor.frame - 1] !== rec.frames[cursor.frame - 1]) return no("frames differ")
    if (t < clock.now) return no("that moment is behind this frame")
    if (segmentIndex(t, next) !== segmentIndex(clock.now, next)) return no("that moment is after a reload")
    PT.adoptRefused = null
    rec = next
    seek(t, andPlay ? play : undefined)
    PT.emit()
    return true
  },
  state: () => ({
    recording: rec.start != null && clock.playing,
    booted: clock.booted,
    started: rec.start != null,
    previewing,
    previewAt,
    route: previewing ? routeAt(previewAt) : null, // the app's route at the moment previewed (its own location doesn't change)
    start: rec.start ?? 0,
    now: clock.now,
    end: Math.max(rec.end, clock.now),
    target: seekTarget,
    playing: clock.playing,
    seeking: clock.seeking,
    rate: clock.rate,
    future: hasFuture(),
    // This document's page: where it starts on the timeline (a preview can't
    // show earlier), and where the next page starts (null: none).
    docStart: segmentAt(clock.now).t,
    segEnd: nextSegmentStart(),
    from: seekFrom, // where the current (or last) seek started
    storageOk: storageOk(), // this frame can run its app as it is (see takeStorage)
    idb: usesIDB(),
    buildId: PT.buildId,
  }),
  timeline,
  clipAt,
  clipsFor,
  cssSourceFor,
  isInteractive,
  setToolActive,
  debug: () => ({
    ...stats,
    activity: { ...actStats },
    appMessages,
    timers: timers.size,
    dom: domLog.length,
    anims: animLog.map((e) => ({ target: e.target.id || e.target.getAttribute("class"), vStart: Math.round(e.vStart), vEnd: e.vEnd && Math.round(e.vEnd), state: stateOf(e.anim), kf: e.keyframes.length, fill: e.timing.fill })),
  }),
})

function nextSegmentStart() {
  for (const s of rec.segments || []) if (s.t > clock.now) return s.t
  return null
}

// Alt+P record/pause while focus is inside the prototype. A frame built behind
// the one on show (or parked as a checkpoint) can have the window's focus (its
// replay focused a field), but it must never run by itself: there, the key is
// the dock's Play/Pause, as if pressed in the dock.
PT.shortcut = function (e) {
  if (!e.altKey || e.metaKey || e.ctrlKey || e.code !== "KeyP") return false
  e.preventDefault()
  e.stopImmediatePropagation()
  if (e.type !== "keydown" || e.repeat) return true
  if (!onShow()) {
    try {
      shell.key(e)
    } catch {}
    return true
  }
  clock.playing && rec.start != null ? pause() : record()
  return true
}
// Is this the frame the dock shows? (Without a dock, or one that can't say: yes.)
function onShow() {
  try {
    return !shell || typeof shell.shows !== "function" || !!shell.shows(W)
  } catch {
    return true
  }
}

// The app navigating its frame to another of its pages (location.href = …)
// must stay in the time machine: the frame's marker (?__wb=app) is kept on
// the new URL, so that page gets the runtime and starts a new segment. (With
// the header marker the server knows the frame's navigations without it.)
try {
  if (W.navigation && shell && RT.marker !== "header") {
    W.navigation.addEventListener("navigate", (e) => {
      if (e.hashChange || !e.cancelable || e.downloadRequest || (e.destination && e.destination.sameDocument)) return
      const url = new URL(e.destination.url)
      if (url.origin !== location.origin || url.searchParams.get("__wb") === "app") return
      url.searchParams.set("__wb", "app")
      e.preventDefault()
      location.assign(url.href)
    })
  }
} catch {}

// A link or redirect to another site (GitHub, npm, a sign-in page) can't load
// inside the dock's frame: most sites refuse to be framed. A click the user
// makes opens it in a new tab, so the timeline stays; anything else (a
// redirect) goes to the top window, as it would without Retake. Frames being
// built or replayed never leave.
try {
  if (W.navigation && shell) {
    W.navigation.addEventListener("navigate", (e) => {
      if (!e.cancelable || e.downloadRequest || !e.destination) return
      const url = new URL(e.destination.url)
      if (url.origin === location.origin || !/^https?:$/.test(url.protocol)) return
      e.preventDefault()
      if (clock.seeking || !onShow()) return
      if (e.userInitiated) W.open(url.href, "_blank", "noopener")
      else W.top.location.assign(url.href)
    })
  }
} catch {}

// A reload (or navigation) fires beforeunload first; a frame the dock removes
// doesn't. Only a reload leaves its recording on the shell to resume.
let unloading = false
W.addEventListener("beforeunload", () => (unloading = true))
W.addEventListener("pagehide", () => {
  try {
    if (!unloading || handingOff || !shell || !rec || rec.start == null || clock.seeking) return
    const el = W.frameElement
    if (!el || !el.isConnected) return
    rec.reloads = [...(rec.reloads || []), clock.now]
    shell.__resume = { frame: el, payload: { rec: JSON.stringify(rec), target: clock.now, play: clock.playing, rate: clock.rate, reloaded: true } }
  } catch {}
})

function boot() {
  observe()
  // The page's own SVG animations (SMIL) run from the page's start.
  findSmil(document)
  syncSmil(clock.now, null, segmentAt(clock.now).t)
  if (shell) shell.attach(PT)
  // This window losing focus lets go of ⌘ (a ⌘-shortcut took it away), but
  // only the frame on show's: one built behind, or one being swapped out,
  // blurs on its own while ⌘ is still held (F99).
  if (shell)
    W.addEventListener("blur", () => {
      if (typeof shell.shows === "function" && !shell.shows(W)) return
      if (shell.meta) shell.meta(false)
    })
  // Let the first render settle on real frames before time starts moving.
  real.raf(() =>
    real.raf(async () => {
      await stateReady
      clock.booted = true
      if (pending) {
        seekTarget = pending.target
        afterSeek = pending.play ? play : null
      } else {
        play()
      }
    }),
  )
}

// When the clock starts. At DOMContentLoaded (the Vite plugin's default) on
// an index.html app, whose scripts have all run by then. A server-rendered
// page streams most of its scripts in after that, live in real time but from
// the cache on a rebuild, so hydration landed at different virtual moments
// (F47): behind the front server (RT.bootAt "load") the clock starts at the
// window's load, when they've all run, live and rebuilt alike. A page that
// takes over 10s to load after DOMContentLoaded starts anyway (rec.bootCap).
// Then it waits until nothing has finished loading for BOOT_QUIET ms (at most
// BOOT_QUIET_CAP): a framework that imports its app after load (Nuxt's entry,
// Astro's islands: native import(), which can't be held, F48) mounted at +60
// to +300 ms live but before the clock started on a rebuild (from the cache),
// or after the replay had run past it (still loading), so every timer the app
// started on mount was off (F61). Now it has mounted before the clock starts,
// live and rebuilt alike.
const BOOT_CAP = 10000
const BOOT_QUIET = 150
const BOOT_QUIET_CAP = 3000
function whenQuiet(fn) {
  const start = real.perfNow()
  let last = start
  let po = null
  try {
    po = new PerformanceObserver(() => (last = real.perfNow()))
    po.observe({ type: "resource" })
  } catch {}
  const check = () => {
    const now = real.perfNow()
    if (now - last < BOOT_QUIET && now - start < BOOT_QUIET_CAP) return real.setTimeout(check, BOOT_QUIET - (now - last))
    if (po) po.disconnect()
    fn()
  }
  real.setTimeout(check, BOOT_QUIET)
}
function whenLoaded(fn) {
  if (RT.bootAt !== "load") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn, { once: true })
    else fn()
    return
  }
  if (document.readyState === "complete") return whenQuiet(fn)
  let done = false
  const go = () => {
    if (done) return
    done = true
    whenQuiet(fn)
  }
  W.addEventListener("load", go, { once: true })
  const cap = () =>
    real.setTimeout(() => {
      if (done) return
      console.warn(`[retake] this page took over ${BOOT_CAP / 1000}s to load; its clock starts before it has`)
      if (rec) rec.bootCap = (rec.bootCap || 0) + 1
      go()
    }, BOOT_CAP)
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", cap, { once: true })
  else cap()
}
whenLoaded(boot)
drive()
