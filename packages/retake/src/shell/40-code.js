// Code timelines: each timeline keeps its own code. The server owns which code
// each timeline has (GET /__retake/code, SSE code-version; code-versions.js);
// the dock shows it and asks for a switch when you step into a timeline.
//   - An edit (yours or an agent's) belongs to the timeline checked out, the
//     one you're in. With code timelines on, the moment on show is rebuilt on
//     the new code.
//   - Stepping into another timeline puts its code on disk first (switchTo
//     calls checkoutTimeline), so its moments rebuild on the code they were
//     recorded with.
//   - Off, or not chosen yet ("ask"), every timeline shares the files; the
//     first time code changes with two timelines around, the hint asks.

const code = {
  on: false, // the server has code timelines
  state: null, // what it last said
  seen: new Map(), // timeline id → the head the frame on show was built on
  asked: false, // the "keep each timeline's code?" question was shown on this page
  prompt: null, // { html, until } shown in the hint until answered
  fetching: false,
  offShown: false,
}
const codeOn = () => !!(code.on && code.state && code.state.enabled === true)
const codeOf = (id) => (code.state && code.state.timelines && code.state.timelines[id]) || null
const plural = (n, one) => `${n} ${one}${n === 1 ? "" : "s"}`

async function fetchCode() {
  if (!net.on || code.fetching) return
  code.fetching = true
  try {
    const res = await fetch("/__retake/code", { cache: "no-store" })
    if (res.status === 404) return void (code.on = false)
    if (!res.ok) return
    code.on = true
    applyCode(await res.json(), null)
  } catch {
  } finally {
    code.fetching = false
  }
}

// The server's word (a GET, or an SSE code-version).
function applyCode(s, reason) {
  if (!s || !s.timelines) return
  code.on = true
  const was = code.state
  code.state = s
  for (const b of D.branches) {
    const t = s.timelines[b.id]
    if (t) b.version = t.head
  }
  if (!was || JSON.stringify(was.timelines) !== JSON.stringify(s.timelines) || was.enabled !== s.enabled) invalidateGutter()
  renderCodeItem()
  // A code change while two timelines are around and nobody has said yet
  // whether they keep their own code: ask, once.
  if (reason === "edit" && s.enabled === "ask" && D.branches.length > 1 && !code.asked) askSeparate()
  if (s.enabled !== "ask" && code.prompt && code.prompt.kind === "ask") clearPrompt()
  if (s.offEdits != null && !code.offShown && branchById(s.offEdits)) {
    code.offShown = true
    flash(`Edits made while Retake was off went to ${branchById(s.offEdits).name}`, { warn: false })
  }
  rebuildOnNewCode()
}

// The checked-out timeline's code changed while you're in it (an edit): with
// code timelines on, the moment on show is rebuilt on the new code. Retried
// by the poll while the dock is busy (building, switching).
function rebuildOnNewCode() {
  if (!codeOn() || !D.PT || net.restoring) return
  const s = code.state
  const t = codeOf(D.activeId)
  if (!t || String(s.checkedOut) !== String(D.activeId)) return
  const seen = code.seen.get(D.activeId)
  if (seen === undefined) return void code.seen.set(D.activeId, t.head)
  if (seen === t.head || D.switching || D.building) return
  code.seen.set(D.activeId, t.head)
  const st = D.PT.state()
  // Not recording yet: just show the new code.
  if (!st.started) return freshFrame()
  D.PT.load(JSON.stringify(D.PT.history()), st.previewing ? st.previewAt : st.now)
}

// Stepping into a timeline: its code on disk first. { ok } once it is (or
// there's nothing to switch). `force`: take the files from an agent that is
// working on another timeline.
async function checkoutTimeline(target, { force = false } = {}) {
  if (!code.on || !code.state || !net.on) return { ok: true }
  const swapping = codeOn()
  const frames = [D.frame, D.building && D.building.frame].filter(Boolean)
  // Nothing the dev server pushes reaches these frames while files change:
  // they're rebuilt on the new code (and a refused switch delivers it all).
  const holdDev = (on) => frames.forEach((f) => {
    try {
      const pt = f.contentWindow && f.contentWindow.__retake
      if (pt && pt.holdDev) pt.holdDev(on)
    } catch {}
  })
  if (swapping) holdDev(true)
  // The dev server may take a moment to catch up with the new files.
  const slow = swapping ? setTimeout(() => flash(`Switching to ${target.name}'s code…`, { warn: false }), 300) : 0
  let r
  try {
    const res = await fetch("/__retake/code/checkout", {
      method: "POST",
      headers: { "content-type": "application/json", "x-retake-token": TOKEN },
      body: JSON.stringify({ branchId: target.id, reason: "dock", force, url: frameUrl() }),
    })
    if (res.status === 404) {
      clearTimeout(slow)
      code.on = false
      holdDev(false)
      return { ok: true }
    }
    r = await res.json()
  } catch (err) {
    console.warn("[retake] couldn't switch to that timeline's code", err)
    r = { ok: false, error: "the dev server didn't answer" }
  }
  clearTimeout(slow)
  if (!r || r.ok === false) {
    holdDev(false)
    // (A prompt, so the caller's "Couldn't switch" doesn't cover the reason.)
    if (r && r.lease) askLease(target, r.lease)
    else if (r && r.error) showPrompt("error", `<span>Can't switch code: ${esc(r.error)}</span>`, 4000, true)
    return { ok: false, quiet: true }
  }
  code.seen.set(target.id, r.version)
  if (r.files && r.files.length) {
    flash(`Files swapped to ${target.name}'s code (${plural(r.files.length, "file")})${r.deps ? "; dependencies differ: run install if the app breaks" : ""}`, { warn: false })
  }
  fetchCode()
  return { ok: true, files: r.files || [] }
}

// A new timeline (branchOff): the server starts it on its parent's code and
// makes it the one edits land on.
function codeFork(b, parent) {
  if (!code.on || !net.on) return
  fetch("/__retake/code/checkout", {
    method: "POST",
    headers: { "content-type": "application/json", "x-retake-token": TOKEN },
    body: JSON.stringify({ branchId: b.id, parentId: parent ? parent.id : null, reason: "fork" }),
  })
    .then(() => fetchCode())
    .catch(() => {})
}

// The page the frame on show is at (the settle fetches it so it's compiled).
function frameUrl() {
  try {
    const u = new URL(D.frame.contentWindow.location.href)
    u.searchParams.delete("__wb")
    return u.pathname + u.search
  } catch {
    return location.pathname + location.search
  }
}

// ---- the hint: questions that wait for an answer ------------------------------------

function showPrompt(kind, html, ms = 20000, warn = false) {
  code.prompt = { kind, html, until: performance.now() + ms, warn }
  delete hintEl.dataset.prompt
  drawPrompt()
}
function drawPrompt() {
  const p = code.prompt
  if (!p) return
  if (performance.now() > p.until) return clearPrompt()
  flashUntil = Infinity
  if (hintEl.dataset.prompt === p.kind && hintEl.querySelector("[data-code], [data-code-msg]")) return
  hintEl.dataset.prompt = p.kind
  hintEl.classList.remove("readout")
  hintEl.classList.toggle("warn", !!p.warn)
  hintEl.classList.add("show", "prompt")
  hintEl.innerHTML = p.html.replace("<span", "<span data-code-msg")
}
function clearPrompt() {
  code.prompt = null
  delete hintEl.dataset.prompt
  hintEl.classList.remove("prompt", "warn")
  if (flashUntil === Infinity) {
    flashUntil = 0
    hintEl.textContent = ""
  }
}

function askSeparate() {
  code.asked = true
  const cur = activeBranch()
  showPrompt(
    "ask",
    `<span title="Switching timelines will then swap your files on disk; the newest code always goes back when Retake stops.">Code changed on ${esc(cur ? cur.name : "this timeline")}. Give each timeline its own code?</span>` +
      `<button data-code="separate">Separate code</button><button data-code="share">Share code</button>`,
  )
}

function askLease(target, lease) {
  showPrompt(
    "lease",
    `<span>An agent is editing ${esc(lease.name || `Timeline ${lease.branchId}`)} (note ${esc(String(lease.note))}). Switching swaps its files.</span>` +
      `<button data-code="force" data-branch-id="${target.id}">Switch anyway</button><button data-code="stay">Stay</button>`,
    15000,
  )
}

async function setCodeEnabled(on) {
  try {
    const r = await api("POST", "code/enabled", { on })
    const v = r.value || {}
    if (on && v.files && v.files.length) flash(`Files swapped to ${activeBranch().name}'s code (${plural(v.files.length, "file")})`, { warn: false })
  } catch {
    flash("Couldn't change that")
  }
  fetchCode()
}

// ---- the top row: "Code: Timeline 2" while code timelines are on ---------------------

let codeItem = null
function renderCodeItem() {
  const s = code.state
  const show = !!(code.on && s && (s.enabled === true || s.suspended === "git-branch-changed"))
  if (!show) {
    if (codeItem) codeItem.hidden = true
    return
  }
  if (!codeItem) {
    codeItem = document.createElement("button")
    codeItem.className = "btn code-item"
    codeItem.dataset.code = "menu"
    const right = $(".head .right")
    right.insertBefore(codeItem, right.querySelector(".fresh"))
  }
  codeItem.hidden = false
  const suspended = s.suspended
  const label = suspended ? "Code swapping paused" : `Code: ${s.checkedOutName || "—"}`
  if (codeItem.textContent !== label) codeItem.textContent = label
  codeItem.classList.toggle("warn", !!suspended)
  codeItem.title = suspended === "git-branch-changed" ? "Git branch changed. Code swapping is paused." : suspended ? `Paused: ${suspended}` : `Files on disk are ${s.checkedOutName}'s code`
}

// The lane menu's toggle (25-input.js puts it in).
function codeMenuItems() {
  if (!code.on || !code.state) return ""
  const on = code.state.enabled === true
  return `<button data-code="toggle" role="menuitemcheckbox" aria-checked="${on}">${on ? "✓ " : ""}Separate code per timeline</button>`
}

function openCodeMenu(btn) {
  const s = code.state
  const r = btn.getBoundingClientRect()
  menuEl.innerHTML =
    (s.suspended ? `<div class="menu-note">${s.suspended === "git-branch-changed" ? "Git branch changed. Code swapping is paused." : `Paused: ${esc(s.suspended)}`}</div><button data-code="resume">Resume (the files go to ${esc(s.checkedOutName || "this timeline")})</button>` : "") +
    codeMenuItems()
  menuEl.hidden = false
  menuEl.style.left = Math.max(8, Math.min(r.left, innerWidth - 240)) + "px"
  menuEl.style.top = r.top - menuEl.offsetHeight - 6 + "px"
}

// The lane label's chip: this timeline's code differs from where it started.
function codeChip(b) {
  if (!codeOn() || D.compact) return ""
  const t = codeOf(b.id)
  if (!t || !t.changed) return ""
  const parent = b.parentId && branchById(b.parentId)
  const title = `${plural(t.changed, "file")} changed since ${parent ? parent.name : "it started"}: ${t.files.join(", ")}${t.changed > t.files.length ? ", …" : ""}`
  return `<em class="code-chip" title="${esc(title)}" aria-label="code changed">±</em>`
}
const codeKey = () => (codeOn() ? Object.entries(code.state.timelines).map(([id, t]) => `${id}:${t.changed}`).join(",") : "")

document.addEventListener("click", (e) => {
  const b = /** @type {HTMLElement | null} */ (/** @type {Element} */ (e.target).closest("[data-code]"))
  if (!b) return
  const what = b.dataset.code
  if (what === "menu") return openCodeMenu(b)
  menuEl.hidden = true
  if (what === "separate" || what === "share") {
    clearPrompt()
    setCodeEnabled(what === "separate")
  }
  if (what === "toggle") setCodeEnabled(!codeOn())
  if (what === "resume") api("POST", "code/resume", {}).then(fetchCode, () => flash("Couldn't resume"))
  if (what === "stay") clearPrompt()
  if (what === "force") {
    clearPrompt()
    const target = branchById(Number(b.dataset.branchId))
    if (target) switchTo(target.id, clamp(D.last ? shownTime(D.last) : target.forkAt, target.forkAt, target.end), { force: true }).then((ok) => ok || flash("Couldn't switch to that timeline"))
  }
})

// The code menu closes on a press anywhere else.
document.addEventListener("pointerdown", (e) => {
  const t = /** @type {Element} */ (e.target)
  if (!menuEl.hidden && !t.closest("#wb-menu, [data-code='menu']") && menuEl.querySelector("[data-code]") && !menuEl.querySelector("[data-rename-timeline]")) menuEl.hidden = true
})

// An agent took a timeline (acknowledge on a note): the server moved the dock.
function onActiveChanged(d) {
  if (!d || d.by !== "agent") return
  const b = branchById(Number(d.activeId))
  if (b) flash(`An agent took ${b.name}${d.note != null ? ` for note ${d.note}` : ""}`, { warn: false })
}

// The server's events carry the whole state; the poll catches up when they
// don't come (and retries a rebuild the dock was too busy for).
// (Every second while code timelines are on; otherwise every five.)
let codeTick = 0
setInterval(() => code.prompt && drawPrompt(), 100)
setInterval(() => {
  if (!net.on || net.restoring) return
  if (!code.state) return void fetchCode()
  if (code.on && (codeOn() || ++codeTick % 5 === 0)) fetchCode()
}, 1000)

// The first look once the session is in: with code timelines on, the files on
// disk become the code of the timeline the dock opened on.
let codeStarted = false
setInterval(async () => {
  if (codeStarted || net.restoring || !D.PT) return
  codeStarted = true
  await fetchCode()
  if (!codeOn()) return
  const s = code.state
  const cur = activeBranch()
  if (!cur || String(s.checkedOut) === String(cur.id) || !codeOf(cur.id)) return
  const r = await checkoutTimeline(cur)
  if (!r.ok || !r.files || !r.files.length || !D.PT) return
  const st = D.PT.state()
  if (!st.started) freshFrame()
  else D.PT.load(JSON.stringify(D.PT.history()), st.previewing ? st.previewAt : st.now)
}, 300)
