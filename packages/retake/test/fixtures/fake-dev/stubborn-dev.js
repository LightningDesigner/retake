// A dev command whose wrapper exits on Ctrl-C at once while the server it
// started is slow to stop (here: it ignores SIGINT/SIGTERM), like a package
// manager in front of a dev server. The server gives up by itself after 30 s,
// so a failing run leaves nothing behind for long.
//   node stubborn-dev.js <port>
import { spawn } from "node:child_process"
const port = Number(process.argv[2])
const code = `process.on("SIGINT",()=>{});process.on("SIGTERM",()=>{});setTimeout(()=>process.exit(0),30000);require("http").createServer((q,s)=>{s.setHeader("content-type","text/html");s.end("<html><head></head><body>stubborn</body></html>")}).listen(${port},"127.0.0.1",()=>console.log("Local: http://localhost:${port}/"))`
spawn(process.execPath, ["-e", code], { stdio: "inherit" })
process.on("SIGINT", () => process.exit(130))
process.on("SIGTERM", () => process.exit(143))
