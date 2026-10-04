// `retake mcp`: an MCP server (stdio, JSON-RPC 2.0, one message per line) that
// lets a coding agent read the notes left in the dock and answer them. It
// talks to the running dev server over HTTP (CONTRACT.md "Server HTTP"), so
// changes show up in the dock live.
//
//   npx -y retake-dev mcp   (registered as an MCP server in the coding agent)
//
// Finds the dev server from --url / RETAKE_URL, else <cwd or a parent>/.retake/server.json.
import fs from "node:fs"
import path from "node:path"
import { fmt, parseTime, readRecording, report } from "./moments.js"
import { cleanSource, isCompiled, resolveSource } from "./sourcemap.js"
import { animFromClip, animationReport, animationSummary, elementBlock, animationBlock, noteText, primaryOf } from "../note-text.js"

const PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"]
const PKG = JSON.parse(fs.readFileSync(new URL("../../package.json", import.meta.url), "utf8"))

function findServerInfo(from = process.cwd()) {
  for (let dir = path.resolve(from); ; dir = path.dirname(dir)) {
    const f = path.join(dir, ".retake", "server.json")
    if (fs.existsSync(f)) {
      try {
        return { ...JSON.parse(fs.readFileSync(f, "utf8")), root: dir }
      } catch {}
    }
    if (path.dirname(dir) === dir) return null
  }
}

/** @param {{ url?: string | null, token?: string }} [options] */
export function createClient({ url, token } = {}) {
  /** @type {{ url: string, token?: string, root?: string } | null} */
  let info = null
  const base = () => {
    if (url) return url.replace(/\/$/, "")
    info = info || findServerInfo()
    if (!info) throw new Error("no running Retake dev server found. Start one with `npx retake-dev .` in the project (or pass --url)")
    return info.url.replace(/\/$/, "")
  }
  async function getToken() {
    if (token) return token
    info = info || findServerInfo()
    if (info && info.token && (!url || info.url.replace(/\/$/, "") === base())) return (token = info.token)
    const html = await (await fetch(base() + "/")).text()
    const m = html.match(/__RETAKE_TOKEN = "([0-9a-f]+)"/)
    if (!m) throw new Error(`${base()} doesn't look like a Retake dev server`)
    return (token = m[1])
  }
  async function call(method, p, body) {
    let res
    try {
      res = await fetch(base() + p, {
        method,
        // (x-retake-client: an agent working on a note keeps its hold on the files: code-versions.js)
        headers: body !== undefined || method !== "GET" ? { "content-type": "application/json", "x-retake-token": await getToken(), "x-retake-client": "mcp" } : { "x-retake-client": "mcp" },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    } catch (err) {
      throw new Error(`can't reach the Retake dev server at ${base()} (${err.cause ? err.cause.code || err.cause.message : err.message}). Is it running?`)
    }
    const text = await res.text()
    if (!res.ok) throw Object.assign(new Error(`${method} ${p} → ${res.status}: ${text.slice(0, 200)}`), { status: res.status, body: text })
    return text ? JSON.parse(text) : null
  }
  return {
    base,
    // The project folder (where .retake/ is), to make source paths relative.
    root: () => {
      info = info || findServerInfo()
      return (info && info.root) || process.cwd()
    },
    session: () => call("GET", "/__retake/session"),
    recording: (branchId) => call("GET", `/__retake/recording/${encodeURIComponent(branchId)}`),
    notes: () => call("GET", "/__retake/notes"),
    note: (id) => call("GET", `/__retake/notes/${encodeURIComponent(id)}`),
    patch: (id, body) => call("PATCH", `/__retake/notes/${encodeURIComponent(id)}`, body),
    // Code timelines (null: a server without them).
    code: () => call("GET", "/__retake/code").catch((err) => (/→ 404/.test(err.message) ? null : Promise.reject(err))),
    codeDiff: (branch, against) => call("GET", `/__retake/code/diff?branch=${encodeURIComponent(branch)}${against ? `&against=${encodeURIComponent(against)}` : ""}`),
    // { ok, … } or { ok: false, error } (a refusal is an answer, not a failure).
    codeCheckout: (body) =>
      call("POST", "/__retake/code/checkout", body).catch((err) => {
        if (err.status !== 409 && err.status !== 404) throw err
        try {
          return JSON.parse(err.body)
        } catch {
          return { ok: false, error: err.body }
        }
      }),
    // Resolves on the next matching SSE event (or null after `ms`).
    async nextEvent(types, ms) {
      const ac = new AbortController()
      const timer = setTimeout(() => ac.abort(), ms)
      try {
        const res = await fetch(base() + "/__retake/events", { signal: ac.signal })
        if (!res.body) return null
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
        let buf = ""
        for (;;) {
          const { done, value } = await reader.read()
          if (done) return null
          buf += value
          let i
          while ((i = buf.indexOf("\n\n")) >= 0) {
            const block = buf.slice(0, i)
            buf = buf.slice(i + 2)
            const ev = /^event: (.*)$/m.exec(block)
            const data = /^data: (.*)$/m.exec(block)
            if (ev && types.includes(ev[1])) {
              ac.abort()
              return { event: ev[1], data: data ? JSON.parse(data[1]) : null }
            }
          }
        }
      } catch (err) {
        if (err.name === "AbortError") return null
        throw err
      } finally {
        clearTimeout(timer)
      }
    },
  }
}

// ---- presenting notes -----------------------------------------------------------

// Older sessions named timelines "Main" and "Take N"; the dock now shows
// those defaults as "Timeline N" (migratedName in shell/10-dock.js).
function withNames(session) {
  if (!session || !Array.isArray(session.branches)) return session
  const old = (b) => (String(b.id) === "1" ? "Main" : `Take ${b.id}`)
  return { ...session, branches: session.branches.map((b) => (b.name === old(b) ? { ...b, name: `Timeline ${b.id}` } : b)) }
}

function summary(n, session) {
  const b = (session.branches || []).find((x) => String(x.id) === String(n.branchId))
  return {
    id: n.id,
    status: n.status || "pending",
    text: n.text,
    timeline: b ? b.name : n.branchId,
    at: fmt(n.t),
    selector: n.selector || (n.el && n.el.selector) || null,
    component: n.component || (n.el && n.el.components && n.el.components[0]) || null,
    source: n.source ? (unmapped(n.source) ? "unknown (compiled bundle; get_note tries its source map)" : `${n.source.file}${n.source.line ? ":" + n.source.line : ""}`) : null,
    ...(n.range ? { range: `${fmt(n.range.from)} → ${fmt(n.range.to)}` } : {}),
    ...(animationSummary(n) ? { animation: animationSummary(n) } : {}),
    replies: (n.replies || []).length,
  }
}

// A source that is only a compiled bundle's line (no source map read yet).
const unmapped = (src) => !!src && !!(src.compiled || isCompiled(src.file))

function clipText(c, t) {
  const name = c.label ? `${c.label} ` : ""
  const at = `${Math.round(Number(c.offset) || 0)}ms into`
  const start = c.start != null ? c.start : t - (Number(c.offset) || 0)
  const end = c.end !== undefined ? c.end : Number(c.duration) > 0 ? start + Number(c.duration) : null
  const span = `; it runs ${fmt(start)} → ${end != null ? fmt(end) : "still running"}`
  return Number(c.duration) > 0 ? `${at} a ${Math.round(c.duration)}ms ${name}animation (clip ${c.id}${span})` : `${at} a running ${name}animation (clip ${c.id}${span})`
}

// Where the element was written, as one line: the note's own source, the
// original file:line behind a compiled bundle's (see resolveSourceOf), or why
// it isn't known.
function sourceLine(n, resolved) {
  const src = n.source
  if (!src) return null
  if (resolved && resolved.file) return `Source: ${resolved.file}${resolved.line ? ":" + resolved.line : ""} (through the source map of the bundle it was served in)`
  if (unmapped(src)) {
    const by = [n.component || (n.el && n.el.components && n.el.components[0]), n.selector || (n.el && n.el.selector)].filter(Boolean)
    return `Source: not known. The note only has a line of a compiled bundle${resolved && resolved.library ? ", which maps into library code" : ", with no source map to read it by"}; find the element by ${by.length > 1 ? `its component (${by[0]}) and selector` : by.length ? by[0] : "its selector"} instead.`
  }
  return `Source: ${src.file}${src.line ? ":" + src.line : ""}`
}

// Everything an agent needs to act on one note, as readable text. A note
// that says which animations it is about (anims, from the dock) is written by
// the same formatter as the dock's Copy for agent (src/note-text.js).
function describe(n, session, resolved = null) {
  const b = (session.branches || []).find((x) => String(x.id) === String(n.branchId))
  const parent = b && (session.branches || []).find((x) => String(x.id) === String(b.parentId))
  if (Array.isArray(n.anims)) {
    const text = noteText(n, { start: 0, timeline: b ? b.name : String(n.branchId), parent: parent ? parent.name : null, forkAt: parent ? b.forkAt : null, sourceLine: sourceLine(n, resolved) || undefined, status: true })
    return `${text}\n\nThe note is pinned to ${fmt(n.range ? n.range.from : n.t)} in the recording of that timeline. get_moment with id "${n.id}" shows what happened around it; get_animation with id "${n.id}" maps any recording time onto the animation's own clock.`
  }
  const el = n.el || {}
  const lines = [
    `Note ${n.id} (${n.status || "pending"}) on timeline "${b ? b.name : n.branchId}" at ${fmt(n.t)}`,
    parent ? `That timeline branched from "${parent.name}" at ${fmt(b.forkAt)}${b.codeVersion ? `; it runs code version ${b.codeVersion}` : ""}.` : null,
    "",
    `What the user wants: ${n.text}`,
    "",
    `Element: ${el.label || ""}${el.text ? ` "${el.text}"` : ""}`.trim(),
    `Selector: ${n.selector || el.selector || "?"}`,
    n.component || (el.components && el.components.length) ? `Component: ${n.component || el.components.join(" < ")}` : null,
    sourceLine(n, resolved),
    n.classes && n.classes.length ? `Classes: ${[].concat(n.classes).join(" ")}` : null,
    n.rect ? `Box: ${Math.round(n.rect.w)}×${Math.round(n.rect.h)} at (${Math.round(n.rect.x)}, ${Math.round(n.rect.y)})` : null,
    n.clip ? `During an animation: ${clipText(n.clip, n.t)}` : null,
    el.page ? `Page: ${el.page}` : null,
    "",
    `The note is pinned to ${fmt(n.t)} in the recording of that timeline: the user means what was on screen then. get_moment with id "${n.id}" shows what happened around it (actions, animations on this element with their start and end, requests); check it before asking the user about timing.`,
  ]
  if ((n.replies || []).length) {
    lines.push("", "Conversation:")
    for (const r of n.replies) lines.push(`- ${r.from}: ${r.text}`)
  }
  return lines.filter((l) => l != null).join("\n")
}

// ---- tools --------------------------------------------------------------------------

const TOOLS = [
  {
    name: "list_notes",
    description: "List the notes left in the Retake timeline (things the user wants changed in the prototype). Defaults to notes still waiting on you (pending or acknowledged).",
    inputSchema: { type: "object", properties: { status: { type: "string", enum: ["open", "pending", "acknowledged", "resolved", "dismissed", "all"], description: "Filter; 'open' (default) = pending + acknowledged" } } },
  },
  {
    name: "get_note",
    description: "Everything about one note: what the user asked, the element (selector, React component, source file:line, classes, size), the animation it is about (or, for a group note, every animation inside the element) with an exact edit, the moment and timeline, and the conversation so far.",
    inputSchema: { type: "object", properties: { id: { type: ["string", "number"] } }, required: ["id"] },
  },
  {
    name: "get_moment",
    description:
      "What happened in the recording around a note's moment (or any moment of a timeline): the user's actions, route changes and requests with their times, the animations on or near the noted element (start, end, duration, what they animate between, how far along at the moment), other animations, and when the screen changed most. Use it before asking the user about timing: a note is pinned to a moment, and the answer is usually in the recording.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: ["string", "number"], description: "A note id: the moment, timeline and element come from the note" },
        timeline: { type: ["string", "number"], description: "Without a note: a timeline's name or id (default: the active one)" },
        at: { type: ["string", "number"], description: "Without a note: the moment, as the dock shows it (00:10.91)" },
        selector: { type: "string", description: "Without a note: an element to focus on" },
        before_seconds: { type: "number", description: "How far back to look (default 5)" },
        after_seconds: { type: "number", description: "How far ahead to look (default 5)" },
      },
    },
  },
  {
    name: "get_animation",
    description:
      "One animation in detail: what it is and where it is defined, what started it, its timing (delay, duration, iterations, easing) and every keyframe, and recording times mapped onto its own clock (local ms after its delay, progress, eased progress, the keyframe segment) with the conversion to CSS %, Motion `times` and GSAP seconds. Values and boxes are included where the note sampled them. Give a note id (its primary animation, or `clip` to pick another of its animations; a group note gives every member's), or a timeline and a clip id.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: ["string", "number"], description: "A note id: its primary animation and its moment or range" },
        clip: { type: "string", description: "A clip id (from get_moment / get_timeline_events / the note)" },
        timeline: { type: ["string", "number"], description: "Without a note: a timeline's name or id (default: the active one)" },
        at: { type: ["string", "number"], description: "A recording time to map (00:01.20)" },
        from: { type: ["string", "number"], description: "Start of a range to map" },
        to: { type: ["string", "number"], description: "End of a range to map" },
      },
    },
  },
  {
    name: "get_timeline_events",
    description: "Everything recorded on a timeline between two times: the user's actions, routes, page loads, requests, animations (optionally around one element) and screen changes, in order. Times as the dock shows them (00:10.91).",
    inputSchema: {
      type: "object",
      properties: {
        timeline: { type: ["string", "number"], description: "A timeline's name or id (default: the active one)" },
        from: { type: ["string", "number"], description: "Start of the window (default: the start)" },
        to: { type: ["string", "number"], description: "End of the window (default: the end)" },
        selector: { type: "string", description: "Focus on the animations on or near this element" },
        limit: { type: "number", description: "Most events to list (default 60, max 200)" },
      },
    },
  },
  {
    name: "get_active_timeline",
    description: "Which timeline the user is looking at in the Retake dock, how it relates to the others (branch point, code version) and its open notes.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "acknowledge",
    description: "Tell the user you've seen a note and are working on it (its pin turns to 'acknowledged' in the dock). Optionally add a short message. Call it before you edit: it moves the dock to the note's timeline and, with code timelines on, puts that timeline's code on disk, so your edit lands in the note's timeline.",
    inputSchema: { type: "object", properties: { id: { type: ["string", "number"] }, message: { type: "string" } }, required: ["id"] },
  },
  {
    name: "resolve",
    description: "Mark a note done, with a one or two sentence summary of what you changed. The summary shows in the dock.",
    inputSchema: { type: "object", properties: { id: { type: ["string", "number"] }, summary: { type: "string" } }, required: ["id", "summary"] },
  },
  {
    name: "reply",
    description: "Reply on a note without changing its status (ask a question, explain a trade-off).",
    inputSchema: { type: "object", properties: { id: { type: ["string", "number"] }, text: { type: "string" } }, required: ["id", "text"] },
  },
  {
    name: "checkout_timeline",
    description: "Put a timeline's code on disk (code timelines: each timeline keeps its own code) and move the dock to it. acknowledge does this for a note's timeline; use this to look at another timeline's code. Returns the files that changed.",
    inputSchema: { type: "object", properties: { timeline: { type: ["string", "number"], description: "A timeline's name or id" }, force: { type: "boolean", description: "Take the files even while another note's timeline is held for an agent" } }, required: ["timeline"] },
  },
  {
    name: "get_code_diff",
    description: "How a timeline's code differs from where it started (or from another timeline): the files changed and a unified diff.",
    inputSchema: { type: "object", properties: { timeline: { type: ["string", "number"], description: "A timeline's name or id (default: the one checked out)" }, against: { type: ["string", "number"], description: "Another timeline's name or id (default: where this one started)" } } },
  },
  {
    name: "watch_notes",
    description: "Wait until the user adds a note or replies to one, then return what changed. Returns an empty list on timeout.",
    inputSchema: { type: "object", properties: { timeout_seconds: { type: "number", description: "How long to wait (default 60, max 600)" } } },
  },
]

// The guide every coding agent gets at initialize (also in skills/retake-notes).
const INSTRUCTIONS = `Notes are change requests the user left on elements of their app in the Retake timeline, each pinned to a moment (or a range) of a recording of the running app. list_notes, then get_note for details; get_moment shows what happened around a note's moment (actions, animations on the element, requests), so check it before asking the user about timing. acknowledge when you start, resolve with a summary when done.

Animations. A note on an animated element names the animation (its kind, where it is defined, its timing and every keyframe) and the exact point or range the user meant on that animation's own clock: local ms after its delay, progress (local / duration), eased progress (after the effect's easing; keyframe offsets apply to this), and the keyframe segment it falls in, with the computed values and the element's box there and one frame either side. Numbers the user typed ("at 100ms", "200-400 ms") are local time of that animation unless the note says otherwise. Change only what the note scopes: keep the values at every other point and the total duration.
Most notes end with an "Exact edit": the animation's keyframes again on plain time, with the note's point or range edges as keyframes of their own and the matching part of each curve on both sides. It is for "change it only here" requests: put it in place of the original (it moves exactly as before), then change only the marked part. For timing, duration or shape requests ("faster", "slower", "start earlier", "hold longer") don't paste it: change the duration, delay or keyframe table instead; an "Intent:" line says which reading the note takes. If it says the @keyframes is shared, it gives this element its own copy; keep that unless the user meant every element.
The note's animation is the one that moves: instant ones (0ms, or no change) are one "Also running" line with their count, and the same animation started again is one entry with its runs.
A group note ("Group: N animated elements inside …") is about every animation inside a container (an equalizer's bars): each member has its own point or range on its own clock and its own exact edit. "Shared:" lists members that run one @keyframes or the same keyframes: one edit there changes all of them; use the per-member edits only to change them differently.
- CSS @keyframes: add stops at the range edges as % (local / duration) with the edge values given, so the rest doesn't move; change only what is between them. animation-timing-function inside a keyframe applies to the segment after it (default ease). A hold = two stops with the same value. If the duration changes, recompute every %. If the selector matches several elements, scope the change unless all were meant.
- CSS transition: one segment only. For a hold, a two-step motion or a sub-range, use linear(...) stops or a cubic-bezier, or replace it with a keyframes animation started by the same trigger (given).
- WAAPI (element.animate): add { offset, ...values, easing } at the edges. With an effect-level easing, offsets apply after it: set the effect easing to linear and move easing onto each keyframe first.
- Motion: values are arrays with times (0-1 of the duration, delay excluded) and an ease array (one per segment); insert entries at local / duration. A spring has no ms range: convert it to keyframes + times, or tune stiffness/damping/bounce.
- GSAP: retime with the position parameter ("<", "-=0.4", seconds); change part of a tween by splitting it into two .to() calls at the edge values.
- Script-driven (inline style writes): edit the code at the given location and gate the change on the same elapsed time, or move it into keyframes.
- SVG stroke draw: the dash offset is linear in progress; "pause halfway" = two equal stops around 50%.
- Scroll-driven: the axis is scroll progress, not time; edit the keyframe % or animation-range. For JS parallax, clamp to a scroll range instead of changing the factor.
- canvas / WebGL: Retake can't see inside; edit the per-frame code, gated on the same elapsed time.
get_animation maps any recording time onto an animation's clock and into CSS %, Motion times and GSAP seconds. After editing, check the values at the range edges and one frame either side against the note's.
Timelines can keep their own code (code timelines). acknowledge a note before editing: it puts the note's timeline's code on disk, so your edit lands in that timeline and the others keep theirs. get_note says which timeline's code is on disk; checkout_timeline and get_code_diff work with any timeline's code.`

// For get_moment on a note: which recorded clips the note says are its element's.
function knownOf(note) {
  const rel = new Map()
  for (const a of note.anims || []) {
    if (a.id) rel.set(String(a.id), a.relation === "on" ? "on" : a.relation || "on")
    for (const r of a.runs || []) if (r.id && !rel.has(String(r.id))) rel.set(String(r.id), a.relation === "on" ? "on" : a.relation || "on")
  }
  const members = groupAnims(note)
  for (const a of members) if (a.id && !rel.has(String(a.id))) rel.set(String(a.id), "inside (in the note's group)")
  for (const c of note.inside || []) if (c.id && !rel.has(String(c.id))) rel.set(String(c.id), "inside")
  const running = [...new Set([...(note.anims || []), ...members].map((a) => a.name || a.kind))]
  return { rel, running }
}
// A group note's member animations (each with its point or range).
const groupAnims = (note) => ((note.group && note.group.members) || []).map((m) => m.anim && { ...m.anim, selector: m.selector || m.anim.selector }).filter(Boolean)

const isOpen = (n) => !n.status || n.status === "pending" || n.status === "acknowledged"

// ---- code timelines ------------------------------------------------------------------

const codeMode = (c) => (!c ? null : c.suspended ? `suspended: ${c.suspended}` : c.enabled === true ? "on" : c.enabled === false ? "off" : "ask")
const nameIn = (session, id) => {
  const b = (session.branches || []).find((x) => String(x.id) === String(id))
  return b ? b.name : `Timeline ${id}`
}
// Where a note's edit must land, and where the files on disk are now.
function codeBlock(n, session, c) {
  if (!c) return ""
  const b = (session.branches || []).find((x) => String(x.id) === String(n.branchId))
  const parent = b && (session.branches || []).find((x) => String(x.id) === String(b.parentId))
  const t = c.timelines && c.timelines[n.branchId]
  const name = b ? b.name : `Timeline ${n.branchId}`
  const lines = []
  const files = t && t.changed ? `${t.changed} file${t.changed > 1 ? "s" : ""} changed since ${parent ? "the fork" : "it started"}: ${t.files.join(", ")}${t.changed > t.files.length ? ", …" : ""}` : "no code changes since it started"
  lines.push(`Timeline: "${name}"${parent ? ` (branched from "${parent.name}" at ${fmt(b.forkAt)})` : ""}${t ? `, code version ${t.head}, ${files}` : ""}`)
  if (c.enabled === true && !c.suspended) {
    const here = String(c.checkedOut) === String(n.branchId)
    lines.push(here ? `Files on disk now: ${name}'s code. Your edit lands in ${name}.` : `Files on disk now: ${c.checkedOutName || nameIn(session, c.checkedOut)}'s code. acknowledge switches them to ${name}'s before you edit.`)
  } else if (c.suspended) lines.push(`Code timelines are paused (${c.suspended}): an edit lands on whatever is on disk; tell the user if that's not ${name}.`)
  else if (c.enabled === false) lines.push("Code timelines are off: an edit changes every timeline's code.")
  else lines.push(`Code timelines aren't set up yet (every timeline shares the files). Your edit is kept as ${name}'s code; acknowledge first so it lands there.`)
  if (n.codeVersion && t && n.codeVersion !== t.head) lines.push(`The note was made on code version ${n.codeVersion}; the timeline's code has changed since.`)
  return lines.join("\n")
}

export function createTools(client) {
  const readSession = async () => withNames(await client.session())
  // The code timelines' state (null: a server or client without them).
  const codeState = () => (client.code ? client.code().catch(() => null) : Promise.resolve(null))
  const byId = async (id) => {
    const note = await client.note(id).catch((err) => {
      if (/→ 404/.test(err.message)) throw new Error(`no note with id ${id}; list_notes shows the ids`)
      throw err
    })
    return note
  }
  // A timeline by name or id (default: the active one) and its recording.
  const timelineOf = (session, which) => {
    const branches = session.branches || []
    const b = which == null || which === "" ? branches.find((x) => String(x.id) === String(session.activeId)) || branches[0] : branches.find((x) => String(x.id) === String(which)) || branches.find((x) => String(x.name).toLowerCase() === String(which).toLowerCase())
    if (!b) throw new Error(which == null ? "no timelines yet: record something in the dock first" : `no timeline "${which}"; get_active_timeline lists them`)
    return b
  }
  const recordingOf = async (b) => {
    const json = await client.recording(b.id).catch((err) => {
      if (/→ 404/.test(err.message)) throw new Error(`timeline "${b.name}" has no saved recording yet (the dock saves it when paused); ask the user to pause, then try again`)
      throw err
    })
    return readRecording(json)
  }
  const resolved = new Map()
  const resolveSourceOf = async (n) => {
    const src = n.source
    if (!src || !unmapped(src)) return null
    const key = `${src.file}:${src.line}:${src.col || ""}`
    if (!resolved.has(key)) resolved.set(key, resolveSource(src, { base: client.base(), root: client.root() }).catch(() => null))
    return resolved.get(key)
  }
  // An absolute source path inside the project reads better relative to it.
  const relSource = (n) => {
    if (!n.source || !n.source.file || !String(n.source.file).startsWith("/")) return n
    const file = cleanSource(n.source.file, { root: client.root() })
    return file === n.source.file ? n : { ...n, source: { ...n.source, file } }
  }
  const handlers = {
    async list_notes({ status = "open" } = {}) {
      const session = await readSession()
      const notes = (session.notes || []).filter((n) => (status === "all" ? true : status === "open" ? isOpen(n) : (n.status || "pending") === status))
      return { count: notes.length, notes: notes.map((n) => summary(n, session)) }
    },
    async get_note({ id }) {
      const [session, note, c] = await Promise.all([readSession(), byId(id), codeState()])
      const block = codeBlock(note, session, c)
      return describe(relSource(note), session, await resolveSourceOf(note)) + (block ? `\n\n${block}` : "")
    },
    async get_moment(/** @type {any} */ { id, timeline, at, selector, before_seconds = 5, after_seconds = 5 } = {}) {
      const session = await readSession()
      const before = Math.min(Math.max(Number(before_seconds) || 0, 0), 120) * 1000
      const after = Math.min(Math.max(Number(after_seconds) || 0, 0), 120) * 1000
      if (id != null && id !== "") {
        const note = await byId(id)
        const b = timelineOf(session, note.branchId)
        const rec = await recordingOf(b)
        const sel = note.selector || (note.el && note.el.selector) || null
        const component = note.component || (note.el && note.el.components && note.el.components[0]) || null
        const title = `Timeline "${b.name}" around note ${note.id} ("${note.text}") on ${sel || "an element"}:`
        if (!Array.isArray(note.anims)) return report(rec, { at: note.t, from: note.t - before, to: note.t + after, selector: sel, component, title })
        // The note knows which animations are its element's (by their recorded
        // path): the element section and the verdict come from it, so this and
        // get_note can't disagree.
        const t0 = note.range ? note.range.from : note.t
        const t1 = note.range ? note.range.to : note.t
        const ctx = { start: rec.start || 0 }
        const head = [...elementBlock(note, ctx), "", ...animationBlock(note, ctx)].join("\n")
        const ctxReport = report(rec, { at: note.t, from: t0 - before, to: t1 + after, selector: sel, component, title, known: knownOf(note) })
        return `Note ${note.id}'s element:\n${head}\n\n${ctxReport}`
      }
      if (at == null || at === "") throw new Error("get_moment needs a note id, or a timeline moment (at, like 00:10.91)")
      const b = timelineOf(session, timeline)
      const rec = await recordingOf(b)
      const t = parseTime(at) + (rec.start || 0)
      return report(rec, { at: t, from: t - before, to: t + after, selector: selector || null, title: `Timeline "${b.name}" around ${fmt(t - (rec.start || 0))}:` })
    },
    async get_animation(/** @type {any} */ { id, clip, timeline, at, from, to } = {}) {
      const session = await readSession()
      const times = (rec) => [at, from, to].filter((v) => v != null && v !== "").map((v) => parseTime(v) + (rec.start || 0))
      if (id != null && id !== "") {
        const note = await byId(id)
        const members = groupAnims(note)
        const anims = [...(note.anims || []), ...members]
        let a = clip ? anims.find((x) => String(x.id) === String(clip) || (x.runs || []).some((r) => String(r.id) === String(clip))) : primaryOf(note)
        const b = timelineOf(session, note.branchId)
        const rec = await recordingOf(b).catch(() => null)
        // A group note with no animation of its own: each member's, one after the other.
        if (!a && !clip && members.length) {
          const start = rec ? rec.start || 0 : 0
          const each = members.map((m, i) => {
            const sampled = [m.at, m.from, m.to].filter(Boolean)
            const Ts = rec && times(rec).length ? times(rec) : [...new Set(sampled.map((p) => p.T))]
            return `### ${i + 1}. ${m.selector || "element"}${m.id ? ` (clip ${m.id})` : ""}\n${animationReport(m, Ts, { start, sampled })}`
          })
          return `Group note ${note.id}: ${members.length} animations inside ${note.group.label || note.group.selector || "its element"} (get_animation with clip for one):\n\n${each.join("\n\n")}`
        }
        if (!a && rec) {
          const c = (rec.clips || []).find((x) => String(x.id) === String(clip || (note.clip && note.clip.id)))
          if (c) a = animFromClip(c)
        }
        if (!a) return `Note ${note.id} has no animation${anims.length ? ` with clip id ${clip}` : ""}: nothing animated on its element at its moment. get_moment with id "${note.id}" lists what animated nearby.`
        const sampled = [a.at, a.from, a.to, ...(a.samples || [])].filter(Boolean)
        const Ts = rec && times(rec).length ? times(rec) : sampled.length ? [...new Set([a.at, a.from, a.to].filter(Boolean).map((p) => p.T))] : []
        return `Animation of note ${note.id} on ${note.selector || (note.el && note.el.selector) || "its element"}:\n${animationReport(a, Ts, { start: rec ? rec.start || 0 : 0, sampled })}`
      }
      if (!clip) throw new Error("get_animation needs a note id, or a clip id (with a timeline)")
      const b = timelineOf(session, timeline)
      const rec = await recordingOf(b)
      const c = (rec.clips || []).find((x) => String(x.id) === String(clip))
      if (!c) throw new Error(`no clip ${clip} on timeline "${b.name}"; get_timeline_events lists them`)
      return `Timeline "${b.name}", clip ${c.id} on ${c.selector || "?"}:\n${animationReport(animFromClip(c), times(rec), { start: rec.start || 0 })}`
    },
    async get_timeline_events(/** @type {any} */ { timeline, from, to, selector, limit = 60 } = {}) {
      const session = await readSession()
      const b = timelineOf(session, timeline)
      const rec = await recordingOf(b)
      const s = rec.start || 0
      const lo = from == null || from === "" ? null : parseTime(from) + s
      const hi = to == null || to === "" ? null : parseTime(to) + s
      if (lo != null && hi != null && hi < lo) throw new Error("`to` is before `from`")
      const n = Math.min(Math.max(Number(limit) || 60, 1), 200)
      return report(rec, { from: lo, to: hi, selector: selector || null, limit: n, title: `Timeline "${b.name}":` })
    },
    async get_active_timeline() {
      const [session, c] = await Promise.all([readSession(), codeState()])
      const branches = session.branches || []
      const active = branches.find((b) => String(b.id) === String(session.activeId)) || null
      const parent = active && branches.find((b) => String(b.id) === String(active.parentId))
      return {
        active: active && { id: active.id, name: active.name, forkAt: fmt(active.forkAt), parent: parent ? parent.name : null, codeVersion: active.codeVersion || null },
        timelines: branches.map((b) => ({ id: b.id, name: b.name, parent: b.parentId, forkAt: fmt(b.forkAt), codeVersion: b.codeVersion || null })),
        openNotes: (session.notes || []).filter((n) => isOpen(n) && active && String(n.branchId) === String(active.id)).map((n) => summary(n, session)),
        ...(c
          ? {
              codeTimelines: codeMode(c),
              checkedOut: c.checkedOut != null ? { id: c.checkedOut, name: c.checkedOutName || nameIn(session, c.checkedOut), version: c.disk } : null,
              code: Object.fromEntries(Object.entries(c.timelines || {}).map(([tid, t]) => [nameIn(session, tid), { fork: t.fork, head: t.head, changed: t.changed }])),
            }
          : {}),
      }
    },
    async acknowledge({ id, message }) {
      const note = await byId(id)
      // The note's timeline becomes the one edits land on (its code on disk,
      // with code timelines on); the dock follows.
      let line = ""
      const c = await codeState()
      if (c) {
        const r = await client.codeCheckout({ branchId: note.branchId, reason: "note", note: note.id })
        if (!r || r.ok === false) throw new Error(`Not acknowledged: ${(r && r.error) || "couldn't switch to the note's timeline"}.${r && r.lease ? " Resolve that note first, or call checkout_timeline with force." : ""}`)
        const session = await readSession()
        const name = nameIn(session, note.branchId)
        line = r.enabled === true ? ` Files on disk are now ${name}'s code (version ${r.version}). Edit as usual: your changes land in ${name}.` : ` The dock is on ${name}; your edit is kept as its code${r.enabled === false ? " (code timelines are off: every timeline shares the files)" : ""}.`
      }
      const n = await client.patch(id, { status: "acknowledged", ...(message ? { reply: message } : {}) })
      return `Acknowledged note ${n.id}.${line}`
    },
    async resolve({ id, summary: text }) {
      if (!text) throw new Error("resolve needs a summary of what you changed")
      const note = await byId(id)
      // Did the edit land on the note's timeline?
      let warn = ""
      const c = await codeState()
      if (c && c.enabled === true) {
        const session = await readSession()
        const name = nameIn(session, note.branchId)
        if (c.leaseLost && String(c.leaseLost.note) === String(id)) warn = ` Note ${id} is on ${name}, but the user switched the files away while you worked (to ${nameIn(session, c.leaseLost.to)}). Call checkout_timeline "${name}" and check your edit is there, or tell the user.`
        else if (String(c.checkedOut) !== String(note.branchId)) warn = ` Note ${id} is on ${name} but your edit landed on ${c.checkedOutName || nameIn(session, c.checkedOut)} (files were its code). Call checkout_timeline "${name}" and apply it again, or tell the user.`
      }
      const n = await client.patch(id, { status: "resolved", reply: text })
      return `Resolved note ${n.id}${n.resolvedVersion ? ` (code version ${n.resolvedVersion})` : ""}.${warn}`
    },
    async checkout_timeline({ timeline, force }) {
      const session = await readSession()
      const b = timelineOf(session, timeline)
      const c = await codeState()
      if (!c) throw new Error("this dev server doesn't keep code per timeline (update retake-dev)")
      const r = await client.codeCheckout({ branchId: b.id, reason: "mcp", force: !!force })
      if (!r || r.ok === false) throw new Error(`${(r && r.error) || "couldn't switch"}${r && r.lease ? ". Pass force to take the files anyway." : ""}`)
      if (r.enabled !== true) return `The dock is on "${b.name}". Code timelines are ${r.enabled === false ? "off" : "not set up"}: every timeline shares the files, so nothing on disk changed.`
      const files = (r.files || []).map((f) => `${f.change === "delete" ? "deleted" : "wrote"} ${f.path}`)
      return `Files on disk are now ${b.name}'s code (version ${r.version}).${files.length ? `\n${files.join("\n")}` : " No files changed."}`
    },
    async get_code_diff(/** @type {any} */ { timeline, against } = {}) {
      const session = await readSession()
      const c = await codeState()
      if (!c) throw new Error("this dev server doesn't keep code per timeline (update retake-dev)")
      const b = timeline == null || timeline === "" ? timelineOf(session, c.checkedOut) : timelineOf(session, timeline)
      const other = against == null || against === "" ? null : timelineOf(session, against)
      const d = await client.codeDiff(b.id, other ? other.id : null)
      const vs = other ? `"${other.name}"` : "where it started"
      if (!d.files.length) return `"${b.name}"'s code is the same as ${vs}.`
      const list = d.files.map((f) => `${f.status} ${f.path}`).join("\n")
      return `"${b.name}"'s code (version ${d.to}) against ${vs} (version ${d.from}): ${d.files.length} file${d.files.length > 1 ? "s" : ""}\n${list}${d.patch ? `\n\n${d.patch}` : "\n\n(the diff is too large to show; read the files)"}`
    },
    async reply({ id, text }) {
      if (!text) throw new Error("reply needs text")
      await byId(id)
      await client.patch(id, { reply: text })
      return `Replied on note ${id}.`
    },
    async watch_notes({ timeout_seconds = 60 } = {}) {
      const ms = Math.min(Math.max(Number(timeout_seconds) || 60, 1), 600) * 1000
      const key = (n) => `${n.status || "pending"}|${(n.replies || []).filter((r) => r.from === "user").length}|${n.text}`
      const before = new Map(((await readSession()).notes || []).map((n) => [String(n.id), key(n)]))
      const deadline = Date.now() + ms
      while (Date.now() < deadline) {
        const got = await client.nextEvent(["session", "note-updated"], deadline - Date.now())
        if (!got) break
        const session = await readSession()
        const changed = (session.notes || []).filter((n) => before.get(String(n.id)) !== key(n))
        // Ignore what agents did (replies from "agent" don't change the key).
        if (changed.length) return { changed: changed.map((n) => ({ ...summary(n, session), new: !before.has(String(n.id)) })) }
      }
      return { changed: [] }
    },
  }
  return { list: TOOLS, handlers }
}

/** @param {{ url?: string }} [options] */
export async function runMcp({ url } = {}) {
  const client = createClient({ url: url || null })
  const tools = createTools(client)
  const send = (msg) => process.stdout.write(JSON.stringify(msg) + "\n")
  const reply = (id, result) => send({ jsonrpc: "2.0", id, result })
  const error = (id, code, message) => send({ jsonrpc: "2.0", id, error: { code, message } })

  async function handle(msg) {
    const { id, method, params } = msg
    if (method === "initialize") {
      const asked = params && params.protocolVersion
      return reply(id, {
        protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "retake", version: PKG.version },
        instructions:
          INSTRUCTIONS,
      })
    }
    if (method === "notifications/initialized" || (method && method.startsWith("notifications/"))) return
    if (method === "ping") return reply(id, {})
    if (method === "tools/list") return reply(id, { tools: tools.list })
    if (method === "tools/call") {
      const h = tools.handlers[params && params.name]
      if (!h) return error(id, -32602, `unknown tool ${params && params.name}`)
      try {
        const out = await h(params.arguments || {})
        return reply(id, { content: [{ type: "text", text: typeof out === "string" ? out : JSON.stringify(out, null, 2) }] })
      } catch (err) {
        return reply(id, { content: [{ type: "text", text: err.message }], isError: true })
      }
    }
    if (id !== undefined) error(id, -32601, `method not found: ${method}`)
  }

  let buf = ""
  let inFlight = 0
  let ended = false
  const maybeExit = () => ended && inFlight === 0 && process.exit(0)
  process.stdin.setEncoding("utf8")
  process.stdin.on("data", (chunk) => {
    buf += chunk
    let i
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim()
      buf = buf.slice(i + 1)
      if (!line) continue
      let msg
      try {
        msg = JSON.parse(line)
      } catch {
        error(null, -32700, "parse error")
        continue
      }
      inFlight++
      handle(msg)
        .catch((err) => msg.id !== undefined && error(msg.id, -32603, err.message))
        .finally(() => {
          inFlight--
          maybeExit()
        })
    }
  })
  // The client closed its end: answer what's still in flight, then leave.
  process.stdin.on("end", () => {
    ended = true
    maybeExit()
  })
}
