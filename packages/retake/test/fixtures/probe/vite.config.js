// Mock API used by the probes. Also stands in for "a project with its own plugin".
import crypto from "node:crypto"
let hits = 0
const banners = {} // /api/banner.js loads per run
const counts = {} // /api/count hits per id
// Minimal WebSocket server (text frames only) for the probes.
function wsFrame(text) {
  const b = Buffer.from(text)
  const head = b.length < 126 ? Buffer.from([0x81, b.length]) : Buffer.from([0x81, 126, b.length >> 8, b.length & 255])
  return Buffer.concat([head, b])
}
export default {
  plugins: [{
    name: "mock-api",
    configureServer(server) {
      server.httpServer.on("upgrade", (req, socket) => {
        if (!req.url.startsWith("/ws-probe")) return
        const accept = crypto.createHash("sha1").update(req.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64")
        socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`)
        hits++
        let i = 0
        const t = setInterval(() => {
          socket.write(wsFrame(`ws${i}-${hits}`))
          if (++i === 3) { clearInterval(t); socket.end(Buffer.from([0x88, 0])) }
        }, 200)
        socket.on("error", () => clearInterval(t))
      })
      server.middlewares.use((req, res, next) => {
        const u = new URL(req.url, "http://x")
        if (u.pathname === "/api/json") { hits++; res.setHeader("content-type", "application/json"); return res.end(JSON.stringify({ hits, q: u.search })) }
        if (u.pathname === "/api/bytes") { hits++; return res.end(Buffer.from(Array.from({ length: 256 }, (_, i) => (i + hits) & 255))) }
        if (u.pathname === "/api/echo" && req.method === "POST") {
          let body = ""; req.on("data", (c) => (body += c)); req.on("end", () => { hits++; res.end(JSON.stringify({ body, hits })) }); return
        }
        if (u.pathname === "/api/llm") {
          res.setHeader("content-type", "text/plain")
          const words = ["Once ", "upon ", "a ", "time ", "there ", "was ", "a ", "prototype."]
          let i = 0
          const t = setInterval(() => { res.write(words[i]); if (++i === words.length) { clearInterval(t); res.end() } }, 120)
          return
        }
        if (u.pathname === "/api/tone.wav") {
          // 0.2s of silence, served slowly like a big background video
          const rate = 8000, n = rate / 5, b = Buffer.alloc(44 + n)
          b.write("RIFF", 0); b.writeUInt32LE(36 + n, 4); b.write("WAVEfmt ", 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22)
          b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write("data", 36); b.writeUInt32LE(n, 40); b.fill(128, 44)
          return setTimeout(() => { res.setHeader("content-type", "audio/wav"); res.end(b) }, 700)
        }
        if (u.pathname === "/api/pic.svg") {
          return setTimeout(() => { res.setHeader("content-type", "image/svg+xml"); res.end('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>') }, 600)
        }
        if (u.pathname === "/api/xhr") { hits++; return res.end("xhr-" + hits) }
        // A third-party script: quick the first time a run asks, slow after (F51).
        if (u.pathname === "/api/banner.js") {
          const run = u.searchParams.get("run")
          const n = (banners[run] = (banners[run] || 0) + 1)
          return setTimeout(() => {
            res.setHeader("content-type", "text/javascript")
            res.setHeader("cache-control", "no-store")
            res.end('document.body.appendChild(Object.assign(document.createElement("div"), { id: "banner", textContent: "cookies" }))')
          }, n === 1 ? 20 : 1500)
        }
        // A slow request, counted per id (F52); ?hits reads the count.
        if (u.pathname === "/api/count") {
          const id = u.searchParams.get("id")
          if (u.searchParams.has("hits")) return res.end(String(counts[id] || 0))
          counts[id] = (counts[id] || 0) + 1
          return setTimeout(() => res.end("counted-" + counts[id]), 1500)
        }
        if (u.pathname === "/api/slow") { return setTimeout(() => res.end("slow"), 2500) }
        if (u.pathname === "/api/stream") {
          res.setHeader("content-type", "text/plain")
          let i = 0
          const t = setInterval(() => { res.write("chunk" + i + ";"); if (++i === 5) { clearInterval(t); res.end() } }, 300)
          return
        }
        if (u.pathname === "/api/sse") {
          res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" })
          let i = 0
          const t = setInterval(() => { res.write(`data: sse${i}-${hits}\n\n`); if (++i === 4) { clearInterval(t); res.end() } }, 250)
          req.on("close", () => clearInterval(t))
          return
        }
        next()
      })
    },
  }],
}
