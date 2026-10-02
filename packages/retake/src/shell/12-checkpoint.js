// Checkpoints. Going back in time rebuilds the moment from the start of its
// page, which on a heavy app takes a while (the app renders every recorded
// frame again). So after a slow rewind to t, while you look around in the
// past, a hidden paused frame is built (in idle time) at a moment a little
// before t. The next rewind to anywhere at or after it (same timeline, same
// code) hands that frame the recording (PT.adopt) and it only seeks forward
// from there. Using it spends it; another is built once things are quiet again.
// Only one frame runs the app at a time: a checkpoint still being built stops
// when anything else needs to run (quietCheckpoint), and none is made for an
// app that keeps state in IndexedDB (another frame's replay would change it
// under the visible one, see storageOk in the runtime).

const CP_BACK = 1500 // how far behind the last rewind the checkpoint sits
const CP_QUIET = 300 // ms of no rebuilding before one is started
D.cpMinMs = 150 // only for apps whose replays (of the last rebuild) take at least this long

let lastBuild = null // { target, branchId, at }

// A rebuild just finished: remember how long its replay took and where it went.
// (An app whose replays are slow stays "heavy": a rewind a checkpoint made
// quick still wants the next checkpoint.)
function noteBuilt(b) {
  if (!b || b.target == null || b.startedAt == null) return
  const ms = performance.now() - b.startedAt
  let seekMs = null
  try {
    seekMs = b.pt.debug().seekMs
  } catch {}
  if (b.via !== "checkpoint" && (seekMs != null ? seekMs : ms) >= D.cpMinMs) D.heavy = true
  lastBuild = { target: b.target, branchId: b.branchId, at: performance.now() }
  D.lastRebuild = { ms: Math.round(ms), seekMs, via: b.via || "replay" }
}

function dropCheckpoint() {
  if (!D.cp) return
  D.cp.frame.remove()
  D.cp = null
}

// The frame on show is about to run its app (play, an in-place seek): a
// checkpoint still being built stops. A ready one is paused and stays.
function quietCheckpoint() {
  if (D.cp && !checkpointReady(D.cp)) dropCheckpoint()
}

// Each frame: drop a checkpoint that no longer fits, start one when it's
// worth it and quiet.
function tendCheckpoint() {
  const cp = D.cp
  const active = activeBranch()
  if (cp && (cp.branchId !== D.activeId || cp.version !== (active && active.version))) dropCheckpoint()
  // The frame on show runs its app again some other way (⌥P in the app, an
  // API seek): a checkpoint still being built stops.
  if (D.cp && D.last && (D.last.playing || D.last.seeking) && !checkpointReady(D.cp)) dropCheckpoint()
  if (D.cp || D.building || !lastBuild || !D.PT || D.switching || D.dragT != null || D.keyT != null) return
  if (!D.heavy || lastBuild.branchId !== D.activeId) return
  if (performance.now() - lastBuild.at < CP_QUIET) return
  const s = D.last
  if (!s || !s.started || s.seeking || s.previewing || s.playing || s.idb || isInteractive(s)) return
  let rec
  let json
  try {
    rec = D.PT.history()
    json = JSON.stringify(rec)
  } catch {
    return
  }
  // A little before the last rewind, on the page it was on.
  let page = 0
  for (const sg of rec.segments || []) if (sg.t <= lastBuild.target) page = sg.t
  const at = Math.max(s.start, page, lastBuild.target - CP_BACK)
  const url = new URL(urlAt(rec, at), location.href)
  let doc = rec.doc
  for (const sg of rec.segments || []) if (sg.t <= at) doc = sg.doc
  askStoredDoc(doc, url.href)
  const id = ++D.buildSeq
  const frame = makeFrame(url.pathname + url.search + url.hash, { rec: json, target: at, play: false, rate: 1, buildId: id })
  frame.className = "checkpoint"
  frame.setAttribute("aria-hidden", "true")
  frame.tabIndex = -1
  const vp = okViewport(rec.viewport) || recordedViewport(rec)
  if (vp) {
    frame.style.width = vp.w + "px"
    frame.style.height = vp.h + "px"
  }
  D.cp = { id, frame, pt: null, at, branchId: D.activeId, version: active && active.version }
  lastBuild = null
}

const checkpointReady = (cp) => {
  try {
    const s = cp.pt && cp.pt.state()
    return !!s && s.booted && s.target == null && !s.seeking
  } catch {
    return false
  }
}

// Called for every rewind: true if the checkpoint took it (it's the build in
// flight now, seeking forward from where it was parked).
function useCheckpoint(payload) {
  const cp = D.cp
  if (!cp || cp.branchId !== D.activeId || payload.target < cp.at || !checkpointReady(cp) || typeof cp.pt.adopt !== "function") return false
  let ok = false
  try {
    ok = cp.pt.adopt(String(payload.rec), Number(payload.target), false)
  } catch {}
  D.cp = null
  if (!ok) {
    cp.frame.remove()
    return false
  }
  cp.frame.className = "building"
  cp.frame.removeAttribute("tabindex")
  try {
    if (typeof cp.pt.setBackground === "function") cp.pt.setBackground(D.dragT != null || D.keyT != null)
  } catch {}
  window.__retakeShell.rebuilding = true
  D.building = { id: cp.id, frame: cp.frame, pt: cp.pt, stash: null, branchId: D.activeId, target: payload.target, play: false, fork: false, visible: true, startedAt: performance.now(), via: "checkpoint", restarts: 0 }
  return true
}
