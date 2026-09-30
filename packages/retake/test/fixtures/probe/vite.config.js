// Mock API used by the probes. Also stands in for "a project with its own plugin".
let hits = 0
export default {
  plugins: [{
    name: "mock-api",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const u = new URL(req.url, "http://x")
        if (u.pathname === "/api/json") { hits++; res.setHeader("content-type", "application/json"); return res.end(JSON.stringify({ hits, q: u.search })) }
        if (u.pathname === "/api/xhr") { hits++; return res.end("xhr-" + hits) }
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
