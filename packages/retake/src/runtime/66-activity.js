// How much of the screen changed, over time: a cheap waveform for the dock.
// Every 100ms of virtual time while recording, the on-screen boxes of running
// finite animations and of elements the DOM changed are painted onto a coarse
// grid over the viewport (so overlaps count once); the covered share is the
// raw value. A rolling median over the last ~5s is subtracted, so constant
// ambient motion (spinners, pulsing dots) trends to 0 and real changes spike.
// No screenshots, no pixel diffs. Samples live in the recording
// (rec.activity), so replays and seeks never recompute them.

const ACT_STEP = 100
const ACT_BASE = 50 // samples in the rolling median (~5s)
const GRID_W = 32
const GRID_H = 20
const ACT_MAX_ELS = 150
const actGrid = new Uint8Array(GRID_W * GRID_H)
let actDomAt = 0
let actRaw = [] // recent raw values, for the baseline
const actStats = { samples: 0, ms: 0, max: 0 }

function markRect(r, vw, vh) {
  if (!r || r.width <= 0 || r.height <= 0) return
  const x0 = Math.max(0, Math.floor((r.left / vw) * GRID_W))
  const x1 = Math.min(GRID_W - 1, Math.floor(((r.right - 0.01) / vw) * GRID_W))
  const y0 = Math.max(0, Math.floor((r.top / vh) * GRID_H))
  const y1 = Math.min(GRID_H - 1, Math.floor(((r.bottom - 0.01) / vh) * GRID_H))
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) actGrid[y * GRID_W + x] = 1
}

function rawActivity() {
  const vw = W.innerWidth || 1
  const vh = W.innerHeight || 1
  actGrid.fill(0)
  const els = new Set()
  // (a) running, finite animations and transitions
  for (const [a, st] of managed) {
    if (st.done || st.userPaused) continue
    const timing = a.effect && a.effect.getTiming ? a.effect.getTiming() : null
    if (!timing || timing.iterations === Infinity) continue
    const t = a.effect.target
    if (t && t.nodeType === 1) els.add(t)
  }
  // (b) elements the DOM changed since the last sample
  if (observer && !previewing) logMutations(observer.takeRecords())
  let removedFrom = null
  for (let i = actDomAt; i < domLog.length && els.size < ACT_MAX_ELS; i++) {
    const e = domLog[i]
    if (e.kind === "attr") els.add(e.node)
    else if (e.kind === "text") e.node.parentElement && els.add(e.node.parentElement)
    else {
      for (const n of e.added) if (n.nodeType === 1) els.add(n)
      else if (n.parentElement) els.add(n.parentElement)
      // Something left: the space it took was its container's.
      if (e.removed.length) (removedFrom || (removedFrom = new Set())).add(e.node)
    }
  }
  actDomAt = domLog.length
  if (removedFrom) for (const n of removedFrom) if (n.nodeType === 1 && n !== document.body && n !== document.documentElement) els.add(n)
  for (const el of els) {
    if (!el.isConnected || el.nodeType !== 1) continue
    markRect(el.getBoundingClientRect(), vw, vh)
  }
  let covered = 0
  for (let i = 0; i < actGrid.length; i++) covered += actGrid[i]
  return covered / actGrid.length
}

function median(arr) {
  if (!arr.length) return 0
  const s = arr.slice().sort((a, b) => a - b)
  return s[s.length >> 1]
}

// Called at each frame boundary. Takes a sample for every 100ms window the
// clock has passed through, while recording at the live edge.
function sampleActivity() {
  if (!rec || clock.seeking || hasFuture() || previewing) {
    actDomAt = domLog.length // what a replay does isn't new activity
    return
  }
  const a = rec.activity || (rec.activity = { start: Math.floor(clock.now / ACT_STEP) * ACT_STEP, step: ACT_STEP, v: [] })
  const due = Math.floor((clock.now - a.start) / ACT_STEP)
  if (a.v.length >= due) return
  const t0 = real.perfNow()
  const raw = rawActivity()
  actRaw.push(raw)
  if (actRaw.length > ACT_BASE) actRaw = actRaw.slice(-ACT_BASE)
  const v = Math.max(0, raw - median(actRaw))
  a.v.push(Math.round(v * 100))
  while (a.v.length < due) a.v.push(0) // windows skipped in one jump
  const ms = real.perfNow() - t0
  actStats.samples++
  actStats.ms += ms
  if (ms > actStats.max) actStats.max = ms
}

let activityOut = null
function activitySamples() {
  const a = rec.activity
  if (!a) return []
  if (activityOut && activityOut.n === a.v.length && activityOut.start === a.start) return activityOut.value
  const value = a.v.map((v, i) => ({ t: a.start + i * a.step, v: v / 100 }))
  // The same data as { step, values, t0 } too (the dock's waveform reads that).
  value.step = a.step
  value.t0 = a.start
  value.values = a.v.map((v) => v / 100)
  activityOut = { n: a.v.length, start: a.start, value }
  return value
}

// Cutting the future at a fork drops its samples too.
function cutActivity(t) {
  const a = rec.activity
  if (a) a.v.length = Math.max(0, Math.min(a.v.length, Math.floor((t - a.start) / a.step)))
}
