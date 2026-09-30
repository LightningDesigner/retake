// Shared pieces of the dock. The shell files are concatenated into one scope;
// everything they share that changes over time lives on `D`, so a file never
// reaches into another file's variables.
const $ = (s) => document.querySelector(s)
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

const D = {
  // frames
  frame: null, // the visible prototype frame
  PT: null, // its runtime (window.__wayback inside it)
  building: null, // { frame, pt, viewport } being built behind it
  stash: null, // the payload the building frame takes on boot
  last: null, // the last runtime state seen
  // timelines
  branches: [], // { id, name, forkAt, parentId, json, end, born, version }
  activeId: 0,
  branchSeq: 0,
  switching: false,
  // what's been said about them
  notes: [],
  noteSeq: 0,
  markers: [], // bookmarks dropped with M: { id, t, branchId }
  markerSeq: 0,
  // pointer and tools
  dragT: null, // the time under the playhead while scrubbing
  hoverT: null, // where a + would start a new timeline
  picking: null, // "comment" | "select" | null
  metaHeld: false,
  scopeEl: null, // the element the Select tool scoped scrubbing to
  // dock size
  height: store.get("height", 150),
}

const fmt = (ms) => {
  const s = Math.max(0, ms) / 1000
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${(s % 60).toFixed(2).padStart(5, "0")}`
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c])
const clamp = (v, a, b) => Math.min(Math.max(v, a), b)

const activeBranch = () => D.branches.find((b) => b.id === D.activeId)
const branchById = (id) => D.branches.find((b) => b.id === id)
