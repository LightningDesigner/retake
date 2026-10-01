// The dev-server side of the dock: session + recordings persisted under
// <root>/.retake, notes that agents can update, and an SSE stream so the dock
// hears about changes live. See CONTRACT.md ("Server HTTP").
//
//   GET/PUT  /__wayback/session
//   GET/PUT/DELETE /__wayback/recording/:branchId
//   GET      /__wayback/notes
//   GET      /__wayback/notes/:id
//   PATCH    /__wayback/notes/:id          { status?, reply? }
//   GET      /__wayback/events             SSE: note-updated, code-version, active-changed, session
//
// Mutating requests need `x-wayback-token`. The token is injected into the
// shell page and written to <root>/.retake/server.json for local tools (MCP).
import fs from "node:fs"
import path from "node:path"
import zlib from "node:zlib"
import { promisify } from "node:util"

const gzip = promisify(zlib.gzip)
const gunzip = promisify(zlib.gunzip)

const STATUSES = new Set(["pending", "acknowledged", "resolved", "dismissed"])
const MAX_BODY = 256 * 1024 * 1024
const EMPTY = () => ({ branches: [], activeId: null, markers: [], notes: [] })

export function createBus() {
  const clients = new Set()
  return {
    clients,
    emit(event, data) {
      const msg = `event: ${event}\ndata: ${JSON.stringify(data ?? {})}\n\n`
      for (const res of clients) res.write(msg)
    },
  }
}

export function sessionStore(root) {
  const dir = path.join(root, ".retake")
  const recDir = path.join(dir, "recordings")
  const sessionFile = path.join(dir, "session.json")
  fs.mkdirSync(recDir, { recursive: true })
  const ignore = path.join(dir, ".gitignore")
  if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, "*\n")

  const atomic = (file, data) => {
    const tmp = `${file}.${process.pid}-${Date.now()}.tmp`
    fs.writeFileSync(tmp, data)
    fs.renameSync(tmp, file)
  }
  const recFile = (id) => {
    if (!/^[\w-]{1,64}$/.test(String(id))) throw Object.assign(new Error("bad branch id"), { status: 400 })
    return path.join(recDir, `${id}.json`)
  }
  return {
    dir,
    getSession() {
      try {
        return { ...EMPTY(), ...JSON.parse(fs.readFileSync(sessionFile, "utf8")) }
      } catch {
        return EMPTY()
      }
    },
    putSession(s) {
      atomic(sessionFile, JSON.stringify({ ...EMPTY(), ...s }))
    },
    // Recordings are gzipped on disk (JSON compresses ~10×), written off the
    // request path and atomically.
    async getRecording(id) {
      const f = recFile(id)
      try {
        return (await gunzip(await fs.promises.readFile(f + ".gz"))).toString("utf8")
      } catch {}
      try {
        return await fs.promises.readFile(f, "utf8") // older, uncompressed
      } catch {
        return null
      }
    },
    async putRecording(id, text) {
      const f = recFile(id)
      const tmp = `${f}.gz.${process.pid}-${Date.now()}.tmp`
      await fs.promises.writeFile(tmp, await gzip(text, { level: 6 }))
      await fs.promises.rename(tmp, f + ".gz")
      fs.rmSync(f, { force: true })
    },
    deleteRecording(id) {
      const f = recFile(id)
      fs.rmSync(f, { force: true })
      fs.rmSync(f + ".gz", { force: true })
    },
    // Drop recordings of branches the session no longer has ("Start fresh", deletes).
    prune(session) {
      const keep = new Set((session.branches || []).map((b) => `${b.id}.json`))
      for (const f of fs.readdirSync(recDir)) {
        const base = f.replace(/\.gz$/, "")
        if (base.endsWith(".json") && !keep.has(base)) fs.rmSync(path.join(recDir, f), { force: true })
      }
    },
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on("data", (c) => {
      size += c.length
      if (size > MAX_BODY) {
        reject(Object.assign(new Error("body too large"), { status: 413 }))
        req.destroy()
      } else chunks.push(c)
    })
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
    req.on("error", reject)
  })
}

// Apply a PATCH to a note: a status change and/or a reply.
export function patchNote(note, body, from = "agent") {
  if (body.status != null) {
    if (!STATUSES.has(body.status)) throw Object.assign(new Error(`status must be one of ${[...STATUSES].join(", ")}`), { status: 400 })
    note.status = body.status
  }
  if (body.reply != null) {
    const text = typeof body.reply === "string" ? body.reply : body.reply.text
    if (!text) throw Object.assign(new Error("reply needs text"), { status: 400 })
    note.replies = [...(note.replies || []), { from: body.reply.from || from, text: String(text), at: Date.now() }]
  }
  if (!note.status) note.status = "pending"
  if (!note.replies) note.replies = []
  return note
}

export function sessionApi(server, { token, bus }) {
  const root = server.config.root
  const store = sessionStore(root)
  const address = () => {
    const a = server.httpServer && server.httpServer.address()
    const port = a && typeof a === "object" ? a.port : server.config.server.port
    return `${server.config.server.https ? "https" : "http"}://localhost:${port}`
  }
  const writeServerInfo = () => {
    try {
      fs.writeFileSync(path.join(store.dir, "server.json"), JSON.stringify({ url: address(), base: server.config.base || "/", token, pid: process.pid }), { mode: 0o600 })
    } catch {}
  }
  if (server.httpServer) server.httpServer.once("listening", writeServerInfo)
  else writeServerInfo()
  const cleanup = () => {
    try {
      const info = JSON.parse(fs.readFileSync(path.join(store.dir, "server.json"), "utf8"))
      if (info.pid === process.pid) fs.rmSync(path.join(store.dir, "server.json"), { force: true })
    } catch {}
  }
  process.once("exit", cleanup)

  const heartbeat = setInterval(() => {
    for (const res of bus.clients) res.write(": ping\n\n")
  }, 25_000)
  heartbeat.unref()

  const send = (res, code, body, type = "application/json") => {
    res.statusCode = code
    res.setHeader("Content-Type", type)
    res.setHeader("Cache-Control", "no-store")
    res.end(typeof body === "string" ? body : JSON.stringify(body))
  }

  server.middlewares.use(async (req, res, next) => {
    const url = new URL(req.url, "http://x")
    const p = url.pathname
    if (!p.startsWith("/__wayback/")) return next()
    const route = p.slice("/__wayback/".length).split("/")
    const mutating = req.method !== "GET" && req.method !== "HEAD"
    if (route[0] === "tailwind" && req.method === "GET") {
      // Where Tailwind is configured: a v3 config file, or (v4) the CSS that imports it.
      const cfg = ["tailwind.config.ts", "tailwind.config.js", "tailwind.config.mjs", "tailwind.config.cjs"].find((f) => fs.existsSync(path.join(root, f)))
      let config = cfg || null
      if (!config) {
        const walk = (d, depth) => {
          if (depth > 4 || config) return
          for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            if (config || e.name.startsWith(".") || e.name === "node_modules" || e.name === "dist") continue
            const f = path.join(d, e.name)
            if (e.isDirectory()) walk(f, depth + 1)
            else if (/\.css$/.test(e.name) && /@import\s+["']tailwindcss/.test(fs.readFileSync(f, "utf8"))) config = path.relative(root, f)
          }
        }
        try {
          walk(root, 0)
        } catch {}
      }
      return send(res, 200, { config })
    }
    const known = ["session", "recording", "notes", "events"].includes(route[0])
    if (!known) return next() // e.g. /__wayback/version and /checkout (code-versions)
    if (mutating && req.headers["x-wayback-token"] !== token) return send(res, 403, { error: "missing or wrong x-wayback-token" })
    try {
      if (route[0] === "events" && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" })
        res.write(": retake\n\n")
        bus.clients.add(res)
        req.on("close", () => bus.clients.delete(res))
        return
      }
      if (route[0] === "session" && route.length === 1) {
        if (req.method === "GET") return send(res, 200, store.getSession())
        if (req.method === "PUT") {
          const before = store.getSession()
          const next = JSON.parse(await readBody(req))
          store.putSession(next)
          store.prune(next)
          if (next.activeId !== before.activeId) bus.emit("active-changed", { activeId: next.activeId })
          bus.emit("session", { at: Date.now() })
          return send(res, 200, { ok: true })
        }
      }
      if (route[0] === "recording" && route.length === 2) {
        const id = decodeURIComponent(route[1])
        if (req.method === "GET") {
          const text = await store.getRecording(id)
          return text == null ? send(res, 404, { error: "no recording" }) : send(res, 200, text)
        }
        if (req.method === "PUT") {
          const text = await readBody(req)
          JSON.parse(text) // must be valid JSON
          await store.putRecording(id, text)
          return send(res, 200, { ok: true })
        }
        if (req.method === "DELETE") {
          store.deleteRecording(id)
          return send(res, 200, { ok: true })
        }
      }
      if (route[0] === "notes") {
        const session = store.getSession()
        const notes = session.notes || []
        if (route.length === 1 && req.method === "GET") return send(res, 200, notes)
        const id = route[1] && decodeURIComponent(route[1])
        const note = notes.find((n) => String(n.id) === String(id))
        if (route.length === 2 && req.method === "GET") return note ? send(res, 200, note) : send(res, 404, { error: "no such note" })
        if (route.length === 2 && req.method === "PATCH") {
          if (!note) return send(res, 404, { error: "no such note" })
          patchNote(note, JSON.parse((await readBody(req)) || "{}"), req.headers["x-retake-from"] === "user" ? "user" : "agent")
          store.putSession(session)
          bus.emit("note-updated", note)
          return send(res, 200, note)
        }
      }
      return send(res, 405, { error: `${req.method} not supported on ${p}` })
    } catch (err) {
      return send(res, err.status || (err instanceof SyntaxError ? 400 : 500), { error: err.message })
    }
  })
  return { store, address }
}
