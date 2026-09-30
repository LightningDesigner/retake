// Keeping the session. Timelines, notes and bookmarks go to the dev server
// (/__wayback/session, kept on disk under <project>/.retake/) so a reload or a
// restart doesn't lose them; each timeline's recording goes to
// /__wayback/recording/:id. Agents reply to notes over /__wayback/events.
// When the server has no session API (it answers 404), everything stays in
// memory for this page.
const TOKEN = window.__WAYBACK_TOKEN || ""
const net = {
  on: true, // false: in-memory only
  restoring: true, // nothing is saved until what's on disk has been read
  savedSession: null, // the last session body the server has
  savedRec: new Map(), // branch id → the recording string the server has
  activeSig: "", // what the active recording looked like when last saved
  activeSavedAt: 0,
}

async function api(method, path, body) {
  const headers = {}
  if (method !== "GET") headers["x-wayback-token"] = TOKEN
  if (body !== undefined) headers["content-type"] = "application/json"
  const res = await fetch("/__wayback/" + path, {
    method,
    headers,
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  })
  if (res.status === 404) return { missing: true }
  if (!res.ok) throw new Error(`${method} /__wayback/${path}: ${res.status}`)
  const text = await res.text()
  return { value: text && (res.headers.get("content-type") || "").includes("json") ? JSON.parse(text) : text }
}

// The session as the server stores it (see CONTRACT.md).
function sessionBody() {
  return {
    branches: D.branches.map((b) => ({ id: b.id, parentId: b.parentId, forkAt: b.forkAt, name: b.name, codeVersion: b.version || null, end: b.end })),
    activeId: D.activeId,
    markers: D.markers,
    notes: D.notes.map(noteForServer),
  }
}

function applySession(s) {
  D.branches = s.branches.map((b) => ({ ...b, version: b.codeVersion || undefined, json: null, end: b.end ?? b.forkAt, born: -1e9 }))
  D.branchSeq = Math.max(0, ...D.branches.map((b) => b.id))
  D.activeId = D.branches.some((b) => b.id === s.activeId) ? s.activeId : D.branches[0].id
  D.markers = Array.isArray(s.markers) ? s.markers : []
  D.markerSeq = Math.max(0, ...D.markers.map((m) => Number(m.id) || 0))
  D.notes = Array.isArray(s.notes) ? s.notes.map(noteFromServer) : []
}

// A timeline's recording: in memory if we have it, else from the server.
async function recordingOf(b) {
  if (b.json) return b.json
  if (!net.on) return null
  try {
    const r = await api("GET", `recording/${b.id}`)
    if (r.missing || !r.value) return null
    b.json = typeof r.value === "string" ? r.value : JSON.stringify(r.value)
    net.savedRec.set(b.id, b.json)
    return b.json
  } catch {
    return null
  }
}

const whenAttached = () =>
  new Promise((resolve) => {
    const check = () => {
      const s = state()
      if (D.PT && s && s.booted && !D.building) resolve()
      else setTimeout(check, 50)
    }
    check()
  })

async function restore() {
  try {
    const r = await api("GET", "session")
    if (r.missing) {
      net.on = false
      return
    }
    const s = r.value
    if (!s || !Array.isArray(s.branches) || !s.branches.length) return
    applySession(s)
    net.savedSession = JSON.stringify(sessionBody())
    const json = await recordingOf(activeBranch())
    if (!json) return
    await whenAttached()
    const b = activeBranch()
    D.PT.load(json, b.end)
  } catch (err) {
    // Don't overwrite a session we couldn't read.
    console.warn("[retake] couldn't restore the session; keeping this one in memory", err)
    net.on = false
  } finally {
    net.restoring = false
  }
}

// The active timeline's recording is saved when it's still (paused), and every
// few seconds while it's live.
function activeSig(s) {
  const h = D.PT.history()
  return `${D.activeId}:${h.end}:${h.events.length}:${h.frames.length}`
}

let saving = false
async function persist() {
  if (!net.on || net.restoring || saving || D.switching) return
  saving = true
  try {
    const body = JSON.stringify(sessionBody())
    if (body !== net.savedSession) {
      await api("PUT", "session", body)
      net.savedSession = body
    }
    for (const b of D.branches) {
      if (b.id === D.activeId || !b.json || net.savedRec.get(b.id) === b.json) continue
      await api("PUT", `recording/${b.id}`, b.json)
      net.savedRec.set(b.id, b.json)
    }
    const s = state()
    if (D.PT && s && s.started && !D.building && D.frameBranch === D.activeId) {
      const sig = activeSig(s)
      const due = !s.recording || performance.now() - net.activeSavedAt > 5000
      if (sig !== net.activeSig && due) {
        const json = JSON.stringify(D.PT.history())
        await api("PUT", `recording/${D.activeId}`, json)
        net.activeSig = sig
        net.activeSavedAt = performance.now()
        net.savedRec.set(D.activeId, json)
      }
    }
  } catch (err) {
    console.warn("[retake] saving the session failed; will retry", err)
  } finally {
    saving = false
  }
}

// Debounced: a change is saved once things have been still for 300ms.
let lastSeen = ""
let stillSince = 0
setInterval(() => {
  if (!net.on || net.restoring) return
  let sig = ""
  try {
    sig = JSON.stringify(sessionBody()) + D.branches.map((b) => (b.json ? b.json.length : 0)).join(",")
    if (D.PT && D.last && D.last.started) sig += activeSig(D.last)
  } catch {
    return
  }
  const now = performance.now()
  if (sig !== lastSeen) {
    lastSeen = sig
    stillSince = now
    // A live recording never stands still; save it on its own clock.
    if (!(D.last && D.last.recording)) return
  }
  if (now - stillSince >= 300 || (D.last && D.last.recording)) persist()
}, 100)

// Agent replies and other outside changes arrive as server events.
function listen() {
  if (!window.EventSource || !net.on) return
  const es = new EventSource("/__wayback/events")
  const read = (e) => {
    try {
      return JSON.parse(e.data)
    } catch {
      return null
    }
  }
  es.addEventListener("note-updated", (e) => {
    const d = read(e)
    const n = d && (d.note || d)
    if (n && n.id != null) mergeNote(n)
  })
  es.addEventListener("active-changed", (e) => {
    const d = read(e)
    const id = d && Number(d.activeId)
    if (id && id !== D.activeId && branchById(id)) switchTo(id, D.last ? D.last.now : 0)
  })
  es.addEventListener("code-version", (e) => {
    const d = read(e)
    if (d && d.version) D.codeVersionSeen = d.version
  })
  // A server without events answers 404 and the stream closes for good.
  es.onerror = () => es.readyState === EventSource.CLOSED && es.close()
}

// Start fresh: one empty timeline, no notes, a new prototype frame.
async function startFresh() {
  D.notes = []
  D.markers = []
  D.markerSeq = 0
  closeCard()
  resetBranches()
  net.savedRec.clear()
  net.activeSig = ""
  freshFrame()
  if (net.on) {
    try {
      const body = JSON.stringify(sessionBody())
      await api("PUT", "session", body)
      net.savedSession = body
    } catch {}
  }
}

restore().then(listen)
