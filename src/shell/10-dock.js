// The dock. Lives in the top window; the prototype runs in #wb-app above it,
// with the time runtime inside. The runtime attaches its controls here on boot
// and hands its history over when it reloads to go back in time.
//
// Branches: going back and acting again forks the timeline. The old future is
// kept as its own lane; click a lane to step into that branch.
const $ = (s) => document.querySelector(s)
const frame = $("#wb-app")
const dock = $("#wb-dock")
const track = $(".track")
const lanesEl = $(".lanes")
const activeEl = $(".active-lane")
const menu = $(".menu")
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

// Installed means on: there's no off switch.
const enabled = true
let height = store.get("height", 96)
let PT = null
let last = null // last state seen, shown while the frame reloads
let stash = null
let ghost = null

// Branches live for the session. The active one's history is inside the
// frame; the others keep a serialized copy here.
let branches = []
let activeId = 0
let branchSeq = 0
const newBranch = (forkAt, json = null, end = 0) => {
  const b = { id: ++branchSeq, name: `Timeline ${branchSeq}`, forkAt, json, end }
  branches.push(b)
  return b
}
function resetBranches() {
  branches = []
  branchSeq = 0
  activeId = newBranch(0).id
}
const activeBranch = () => branches.find((b) => b.id === activeId)
resetBranches()

window.__waybackShell = {
  get enabled() {
    return enabled
  },
  stash(p) {
    stash = p
    if (last) last = { ...last, seeking: true, target: p.target }
  },
  take() {
    const p = stash
    stash = null
    return p
  },
  attach(pt) {
    PT = pt
    if (enabled !== PT.state().enabled) PT.setEnabled(enabled)
    pt.__unload = () => PT === pt && (PT = null)
    frame.contentWindow.addEventListener("pagehide", pt.__unload)
  },
  // The runtime is about to cut off its future at `at`: keep it as a branch.
  branchOff(json, end, at) {
    const old = activeBranch()
    old.json = json
    old.end = end
    activeId = newBranch(at).id
  },
}

let switching = false
async function switchTo(id, t) {
  const target = branches.find((b) => b.id === id)
  if (!PT || !target || !target.json || switching) return
  switching = true
  try {
    const cur = activeBranch()
    cur.json = JSON.stringify(PT.history())
    cur.end = PT.state().end
    // A branch made by a code change runs on its own version of the code.
    if (target.version && cur.version && target.version !== cur.version) await checkoutCode(target.version)
    activeId = id
    PT.load(target.json, Math.min(t, target.end))
  } finally {
    switching = false
  }
}

function removeBranch(id) {
  if (id === activeId) return
  branches = branches.filter((b) => b.id !== id)
}

const app = new URL(location.href)
app.searchParams.set("__wb", "app")
frame.src = app.pathname + app.search + app.hash

// Keep the address bar and title in step with the prototype's own route.
setInterval(() => {
  try {
    const inner = new URL(frame.contentWindow.location.href)
    inner.searchParams.delete("__wb")
    const next = inner.pathname + inner.search + inner.hash
    if (next !== location.pathname + location.search + location.hash) history.replaceState(null, "", next)
    if (frame.contentDocument.title) document.title = frame.contentDocument.title
  } catch {}
}, 400)

const fmt = (ms) => {
  const s = Math.max(0, ms) / 1000
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${(s % 60).toFixed(2).padStart(5, "0")}`
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c])
const ICON = {
  play: '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M8 5.5v13l11-6.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><rect x="6.5" y="5" width="4" height="14" rx="1"/><rect x="13.5" y="5" width="4" height="14" rx="1"/></svg>',
}

const state = () => {
  try {
    if (PT) last = PT.state()
  } catch {
    PT = null
  }
  return last
}
// One time axis shared by every lane.
const range = (s) => {
  const end = Math.max(s.end, ...branches.filter((b) => b.id !== activeId).map((b) => b.end))
  return { from: s.start, dur: Math.max(end - s.start, 1000) }
}
const frac = (s, t) => Math.min(Math.max(t - range(s).from, 0), range(s).dur) / range(s).dur
const pct = (s, t) => `${frac(s, t) * 100}%`

// Lane geometry: the active lane takes the most room, others are slim rows.
function layout() {
  const h = track.clientHeight - 8
  const n = branches.length
  const slim = n > 1 ? Math.max(10, Math.min(18, (h * 0.45) / (n - 1))) : 0
  const gap = 4
  const activeH = Math.max(14, h - (n - 1) * (slim + gap))
  let y = 4
  const rows = new Map()
  for (const b of branches) {
    const hgt = b.id === activeId ? activeH : slim
    rows.set(b.id, { top: y, height: hgt })
    y += hgt + gap
  }
  return rows
}

let lanesKey = ""
function render() {
  const s = state()
  const need = 64 + Math.max(0, branches.length - 1) * 22
  dock.style.height = Math.max(height, need) + "px"
  if (!s) return
  const busy = s.seeking || !PT
  dock.classList.toggle("busy", busy)
  const shown = busy && s.target != null ? s.target : s.now
  $(".time").textContent = fmt(shown - s.start)
  const playBtn = $(".play")
  playBtn.innerHTML = s.playing && !busy ? ICON.pause : ICON.play
  playBtn.setAttribute("aria-label", s.playing ? "Pause" : "Play")

  const rows = layout()
  const row = rows.get(activeId)
  activeEl.style.top = row.top + "px"
  activeEl.style.bottom = "auto"
  activeEl.style.height = row.height + "px"
  track.style.setProperty("--head-top", row.top - 2 + "px")
  track.style.setProperty("--head-bottom", `${track.clientHeight - row.top - row.height - 2}px`)
  // The active branch's own part starts where it forked.
  const fork = activeBranch().forkAt
  $(".band").style.left = branches.length > 1 ? pct(s, fork) : "0"
  $(".past").style.width = `${Math.max(0, frac(s, s.now) - frac(s, fork)) / Math.max(1e-6, 1 - frac(s, fork)) * 100}%`
  const futureLeft = frac(s, s.now)
  const futureRight = frac(s, s.end)
  $(".future").style.left = `${((futureLeft - frac(s, fork)) / Math.max(1e-6, 1 - frac(s, fork))) * 100}%`
  $(".future").style.width = s.future ? `${((futureRight - futureLeft) / Math.max(1e-6, 1 - frac(s, fork))) * 100}%` : "0"
  $(".head").style.left = pct(s, shown)
  const g = $(".ghost")
  g.style.display = ghost == null ? "none" : ""
  if (ghost != null) {
    g.style.left = pct(s, ghost)
    g.firstChild.textContent = fmt(ghost - s.start)
  }

  const width = track.getBoundingClientRect().width
  const lk = JSON.stringify([...rows]) + branches.map((b) => b.id + ":" + b.end).join() + activeId + range(s).dur + width
  if (lk !== lanesKey) {
    lanesKey = lk
    lanesEl.innerHTML = branches
      .filter((b) => b.id !== activeId)
      .map((b) => {
        const r = rows.get(b.id)
        const own = frac(s, b.forkAt)
        return `<div class="lane" data-branch="${b.id}" style="top:${r.top}px;height:${r.height}px;left:0;right:0" title="${esc(b.name)} · click to go there">
          <span class="shared" style="width:${own * 100}%"></span>
          <span class="own" style="left:${own * 100}%;width:${(frac(s, b.end) - own) * 100}%"></span>
          <span class="name" style="left:${own * 100}%">${esc(b.name)}</span>
          <button class="x" data-remove="${b.id}" aria-label="Remove ${esc(b.name)}" style="left:calc(${frac(s, b.end) * 100}% - 20px);right:auto">×</button>
        </div>`
      })
      .join("")
  }

  renderExtras(s, rows, width)
  menu.querySelectorAll("[data-rate]").forEach((b) => b.classList.toggle("on", Number(b.dataset.rate) === s.rate))
}
;(function loop() {
  render()
  requestAnimationFrame(loop)
})()

const refocus = () => frame.contentWindow && frame.contentWindow.focus()

document.addEventListener("click", (e) => {
  const b = e.target.closest("button")
  if (!b) {
    if (!e.target.closest(".menu")) menu.hidden = true
    return
  }
  const a = b.dataset.a
  if (a === "toggle" && PT) PT.state().playing ? PT.pause() : PT.play()
  if (a === "menu") menu.hidden = !menu.hidden
  if (a === "start" && PT) PT.seek(PT.state().start)
  if (b.dataset.rate && PT) PT.setRate(Number(b.dataset.rate))
  if (b.dataset.remove) removeBranch(Number(b.dataset.remove))
  if (a === "loop") toggleLoop()
  if (a === "comment") setCommenting(!commentMode)
  if (a === "notes") toggleNotesPanel()
  if (handleExtraClick(b)) return
  if (a !== "menu" && b.closest(".menu")) menu.hidden = true
  if (a !== "menu") refocus()
})

const timeAt = (x) => {
  const s = last
  const r = track.getBoundingClientRect()
  return s.start + Math.min(1, Math.max(0, (x - r.left) / r.width)) * range(s).dur
}

// Scrubbing the active lane: forward follows the pointer live; going back
// rebuilds that moment on release. Pressing another lane steps into it.
track.addEventListener("pointerdown", (e) => {
  if (!PT || e.target.closest("button")) return
  if (e.shiftKey) return startLoopSelect(e)
  const lane = e.target.closest(".lane")
  if (lane) {
    switchTo(Number(lane.dataset.branch), timeAt(e.clientX))
    refocus()
    return
  }
  track.setPointerCapture(e.pointerId)
  ghost = timeAt(e.clientX)
})
track.addEventListener("pointermove", (e) => {
  if (ghost == null) return
  ghost = timeAt(e.clientX)
  if (PT && ghost > PT.state().now) PT.seek(ghost)
})
const release = () => {
  if (ghost == null) return
  const t = ghost
  ghost = null
  if (PT) PT.seek(t)
  refocus()
}
track.addEventListener("pointerup", release)
track.addEventListener("pointercancel", release)

// Resize by dragging the top edge, like docked DevTools.
const divider = $(".divider")
divider.addEventListener("pointerdown", (e) => {
  divider.setPointerCapture(e.pointerId)
  document.body.classList.add("dragging")
  const startY = e.clientY
  const startH = dock.offsetHeight
  const move = (ev) => {
    height = Math.round(Math.min(innerHeight * 0.7, Math.max(64, startH + startY - ev.clientY)))
  }
  const up = () => {
    document.body.classList.remove("dragging")
    divider.removeEventListener("pointermove", move)
    divider.removeEventListener("pointerup", up)
    store.set("height", height)
  }
  divider.addEventListener("pointermove", move)
  divider.addEventListener("pointerup", up)
})

window.addEventListener("keyup", (e) => e.key === "Meta" && window.__waybackShell.meta(false))
window.addEventListener("blur", () => window.__waybackShell.meta(false))
window.addEventListener("keydown", (e) => {
  if (e.key === "Meta") return window.__waybackShell.meta(true)
  if (e.key === "Escape" && commenting) return setCommenting(false)
  if (e.altKey && e.code === "KeyP" && PT) {
    e.preventDefault()
    PT.state().playing ? PT.pause() : PT.play()
  }
})
