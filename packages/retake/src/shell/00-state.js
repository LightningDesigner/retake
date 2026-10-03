// Shared pieces of the dock. The shell files are concatenated into one scope;
// everything they share that changes over time lives on `D`, so a file never
// reaches into another file's variables.
const $ = (s) => document.querySelector(s)
const KEY = "retake:"
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

const fabPos = (v) =>
  v && (v.side === "left" || v.side === "right") && Number.isFinite(v.y) ? { side: v.side, y: Math.min(1, Math.max(0, v.y)) } : { side: "right", y: 1 }

const D = {
  // frames
  frame: null, // the visible prototype frame
  PT: null, // its runtime (window.__retake inside it)
  // The one frame being built behind it (10-dock.js): { id, frame, pt, stash,
  // url, viewport, branchId, sig, target, play, fork, visible, startedAt, via,
  // restarts }. play / fork: do that once it's in. visible: nothing on screen
  // shows its moment, so the user is waiting for it (waits()).
  building: null,
  buildSeq: 0, // numbers builds (and checkpoints), so a frame that reloaded itself is told apart
  holdSwap: false, // tests: keep a finished build behind (it doesn't swap in)
  buildWatchdogMs: 10000, // a build whose page loaded without starting it is tried again after this (tests shorten it)
  cp: null, // a hidden paused frame at an earlier moment, to rewind from (12-checkpoint.js)
  last: null, // the last runtime state seen
  // timelines
  branches: [], // { id, name, forkAt, parentId, json, end, born, version }
  activeId: 0,
  branchSeq: 0,
  switching: false,
  frameBranch: 0, // the timeline the visible frame is playing
  // what's been said about them
  notes: [],
  markers: [], // bookmarks dropped with M: { id, t, branchId }
  markerSeq: 0,
  // pointer and tools
  dragT: null, // the time under the playhead while scrubbing
  dragX0: 0, // where the press was, and whether the pointer has moved off it (3px)
  dragMoved: false,
  frameNo: 0, // dock frames drawn (one direct scrub per frame)
  branchT: null, // where a Control-click on the track would branch
  hot: null, // what the pointer is over: { kind: "clip" | "mark", i }
  keyT: null, // where arrow keys have taken the playhead, until it's built
  snapT: null, // what the playhead snapped to while scrubbing
  lanes: null, // lane id → { y, thin }, from the last draw
  clipBars: [],
  picking: null, // "comment" | "select" | null
  metaHeld: false,
  scopeEl: null, // the element the Select tool scoped scrubbing to
  // dock size
  height: store.get("height", 200),
  collapsed: store.get("collapsed", false) === true, // folded into the corner button (10-dock.js)
  // Where that button sits: the side it's snapped to and how far down the
  // window (0 top … 1 bottom), so it stays put through a resize (10-dock.js).
  fab: fabPos(store.get("fab", null)),
  view: null, // the window of time on the timeline (20-timeline.js)
}

const fmt = (ms) => {
  const s = Math.max(0, ms) / 1000
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${(s % 60).toFixed(2).padStart(5, "0")}`
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c])
const clamp = (v, a, b) => Math.min(Math.max(v, a), b)

const activeBranch = () => D.branches.find((b) => b.id === D.activeId)
const branchById = (id) => D.branches.find((b) => b.id === id)

// Is the user waiting for this build (the readout says Building)?
const waits = (b) => !!b && !!(b.play || b.fork || b.visible)
// Do two moments of the active recording look exactly the same (no frame or
// input between them)? The runtime knows; an older one is asked for 1ms.
function samePlace(a, b) {
  if (a == null || b == null) return false
  try {
    if (D.PT && typeof D.PT.sameMoment === "function") return D.PT.sameMoment(a, b)
  } catch {}
  return Math.abs(a - b) < 1
}
