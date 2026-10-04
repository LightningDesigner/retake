// PT.holdDev: while the dock switches a timeline's code on disk, what the dev
// server pushes on its own sockets (HMR) waits, and a refused switch delivers
// it. The app's own sockets aren't touched. A ten-line WebSocket server stands
// in for the dev server's (port 3126).
import crypto from "node:crypto"
import http from "node:http"
import { test, expect } from "@playwright/test"
import { openDock } from "./helpers.js"
import { PORTS } from "./servers.js"

const WS_PORT = 3126
// Answers every upgrade, then sends `hello <n>` each time /send is asked for.
function devSocketServer() {
  const socks = new Set()
  const server = http.createServer((req, res) => {
    for (const s of socks) {
      const msg = Buffer.from(`hello ${req.url.split("=")[1] || ""}`)
      s.write(Buffer.concat([Buffer.from([0x81, msg.length]), msg]))
    }
    res.writeHead(200, { "access-control-allow-origin": "*" })
    res.end("ok")
  })
  server.on("upgrade", (req, sock) => {
    const accept = crypto.createHash("sha1").update(req.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64")
    const proto = req.headers["sec-websocket-protocol"]
    sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n${proto ? `Sec-WebSocket-Protocol: ${proto.split(",")[0].trim()}\r\n` : ""}\r\n`)
    socks.add(sock)
    sock.on("close", () => socks.delete(sock))
    sock.on("error", () => {})
  })
  return new Promise((resolve) => server.listen(WS_PORT, "127.0.0.1", () => resolve({ close: () => (socks.forEach((s) => s.destroy()), new Promise((r) => server.close(r))) })))
}

test("holdDev queues the dev server's socket messages (listeners and onmessage) and delivers them on release", async ({ page }) => {
  const dev = await devSocketServer()
  try {
    const h = await openDock(page, `http://localhost:${PORTS.probe}/`)
    // A socket on Vite's HMR protocol: the dev server's own, live and unrecorded.
    await h.rt(async (port) => {
      window.__got = []
      const ws = new WebSocket(`ws://127.0.0.1:${port}/`, "vite-hmr")
      ws.addEventListener("message", (e) => window.__got.push(`listener ${e.data}`))
      ws.onmessage = (e) => window.__got.push(`onmessage ${e.data}`)
      await new Promise((r) => ws.addEventListener("open", r))
    }, WS_PORT)
    const send = (n) => fetch(`http://127.0.0.1:${WS_PORT}/send?n=${n}`)
    await send(1)
    await expect.poll(() => h.rt(() => window.__got.slice())).toEqual(["listener hello 1", "onmessage hello 1"])
    await h.rt(() => window.__retake.holdDev(true))
    await send(2)
    await send(3)
    await page.waitForTimeout(300)
    expect(await h.rt(() => window.__got.length)).toBe(2) // held
    await h.rt(() => window.__retake.holdDev(false))
    await expect.poll(() => h.rt(() => window.__got.slice(2))).toEqual(["listener hello 2", "onmessage hello 2", "listener hello 3", "onmessage hello 3"])
    await send(4)
    await expect.poll(() => h.rt(() => window.__got.length)).toBe(8)
  } finally {
    await dev.close()
  }
})
