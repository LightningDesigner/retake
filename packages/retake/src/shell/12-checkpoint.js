// Checkpoints. Going back in time rebuilds the moment from the start of the
// recording, which on a heavy app takes a while (the app renders every
// recorded frame again). So after a slow rewind to t, while you look around
// in the past, a hidden paused frame is built at a moment a little before t.
// The next rewind to anywhere at or after it (same timeline, same code) hands
// that frame the recording (PT.adopt) and it only seeks forward from there.
// Using it spends it; another is built once things are quiet again.

const CP_BACK = 2000 // how far behind the last rewind the checkpoint sits
const CP_QUIET = 1000 // ms of no rebuilding before one is started
D.cpMinMs = 1200 // only for apps whose rebuilds take at least this long

let lastBuild = null // { ms, target, branchId, at }

// A rebuild just finished: remember how long it took and where it went.
// (An app whose replays are slow stays "heavy": a rewind a checkpoint made
// quick still wants the next checkpoint.)
function noteBuilt(b) {
  if (!b || b.target == null || b.startedAt == null) return
  const ms = performance.now() - b.startedAt
  if (!b.via && ms >= D.cpMinMs) D.heavy = true
  lastBuild = { heavy: !!D.heavy, target: b.target, branchId: b.branchId, at: performance.now() }
  D.lastRebuild = { ms: Math.round(ms), via: b.via || "replay" }
}

function dropCheckpoint() {
  if (!D.cp) return
  D.cp.frame.remove()
  D.cp = null
}

// Each frame: drop a checkpoint that no longer fits, start one when it's
// worth it and quiet.
function tendCheckpoint() {
  const cp = D.cp
  const active = activeBranch()
  if (cp && (cp.branchId !== D.activeId || cp.version !== (active && active.version))) dropCheckpoint()
  if (D.cp || D.building || !lastBuild || !D.PT || D.switching) return
  if (!lastBuild.heavy || lastBuild.branchId !== D.activeId) return
  if (performance.now() - lastBuild.at < CP_QUIET) return
  const s = D.last
  if (!s || !s.started || s.seeking || s.previewing || isInteractive(s)) return
  let json
  try {
    json = JSON.stringify(D.PT.history())
  } catch {
    return
  }
  const at = Math.max(s.start, lastBuild.target - CP_BACK)
  const url = new URL(JSON.parse(json).url)
  const frame = makeFrame(url.pathname + url.search + url.hash, { rec: json, target: at, play: false, rate: 1 })
  frame.className = "checkpoint"
  frame.setAttribute("aria-hidden", "true")
  frame.tabIndex = -1
  const vp = recordedViewport(JSON.parse(json))
  if (vp) {
    frame.style.width = vp.w + "px"
    frame.style.height = vp.h + "px"
  }
  D.cp = { frame, pt: null, at, branchId: D.activeId, version: active && active.version }
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

// Called for every rewind: true if the checkpoint took it.
function useCheckpoint(payload) {
  const cp = D.cp
  if (!cp || cp.branchId !== D.activeId || payload.target < cp.at || !checkpointReady(cp) || typeof cp.pt.adopt !== "function") return false
  let ok = false
  try {
    ok = cp.pt.adopt(String(payload.rec), Number(payload.target), !!payload.play)
  } catch {}
  D.cp = null
  if (!ok) {
    cp.frame.remove()
    return false
  }
  cp.frame.className = "building"
  cp.frame.removeAttribute("aria-hidden")
  window.__waybackShell.rebuilding = true
  D.building = { frame: cp.frame, pt: cp.pt, branchId: D.activeId, target: payload.target, startedAt: performance.now(), via: "checkpoint" }
  return true
}
