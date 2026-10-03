// What happened over time in a stored recording (.retake/recordings), as
// short readable text for `retake mcp`: the user's actions, animations on or
// near an element (with what they animate between), requests, page loads and
// how much of the screen changed, around a moment or over a window. Times
// read like the dock's (00:10.91, from the recording's start).
// The recording's format is the runtime's (src/runtime/30-recorder.js).

/** ms → "00:10.91" */
export const fmt = (ms) => {
  const s = Math.max(0, Number(ms) || 0) / 1000
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${(s % 60).toFixed(2).padStart(5, "0")}`
}
/** ms → "0.21s" / "1.20s" / "350ms" */
const dur = (ms) => (Math.abs(ms) < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(2)}s`)

/** "00:10.91", "10.91", "10.91s", "1:02.5", "350ms" or a number of ms → ms. */
export function parseTime(v) {
  if (v == null || v === "") return null
  if (typeof v === "number") return v
  const s = String(v).trim()
  let m
  if ((m = /^(\d+):(\d+(?:\.\d+)?)$/.exec(s))) return (Number(m[1]) * 60 + Number(m[2])) * 1000
  if ((m = /^(\d+(?:\.\d+)?)\s*ms$/.exec(s))) return Number(m[1])
  if ((m = /^(\d+(?:\.\d+)?)\s*s?$/.exec(s))) return Number(m[1]) * 1000
  throw new Error(`can't read the time "${v}"; use the dock's format, like 00:10.91`)
}

/** A recording as the server keeps it (v1, or packed v2/v3) → plain v1 form. */
export function readRecording(json) {
  const o = typeof json === "string" ? JSON.parse(json) : { ...json }
  if (!o || typeof o !== "object") return null
  if (o.v === 2 && o.paths) {
    const P = o.paths
    o.events = (o.events || []).map((ev) => {
      const out = { ...ev }
      if ("p" in out) (out.path = P[out.p]), delete out.p
      if ("rp" in out) (out.related = P[out.rp]), delete out.rp
      return out
    })
  } else if (o.v === 3) {
    const P = o.paths || []
    const S = o.strs || []
    const frames = o.frames || []
    let lastF = 0
    o.events = (o.events || []).map((ev) => {
      const out = { ...ev }
      out.type = S[out.y]
      delete out.y
      if ("p" in out) (out.path = P[out.p]), delete out.p
      if ("rp" in out) (out.related = P[out.rp]), delete out.rp
      if ("c" in out) (out.css = S[out.c]), delete out.c
      if ("f" in out) {
        lastF += out.f
        out.t = frames[lastF]
        delete out.f
      }
      return out
    })
    o.clips = (o.clips || []).map((c) => {
      const out = { ...c }
      if ("s" in out) (out.selector = S[out.s]), delete out.s
      if ("co" in out) (out.component = S[out.co]), delete out.co
      if ("l" in out) (out.label = S[out.l]), delete out.l
      if ("p" in out) (out.path = P[out.p]), delete out.p
      return out
    })
  }
  delete o.paths
  delete o.strs
  o.v = 1
  o.events = o.events || []
  o.clips = o.clips || []
  return o
}

// ---- elements --------------------------------------------------------------------------
// Clip selectors and note selectors are built the same way (an id, else
// tag.class chains with :nth-of-type), but classes change over time
// (".off" → ".on"), so they're also compared without classes.
const bare = (sel) => String(sel || "").replace(/::?(before|after|marker|placeholder|backdrop)$/, "").replace(/\.[\w-]+(?:\\.[\w-]*)*/g, "")
const under = (a, b) => a.startsWith(b + " > ") // a is inside b
/** How a clip's element relates to the noted one: "on" | "inside" | "around" | null. */
export function relation(clipSel, noteSel) {
  if (!clipSel || !noteSel) return null
  const c = String(clipSel).replace(/::?(before|after|marker|placeholder|backdrop)$/, "")
  const n = String(noteSel)
  if (c === n || bare(c) === bare(n)) return "on"
  if (under(c, n) || under(bare(c), bare(n))) return "inside"
  if (under(n, c) || under(bare(n), bare(c))) {
    const depth = bare(n).slice(bare(c).length).split(" > ").length - 1
    return depth <= 4 ? "around" : null
  }
  return null
}

// ---- what happened -------------------------------------------------------------------
const SECRET = /pass|pwd|secret|token|card|cvv|cvc|ssn|otp/i
const MODS = ["ctrlKey", "metaKey", "altKey", "shiftKey"]
const NAMED_KEYS = /^(Enter|Escape|Tab|Backspace|Delete|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Home|End|PageUp|PageDown| )$/
const quote = (s, n = 40) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim()
  return `"${t.length > n ? t.slice(0, n - 1) + "…" : t}"`
}
const pathOfUrl = (u) => {
  try {
    const x = new URL(u)
    x.searchParams.delete("__wb")
    return x.pathname + x.search + x.hash
  } catch {
    return String(u || "")
  }
}

/** The user's actions, routes, page loads and requests, as [{ t, end?, kind, text, selector? }]. */
export function happenings(rec) {
  const out = []
  const start = rec.start || 0
  /** @type {any} */
  let burst = null
  /** @type {any} */
  let keys = null
  /** @type {any} */
  let scroll = null
  for (const ev of rec.events) {
    if (ev.t == null || ev.t < start) continue
    if (ev.type === "click") {
      const prev = out[out.length - 1]
      if (prev && prev.kind === "focus" && prev.selector === ev.css && ev.t - prev.t < 1000) out.pop()
      out.push({ t: ev.t, kind: "click", text: `click ${ev.label ? quote(ev.label) + " " : ""}(${ev.css || "?"})`, selector: ev.css })
    } else if (ev.type === "submit") out.push({ t: ev.t, kind: "submit", text: `submit ${ev.css || "a form"}`, selector: ev.css })
    else if (ev.type === "focusin" && ev.editable) {
      const prev = out[out.length - 1]
      if (!(prev && prev.kind === "click" && prev.selector === ev.css && ev.t - prev.t < 50)) out.push({ t: ev.t, kind: "focus", text: `focus ${ev.label ? quote(ev.label) + " " : ""}(${ev.css || "a field"})`, selector: ev.css })
    } else if (ev.type === "input") {
      const typed = /^insert/.test(ev.inputType || "insertText") ? (ev.data ? ev.data.length : 1) : 0
      const hide = SECRET.test(`${ev.css || ""} ${ev.label || ""}`)
      if (burst && burst.selector === ev.css && ev.t - burst.end < 800) {
        burst.end = ev.t
        burst.chars += typed
      } else {
        burst = { t: ev.t, end: ev.t, kind: "type", chars: typed, selector: ev.css, hide }
        out.push(burst)
      }
      burst.value = ev.value
    } else if (ev.type === "change" && (ev.checked != null || /select/i.test(ev.css || ""))) {
      const text = ev.checked != null ? `${ev.checked ? "checked" : "unchecked"} ${ev.css || "a box"}` : `chose ${quote(ev.value)} in ${ev.css}`
      out.push({ t: ev.t, kind: "change", text, selector: ev.css })
    } else if (ev.type === "keydown" && !ev.inField && ev.key && (NAMED_KEYS.test(ev.key) || MODS.some((m) => ev[m]))) {
      if (/^(Control|Meta|Alt|Shift)$/.test(ev.key)) continue
      const name = [...MODS.filter((m) => ev[m]).map((m) => ({ ctrlKey: "Ctrl", metaKey: "⌘", altKey: "Alt", shiftKey: "Shift" })[m]), ev.key === " " ? "Space" : ev.key].join("+")
      if (keys && keys.name === name && ev.t - keys.end < 1000) {
        keys.end = ev.t
        keys.n++
      } else out.push((keys = { t: ev.t, end: ev.t, kind: "key", name, n: 1 }))
    } else if (ev.type === "nav") out.push({ t: ev.t, kind: "nav", text: `back/forward to ${pathOfUrl(ev.url)}` })
    else if (ev.type === "scroll") {
      const where = ev.path === "d" ? "the page" : "an element"
      if (scroll && scroll.where === where && ev.t - scroll.end < 600) {
        scroll.end = ev.t
        scroll.top = ev.top
      } else out.push((scroll = { t: ev.t, end: ev.t, kind: "scroll", where, top: ev.top }))
    }
  }
  for (const h of out) {
    if (h.kind === "type") {
      h.text = `typed ${h.chars} char${h.chars === 1 ? "" : "s"} in ${h.selector || "a field"}${h.hide || h.value == null || /</.test(h.value) ? "" : ` (now ${quote(h.value)})`}`
      delete h.value
    } else if (h.kind === "key") h.text = `key ${h.name}${h.n > 1 ? ` ×${h.n}` : ""}`
    else if (h.kind === "scroll") h.text = `scrolled ${h.where} to ${Math.round(h.top || 0)}px`
    if (h.end === h.t) delete h.end
  }
  for (const r of rec.routes || []) if (r.t >= start && r.t > 0) out.push({ t: r.t, kind: "route", text: `route → ${r.path}` })
  for (const s of rec.segments || []) out.push({ t: s.t, kind: "load", text: `page loaded: ${pathOfUrl(s.url)}` })
  out.push(...requests(rec))
  // At the same moment, what the user did comes before what it set off.
  const rank = (h) => (h.kind === "request" ? 2 : h.kind === "route" || h.kind === "load" ? 1 : 0)
  return out.sort((a, b) => a.t - b.t || rank(a) - rank(b))
}

// Recorded requests: when they went out, when they finished, how they ended.
function requests(rec) {
  const ends = new Map()
  for (const ev of rec.events) if (ev.type === "net" && (ev.kind === "end" || ev.kind === "done" || ev.kind === "close")) ends.set(`${ev.list}:${ev.i}`, ev.t)
  const out = []
  const kinds = { fetches: "", xhrs: "XHR ", sses: "EventSource ", sockets: "WebSocket " }
  for (const list of Object.keys(kinds)) {
    ;(rec[list] || []).forEach((e, i) => {
      if (!e || e.t0 == null) return
      const key = String(e.key || "").replace(/ (rsc|next-router-[\w-]+|next-action)=\S+/g, (m) => (/next-action/.test(m) ? " (server action)" : /rsc/.test(m) ? " (RSC)" : ""))
      const end = ends.get(`${list}:${i}`)
      const how = e.fail ? `failed (${e.fail})` : e.error ? "failed" : e.status ? `${e.status}` : list === "fetches" || list === "xhrs" ? "no answer recorded" : "opened"
      out.push({ t: e.t0, end, kind: "request", text: `${kinds[list]}${key} → ${how}${end != null && end > e.t0 ? ` (${dur(end - e.t0)})` : ""}` })
    })
  }
  return out
}

// "css-animation `fade-in` (opacity, transform)", "opacity transition"
function clipName(c) {
  const what = c.kind === "transition" ? `${c.property || "?"} transition` : c.kind === "css-animation" ? `animation \`${c.label}\`${c.property ? ` (${c.property})` : ""}` : `animation (${c.property || c.label || "waapi"})`
  return what
}
function values(c) {
  if (!c.from || !c.to) return ""
  const keys = [...new Set([...Object.keys(c.from), ...Object.keys(c.to)])]
  return keys.map((k) => `${k} ${c.from[k] ?? "?"} → ${c.to[k] ?? "?"}`).join(", ")
}
const clipEnd = (c, rec) => (c.end == null ? Math.max(rec.end || 0, c.start) : c.end)

function clipLine(c, rec, at) {
  const s = rec.start || 0
  const loops = c.iterations === "infinite"
  const span = c.end == null ? `${fmt(c.start - s)} → ${loops ? `looping${c.dur ? ` (${dur(c.dur)} each)` : ""}` : "still running"}` : `${fmt(c.start - s)} → ${fmt(c.end - s)} (${dur(c.end - c.start)}${c.iterations > 1 ? `, ${c.iterations}×` : ""})`
  const bits = [`${span} ${clipName(c)} on ${c.selector || "?"}${c.component ? ` [${c.component}]` : ""}`]
  const v = values(c)
  if (v) bits.push(v)
  if (c.delay) bits.push(`after a ${dur(c.delay)} delay`)
  if (at != null) {
    const end = clipEnd(c, rec)
    if (at < c.start) bits.push(`starts ${dur(c.start - at)} after the moment`)
    else if (at > end) bits.push(`ended ${dur(at - end)} before the moment`)
    else if (c.end != null && c.end > c.start) bits.push(`running at the moment, ${Math.round(((at - c.start) / (c.end - c.start)) * 100)}% through`)
    else bits.push("running at the moment")
  }
  return `- ${bits.join("; ")} (clip ${c.id})`
}

/**
 * The report. Either a moment (`at`, with a window around it) or a window.
 * @param {any} rec a readRecording() result
 * @param {{ at?: number | null, from?: number | null, to?: number | null, selector?: string | null, component?: string | null,
 *   title?: string, limit?: number, known?: { rel: Map<string, string>, running: string[] } | null }} opts times in the recording's own clock (ms);
 *   `known`: a note's own word on which clips are its element's (by recorded path) and what was running, used instead of selectors
 */
export function report(rec, { at = null, from = null, to = null, selector = null, component = null, title = "", limit = 40, known = null } = {}) {
  const s = rec.start || 0
  const end = Math.max(rec.end || 0, s)
  const lo = Math.max(s, from ?? s)
  const hi = Math.min(end, to ?? end)
  const lines = []
  if (title) lines.push(title)
  lines.push(`Window: ${fmt(lo - s)} → ${fmt(hi - s)} of a ${fmt(end - s)} recording${at != null ? `; the moment is ${fmt(at - s)}` : ""}.`)

  // Animations on or near the element.
  const overlaps = (c) => c.start <= hi && clipEnd(c, rec) >= lo
  if (selector) {
    const relOf = (c) => (known ? known.rel.get(String(c.id)) || null : relation(c.selector, selector) || (component && c.component === component ? "same component" : null))
    const near = rec.clips.map((c) => ({ c, rel: relOf(c) })).filter((x) => x.rel)
    const inWin = near.filter((x) => overlaps(x.c))
    lines.push("", `Animations on or near ${selector}${component ? ` [${component}]` : ""}:`)
    if (!inWin.length) lines.push("- none in this window")
    const order = { on: 0, inside: 1, around: 2, "same component": 3 }
    inWin.sort((a, b) => (order[a.rel] ?? 0.5) - (order[b.rel] ?? 0.5) || a.c.start - b.c.start)
    for (const { c, rel } of inWin.slice(0, 12)) lines.push(clipLine(c, rec, at).replace(/^- /, `- (${rel}) `))
    if (inWin.length > 12) lines.push(`- …and ${inWin.length - 12} more`)
    const outside = near.filter((x) => !overlaps(x.c) && x.rel === "on")
    if (outside.length) lines.push(`Outside the window this element also animates at: ${outside.slice(0, 6).map(({ c }) => `${fmt(c.start - s)} (${c.kind === "transition" ? `${c.property} transition` : c.label})`).join(", ")}${outside.length > 6 ? `, +${outside.length - 6} more` : ""}.`)
    if (known) lines.push(known.running.length ? `At the note's moment it is mid-animation (the note says): ${known.running.join(", ")}.` : "At the note's moment nothing on it is animating (the note says so; see above for what came before and after).")
    else if (at != null) {
      const running = inWin.filter(({ c, rel }) => (rel === "on" || rel === "inside") && c.start <= at && at <= clipEnd(c, rec))
      lines.push(running.length ? `At the moment it is mid-animation: ${running.map(({ c }) => clipName(c)).join(", ")}.` : "At the moment nothing on it is animating (see above for what came before and after).")
    }
  }

  // What happened, in order.
  const all = happenings(rec).filter((h) => h.t <= hi && (h.end ?? h.t) >= lo)
  let shown = all
  let dropped = 0
  if (all.length > limit) {
    const ref = at ?? (lo + hi) / 2
    shown = [...all].sort((a, b) => Math.abs(a.t - ref) - Math.abs(b.t - ref)).slice(0, limit).sort((a, b) => a.t - b.t)
    dropped = all.length - shown.length
  }
  lines.push("", "What happened (user actions, routes, page loads, requests):")
  /** @type {Array<{ t: number, line: string, moment?: boolean }>} */
  const marks = shown.map((h) => ({ t: h.t, line: `- ${fmt(h.t - s)}${h.end != null && h.kind !== "request" ? `–${fmt(h.end - s)}` : ""} ${h.text}` }))
  if (at != null) marks.push({ t: at, line: `- ${fmt(at - s)} ◆ the moment`, moment: true })
  marks.sort((a, b) => a.t - b.t || (a.moment ? 1 : b.moment ? -1 : 0))
  if (!shown.length) lines.push("- nothing recorded in this window")
  lines.push(...marks.map((m) => m.line))
  if (dropped) lines.push(`(${dropped} more not shown, the furthest from ${at != null ? "the moment" : "the middle"}; ask for a narrower window)`)
  if (at != null) {
    const acts = happenings(rec).filter((h) => ["click", "submit", "type", "key", "change", "focus", "nav"].includes(h.kind))
    const before = acts.filter((h) => h.t <= at).pop()
    const after = acts.find((h) => h.t > at)
    lines.push(`Last action before the moment: ${before ? `${before.text} at ${fmt(before.t - s)} (${dur(at - before.t)} earlier)` : "none"}. Next after: ${after ? `${after.text} at ${fmt(after.t - s)}` : "none"}.`)
  }

  // Animations elsewhere on the page.
  const others = rec.clips.filter((c) => overlaps(c) && !(selector && (known ? known.rel.has(String(c.id)) : relation(c.selector, selector))))
  if (others.length) {
    const groups = new Map()
    for (const c of others) {
      const key = `${clipName(c)} on ${c.selector}`
      const g = groups.get(key) || { c, n: 0 }
      g.n++
      groups.set(key, g)
    }
    const list = [...groups.values()].sort((a, b) => (at != null ? Math.abs(a.c.start - at) - Math.abs(b.c.start - at) : a.c.start - b.c.start))
    lines.push("", `${selector ? "Other animations" : "Animations"} in this window (${others.length}):`)
    for (const g of list.slice(0, selector ? 6 : 15)) lines.push(clipLine(g.c, rec, at) + (g.n > 1 ? ` ×${g.n}` : ""))
    if (list.length > (selector ? 6 : 15)) lines.push(`- …and ${list.length - (selector ? 6 : 15)} more kinds`)
  }

  // How much of the screen changed: the biggest moments.
  const act = rec.activity
  if (act && Array.isArray(act.v)) {
    const peaks = act.v
      .map((v, i) => ({ t: act.start + i * act.step, v }))
      .filter((p) => p.t >= lo && p.t <= hi && p.v >= 10)
      .sort((a, b) => b.v - a.v)
      .slice(0, 3)
      .sort((a, b) => a.t - b.t)
    if (peaks.length) lines.push("", `Screen changed most at: ${peaks.map((p) => `${fmt(p.t - s)} (${p.v}% of the view)`).join(", ")}.`)
  }
  return lines.join("\n")
}
