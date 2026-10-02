// `retake mcp`: an MCP server (stdio, JSON-RPC 2.0, one message per line) that
// lets a coding agent read the notes left in the dock and answer them. It
// talks to the running dev server over HTTP (CONTRACT.md "Server HTTP"), so
// changes show up in the dock live.
//
//   claude mcp add retake -- npx -y retake-dev mcp
//
// Finds the dev server from --url / RETAKE_URL, else <cwd or a parent>/.retake/server.json.
import fs from "node:fs"
import path from "node:path"

const PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"]
const PKG = JSON.parse(fs.readFileSync(new URL("../../package.json", import.meta.url), "utf8"))

function findServerInfo(from = process.cwd()) {
  for (let dir = path.resolve(from); ; dir = path.dirname(dir)) {
    const f = path.join(dir, ".retake", "server.json")
    if (fs.existsSync(f)) {
      try {
        return JSON.parse(fs.readFileSync(f, "utf8"))
      } catch {}
    }
    if (path.dirname(dir) === dir) return null
  }
}

export function createClient({ url, token } = {}) {
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
        headers: body !== undefined || method !== "GET" ? { "content-type": "application/json", "x-retake-token": await getToken() } : {},
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    } catch (err) {
      throw new Error(`can't reach the Retake dev server at ${base()} (${err.cause ? err.cause.code || err.cause.message : err.message}). Is it running?`)
    }
    const text = await res.text()
    if (!res.ok) throw new Error(`${method} ${p} → ${res.status}: ${text.slice(0, 200)}`)
    return text ? JSON.parse(text) : null
  }
  return {
    base,
    session: () => call("GET", "/__retake/session"),
    notes: () => call("GET", "/__retake/notes"),
    note: (id) => call("GET", `/__retake/notes/${encodeURIComponent(id)}`),
    patch: (id, body) => call("PATCH", `/__retake/notes/${encodeURIComponent(id)}`, body),
    // Resolves on the next matching SSE event (or null after `ms`).
    async nextEvent(types, ms) {
      const ac = new AbortController()
      const timer = setTimeout(() => ac.abort(), ms)
      try {
        const res = await fetch(base() + "/__retake/events", { signal: ac.signal })
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

const fmt = (ms) => {
  const s = Math.max(0, Number(ms) || 0) / 1000
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${(s % 60).toFixed(2).padStart(5, "0")}`
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
    source: n.source ? `${n.source.file}${n.source.line ? ":" + n.source.line : ""}` : null,
    replies: (n.replies || []).length,
  }
}

function clipText(c) {
  const name = c.label ? `${c.label} ` : ""
  const at = `${Math.round(Number(c.offset) || 0)}ms into`
  return Number(c.duration) > 0 ? `${at} a ${Math.round(c.duration)}ms ${name}animation (clip ${c.id})` : `${at} a running ${name}animation (clip ${c.id})`
}

// Everything an agent needs to act on one note, as readable text.
function describe(n, session) {
  const b = (session.branches || []).find((x) => String(x.id) === String(n.branchId))
  const parent = b && (session.branches || []).find((x) => String(x.id) === String(b.parentId))
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
    n.source ? `Source: ${n.source.file}${n.source.line ? ":" + n.source.line : ""}` : null,
    n.classes && n.classes.length ? `Classes: ${[].concat(n.classes).join(" ")}` : null,
    n.rect ? `Box: ${Math.round(n.rect.w)}×${Math.round(n.rect.h)} at (${Math.round(n.rect.x)}, ${Math.round(n.rect.y)})` : null,
    n.clip ? `During an animation: ${clipText(n.clip)}` : null,
    el.page ? `Page: ${el.page}` : null,
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
    description: "Everything about one note: what the user asked, the element (selector, React component, source file:line, classes, size), the moment and timeline, and the conversation so far.",
    inputSchema: { type: "object", properties: { id: { type: ["string", "number"] } }, required: ["id"] },
  },
  {
    name: "get_active_timeline",
    description: "Which timeline the user is looking at in the Retake dock, how it relates to the others (branch point, code version) and its open notes.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "acknowledge",
    description: "Tell the user you've seen a note and are working on it (its pin turns to 'acknowledged' in the dock). Optionally add a short message.",
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
    name: "watch_notes",
    description: "Wait until the user adds a note or replies to one, then return what changed. Returns an empty list on timeout.",
    inputSchema: { type: "object", properties: { timeout_seconds: { type: "number", description: "How long to wait (default 60, max 600)" } } },
  },
]

const isOpen = (n) => !n.status || n.status === "pending" || n.status === "acknowledged"

export function createTools(client) {
  const byId = async (id) => {
    const note = await client.note(id).catch((err) => {
      if (/→ 404/.test(err.message)) throw new Error(`no note with id ${id}; list_notes shows the ids`)
      throw err
    })
    return note
  }
  const handlers = {
    async list_notes({ status = "open" } = {}) {
      const session = await client.session()
      const notes = (session.notes || []).filter((n) => (status === "all" ? true : status === "open" ? isOpen(n) : (n.status || "pending") === status))
      return { count: notes.length, notes: notes.map((n) => summary(n, session)) }
    },
    async get_note({ id }) {
      const [session, note] = await Promise.all([client.session(), byId(id)])
      return describe(note, session)
    },
    async get_active_timeline() {
      const session = await client.session()
      const branches = session.branches || []
      const active = branches.find((b) => String(b.id) === String(session.activeId)) || null
      const parent = active && branches.find((b) => String(b.id) === String(active.parentId))
      return {
        active: active && { id: active.id, name: active.name, forkAt: fmt(active.forkAt), parent: parent ? parent.name : null, codeVersion: active.codeVersion || null },
        timelines: branches.map((b) => ({ id: b.id, name: b.name, parent: b.parentId, forkAt: fmt(b.forkAt), codeVersion: b.codeVersion || null })),
        openNotes: (session.notes || []).filter((n) => isOpen(n) && active && String(n.branchId) === String(active.id)).map((n) => summary(n, session)),
      }
    },
    async acknowledge({ id, message }) {
      await byId(id)
      const n = await client.patch(id, { status: "acknowledged", ...(message ? { reply: message } : {}) })
      return `Acknowledged note ${n.id}.`
    },
    async resolve({ id, summary: text }) {
      if (!text) throw new Error("resolve needs a summary of what you changed")
      await byId(id)
      const n = await client.patch(id, { status: "resolved", reply: text })
      return `Resolved note ${n.id}.`
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
      const before = new Map(((await client.session()).notes || []).map((n) => [String(n.id), key(n)]))
      const deadline = Date.now() + ms
      while (Date.now() < deadline) {
        const got = await client.nextEvent(["session", "note-updated"], deadline - Date.now())
        if (!got) break
        const session = await client.session()
        const changed = (session.notes || []).filter((n) => before.get(String(n.id)) !== key(n))
        // Ignore what agents did (replies from "agent" don't change the key).
        if (changed.length) return { changed: changed.map((n) => ({ ...summary(n, session), new: !before.has(String(n.id)) })) }
      }
      return { changed: [] }
    },
  }
  return { list: TOOLS, handlers }
}

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
        instructions: "Notes are change requests the user left on elements of their prototype in the Retake timeline. list_notes, then get_note for details; acknowledge when you start, resolve with a summary when done.",
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
