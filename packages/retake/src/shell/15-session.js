// Keeping the session. Timelines, notes and bookmarks go to the dev server
// (/__retake/session, kept on disk under <project>/.retake/) so a reload or a
// restart doesn't lose them; each timeline's recording goes to
// /__retake/recording/:id. Agents reply to notes over /__retake/events.
// When the server has no session API (it answers 404), or the page says
// there's no server at all (`__retakeConfig.server === false`, a static
// deploy), everything stays in memory for this page.
const TOKEN = window.__RETAKE_TOKEN || ""
const SERVER = !(window.__retakeConfig && window.__retakeConfig.server === false)
const net = {
  on: SERVER, // false: in-memory only
  restoring: true, // nothing is saved until what's on disk has been read
  savedSession: null, // the last session body the server has
  savedRec: new Map(), // branch id → the recording string the server has
  activeSig: "", // what the active recording looked like when last saved
  activeSavedAt: 0,
}

const GZIP_OVER = 1 << 20

async function api(method, path, body) {
  const headers = {}
  if (method !== "GET") headers["x-retake-token"] = TOKEN
  if (body !== undefined) headers["content-type"] = "application/json"
  /** @type {string | Blob | undefined} */
  let data = body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body)
  // A large upload goes gzipped (JSON shrinks ~10x): a Next.js middleware
  // (retake-dev/next) gets 10 MB of a request body at most.
  if (typeof data === "string" && data.length > GZIP_OVER && typeof CompressionStream === "function") {
    data = await new Response(new Blob([data]).stream().pipeThrough(new CompressionStream("gzip"))).blob()
    headers["content-encoding"] = "gzip"
  }
  const res = await fetch("/__retake/" + path, { method, headers, body: data })
  if (res.status === 404) return { missing: true }
  if (!res.ok) throw new Error(`${method} /__retake/${path}: ${res.status}`)
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
  D.branches = s.branches.map((b) => ({ ...b, name: migratedName(b), version: b.codeVersion || undefined, json: null, end: b.end ?? b.forkAt, born: -1e9 }))
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

// The page the user asked for, without the frame's own parameter.
const askedFor = location.pathname + location.search + location.hash
const FEATURES = (window.__retakeConfig && window.__retakeConfig.features) || []

// On load: read what was saved, then open the app at the page the user asked
// for, live. The saved timelines stay; the active one carries on from its end
// at this page (a runtime with the "continue" feature marks it there, and a
// rewind before that point brings the old page back). A runtime without it
// gets this visit as a timeline of its own, so nothing saved is overwritten.
// It's never a rebuild, and never waits long: after 1.5s the app opens fresh.
async function restore() {
  let known = false // the saved session has been read (or there's none)
  const fallback = setTimeout(() => !D.frame && openFirstFrame(null, null), 1500)
  const ownTimeline = () => {
    const b = newBranch(0, null)
    b.name = `→ ${askedFor.split("?")[0] || "/"}`
    D.activeId = b.id
    return b.id
  }
  try {
    if (!SERVER) return
    const r = await api("GET", "session")
    if (r.missing) {
      net.on = false
      return
    }
    const s = r.value
    if (!s || !Array.isArray(s.branches) || !s.branches.length) return
    applySession(s)
    net.savedSession = JSON.stringify(sessionBody())
    known = true
    const json = newerThanSaved(await recordingOf(activeBranch()))
    if (D.frame) {
      // Opened fresh already (the session was slow): that visit is its own.
      D.frameBranch = ownTimeline()
      return
    }
    if (json && FEATURES.includes("continue")) {
      let end = activeBranch().end
      try {
        end = JSON.parse(json).end
      } catch {}
      openFirstFrame({ rec: json, target: end, play: true, continue: true, url: askedFor }, D.activeId)
    } else if (json) openFirstFrame(null, ownTimeline())
    else openFirstFrame(null, D.activeId)
  } catch (err) {
    // Don't overwrite a session we couldn't read.
    console.warn("[retake] couldn't restore the session; keeping this one in memory", err)
    net.on = false
  } finally {
    clearTimeout(fallback)
    if (!known && !D.frame) openFirstFrame(null, D.activeId)
    else if (!known && D.frameBranch == null) D.frameBranch = D.activeId
    net.restoring = false
  }
}

// Leaving the page (a new address typed in, a reload of the dock) while
// recording: the server has the recording as it was at the last save, up to
// five seconds ago. What came after is kept in this tab's sessionStorage on
// the way out, and restore() carries on from it (F78).
const LIVE_KEY = KEY + "live"
function takeLiveStash() {
  try {
    const v = sessionStorage.getItem(LIVE_KEY)
    sessionStorage.removeItem(LIVE_KEY) // the app's frame shares this storage
    return v ? JSON.parse(v) : null
  } catch {
    return null
  }
}
const liveStash = SERVER ? takeLiveStash() : null
// The saved recording, or what this tab kept of the same recording (same
// timeline, same epoch) when it's further along.
function newerThanSaved(json) {
  const kept = liveStash
  if (!json || !kept || kept.branchId !== D.activeId || typeof kept.rec !== "string") return json
  try {
    const saved = JSON.parse(json)
    const rec = JSON.parse(kept.rec)
    if (rec.epoch !== saved.epoch || !(rec.end > saved.end)) return json
  } catch {
    return json
  }
  activeBranch().json = kept.rec
  return kept.rec
}
window.addEventListener("pagehide", () => {
  if (!net.on || net.restoring || net.hold || !D.PT || D.building || D.frameBranch !== D.activeId) return
  try {
    const s = D.PT.state()
    if (!s.started || s.seeking) return
    const rec = JSON.stringify(D.PT.history())
    if (rec === net.savedRec.get(D.activeId)) return
    sessionStorage.setItem(LIVE_KEY, JSON.stringify({ branchId: D.activeId, rec }))
  } catch {}
})
// Back from the back/forward cache: this page carries on, nothing to keep.
window.addEventListener("pageshow", (e) => {
  try {
    if (e.persisted) sessionStorage.removeItem(LIVE_KEY)
  } catch {}
})

// The active timeline's recording is saved when it's still (paused), and every
// few seconds while it's live.
function activeSig(s) {
  const h = D.PT.history()
  return `${D.activeId}:${h.end}:${h.events.length}:${h.frames.length}`
}

let saving = false
async function persist() {
  if (!net.on || net.restoring || net.hold || saving || D.switching) return
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
  if (!net.on || net.restoring || net.hold) return
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
  const es = new EventSource("/__retake/events")
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
    if (id && id !== D.activeId && branchById(id)) switchTo(id, D.last ? D.last.now : 0).then((ok) => ok && onActiveChanged(d))
  })
  // Which code each timeline has (40-code.js).
  es.addEventListener("code-version", (e) => {
    const d = read(e)
    if (d && d.version) D.codeVersionSeen = d.version
    if (d && d.timelines) applyCode(d, d.reason || null)
  })
  // A server without events answers 404 and the stream closes for good.
  es.onerror = () => es.readyState === EventSource.CLOSED && es.close()
}

// Start fresh: one empty timeline, no notes, a new recording, straight away.
// For five seconds it can be undone; the server isn't told until then.
const UNDO_MS = 5000
let undo = null
const toast = $("#wb-toast")

function startFresh() {
  if (undo) commitFresh()
  const snap = {
    branches: D.branches.map((b) => ({ ...b })),
    activeId: D.activeId,
    branchSeq: D.branchSeq,
    notes: D.notes,
    markers: D.markers,
    markerSeq: D.markerSeq,
    frame: D.frame, // the frame showing when it was cleared
  }
  const cur = snap.branches.find((b) => b.id === snap.activeId)
  try {
    if (cur && D.PT) {
      cur.json = JSON.stringify(D.PT.history())
      cur.end = D.PT.state().end
    }
  } catch {}
  net.hold = true
  D.notes = []
  D.markers = []
  D.markerSeq = 0
  closeCard()
  resetBranches()
  invalidateGutter()
  freshFrame()
  undo = { snap, timer: setTimeout(commitFresh, UNDO_MS) }
  toast.hidden = false
}

// The five seconds are up: clear the session on the server too.
async function commitFresh() {
  if (!undo) return
  clearTimeout(undo.timer)
  undo = null
  toast.hidden = true
  net.savedRec.clear()
  net.activeSig = ""
  net.hold = false
  if (net.on) {
    try {
      const body = JSON.stringify(sessionBody())
      await api("PUT", "session", body)
      net.savedSession = body
    } catch {}
  }
}

// Undo: everything back as it was, the moment rebuilt where it was.
function undoFresh() {
  if (!undo) return
  clearTimeout(undo.timer)
  const { snap } = undo
  undo = null
  toast.hidden = true
  D.branches = snap.branches
  D.activeId = snap.activeId
  D.branchSeq = snap.branchSeq
  D.notes = snap.notes
  D.markers = snap.markers
  D.markerSeq = snap.markerSeq
  invalidateGutter()
  const cur = activeBranch()
  // Still showing the old frame (the fresh one hadn't swapped in yet)? Then
  // there's nothing to rebuild: just drop the fresh one.
  if (D.building) cancelBuild()
  if (D.frame === snap.frame) D.frameBranch = cur.id
  else if (cur && cur.json && D.PT) D.PT.load(cur.json, cur.end)
  net.hold = false
}

restore().then(listen)
