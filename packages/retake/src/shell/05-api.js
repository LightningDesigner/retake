// What the dock asks the runtime, through one door. The runtime's own
// timeline() / clipAt() / isInteractive() are used when it has them
// (CONTRACT.md). With an older runtime the same answers are derived from what
// it does have (activity() and history()), so the dock always has something
// true to draw.
const MARKER_KINDS = { pointerdown: "click", click: "click", keydown: "key", input: "input", submit: "submit", popstate: "route", hashchange: "route" }

let timelineMemo = { at: -1, key: "", value: null }

function derivedTimeline(pt, s) {
  const h = pt.history()
  const markers = []
  for (const ev of h.events || []) {
    const kind = MARKER_KINDS[ev.type]
    if (!kind || ev.t < s.start) continue
    // One marker per click, not per pointerdown/click pair.
    if (ev.type === "click" && markers.some((m) => m.kind === "click" && Math.abs(m.t - ev.t) < 60)) continue
    markers.push({ t: ev.t, kind, label: kind === "key" ? ev.key || "" : "" })
  }
  // Each animation the runtime drove, from its debug log; failing that, the
  // merged bands of activity().
  let clips = []
  try {
    clips = pt.debug().anims.map((a, i) => ({
      id: "a" + i,
      start: a.vStart,
      end: a.vEnd == null || a.vEnd === 0 ? (a.state === "running" ? null : a.vStart) : a.vEnd,
      kind: "animation",
      label: a.target ? String(a.target) : "animation",
      selector: a.target && /^[\w-]+$/.test(a.target) ? "#" + a.target : "",
    }))
  } catch {
    const act = pt.activity ? pt.activity() : { bands: [] }
    clips = act.bands.map(([a, b], i) => ({ id: "band" + i, start: a, end: b, kind: "animation", label: "animation", selector: "" }))
  }
  const vp = h.viewport || null
  return { now: s.now, end: s.end, viewport: vp, markers, clips, derived: true }
}

// Cached for a few frames; timeline() walks the whole recording.
function timeline() {
  const pt = D.PT
  const s = D.last
  if (!pt || !s) return { now: 0, end: 0, viewport: null, markers: [], clips: [] }
  const key = `${D.activeId}:${s.end}:${s.now}:${s.seeking}`
  const now = performance.now()
  if (timelineMemo.value && timelineMemo.pt === pt && (timelineMemo.key === key || now - timelineMemo.at < 120)) return timelineMemo.value
  let value
  try {
    value = typeof pt.timeline === "function" ? pt.timeline() : derivedTimeline(pt, s)
  } catch (err) {
    value = timelineMemo.value || { now: s.now, end: s.end, viewport: null, markers: [], clips: [] }
  }
  value.markers = value.markers || []
  value.clips = value.clips || []
  timelineMemo = { at: now, key, value, pt }
  return value
}

// The clip playing at t (on an element, if given): { clip, offset } or null.
function clipAt(t, selector) {
  const pt = D.PT
  if (pt && typeof pt.clipAt === "function") {
    try {
      return pt.clipAt(t, selector) || null
    } catch {}
  }
  const end = (c) => (c.end == null ? (D.last ? D.last.end : t) : c.end)
  const all = timeline().clips.filter((c) => c.start <= t && t <= end(c))
  const pick = (selector && all.find((c) => c.selector && c.selector === selector)) || all[all.length - 1]
  return pick ? { clip: pick, offset: t - pick.start } : null
}

// Can the user act in the app right now? Only at the live edge. In the past
// the app is view-only, like a paused video.
function isInteractive(s = D.last) {
  const pt = D.PT
  if (pt && typeof pt.isInteractive === "function") {
    try {
      return !!pt.isInteractive()
    } catch {}
  }
  if (!s || !s.started) return true
  return !!s.playing && !s.future && !s.previewing
}

function setToolActive(on) {
  const pt = D.PT
  if (pt && typeof pt.setToolActive === "function") {
    try {
      pt.setToolActive(!!on)
    } catch {}
  }
}

// Play: from the past it replays, and at the end it's live again.
function play() {
  const pt = D.PT
  const s = state()
  if (!pt || !s) return
  if (typeof pt.play === "function") return pt.play()
  // (A seek to exactly where it is doesn't move, so nudge it a millisecond.)
  if (s.previewing) return pt.seek(Math.min(s.previewAt + 1, s.end), true)
  if (s.future) return pt.seek(Math.min(s.now + 1, s.end), true)
  pt.record()
}
function togglePlay() {
  const s = state()
  if (!D.PT || !s) return
  if (s.playing) D.PT.pause()
  else play()
}
