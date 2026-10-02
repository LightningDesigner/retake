// A stand-in dev server for the CLI specs: it ignores PORT (like Vite-based
// tools) and prints where it listens, with colour codes, the way they do.
//   node fake-dev.js <port>
import http from "node:http"
const port = Number(process.argv[2])
const server = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html" })
  res.end(`<!doctype html><html><head><title>fake</title></head><body>fake dev ${req.url}</body></html>`)
})
setTimeout(() => {
  server.listen(port, "127.0.0.1", () => {
    console.log(`  \x1b[32m➜\x1b[39m  \x1b[1mLocal\x1b[22m:   \x1b[36mhttp://localhost:\x1b[1m${port}\x1b[22m/\x1b[39m`)
  })
}, 200)
