// Dev-only middleware for the "Try it" demo: a fake chat reply that streams
// token by token, so Retake has a real network reply to record.
const REPLIES = [
  "Sure. Slow the card exit to 240ms and let the next one overlap by 60ms; the handoff reads as one motion.",
  "Try a shorter spring on the confirm button. Right now it overshoots, then settles after the text changes.",
  "The toast lands before the card finishes leaving. Delay it 80ms and it stops fighting for attention.",
]

export function demoApi() {
  return {
    name: "retake-site-demo-api",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/api/reply", (req, res) => {
        const url = new URL(req.url || "/", "http://x")
        const pick = Math.abs(parseInt(url.searchParams.get("seed") || "0", 10)) % REPLIES.length
        const tokens = REPLIES[pick].match(/\S+\s*/g) || []
        res.writeHead(200, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" })
        let i = 0
        const next = () => {
          if (i >= tokens.length || res.destroyed) return res.end()
          res.write(tokens[i++])
          setTimeout(next, 45 + (i % 4) * 15)
        }
        setTimeout(next, 220)
      })
    },
  }
}
