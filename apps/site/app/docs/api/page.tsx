import Link from "next/link"
import type { Metadata } from "next"
import { docMetadata } from "../../../src/docs/nav.ts"
import { C, Code, DocArticle, H2, H3, Note, Table } from "../../../src/docs/ui.tsx"

export const metadata: Metadata = docMetadata("api")

const toc = [
  { id: "cli", label: "CLI" },
  { id: "code-timelines", label: "Code timelines" },
  { id: "plugin", label: "Vite plugin" },
  { id: "exports", label: "Server building blocks" },
  { id: "http", label: "Session HTTP API" },
  { id: "runtime", label: "window.__retake" },
]

const PLUGIN = `import { defineConfig } from "vite"
import { retake } from "retake-dev"

export default defineConfig({
  plugins: [
    retake({
      codeTimelines: "ask", // each timeline keeps its own code (true rewrites files when you switch)
      banner: true,        // the "Retake  timeline docked at …" line
    }),
  ],
})`

const CURL = `TOKEN=$(node -p 'require("./.retake/server.json").token')

curl -X PATCH http://localhost:3014/__retake/notes/nmg3k2x1a9f \\
  -H "x-retake-token: $TOKEN" \\
  -H "content-type: application/json" \\
  -d '{"status":"resolved","reply":"Eased it out, 60ms delay."}'`

const DOCK_ROOM = `const room = (h: number) => document.body.style.setProperty("padding-bottom", \`\${h}px\`)
room(window.__retakeDockHeight ?? 0)
window.addEventListener("retake:dock", (e) => room(e.detail.height))`

const CLIENT = `/// <reference types="retake-dev/client" />

const rt = window.__retake
if (rt && !rt.inert) {
  // Running in Retake's frame.
  const off = rt.onPlayState(({ playing, now }) => {
    console.log(playing ? "playing" : "paused", "at", now, "ms")
  })
  const { markers, clips } = rt.timeline()
}`

export default function Api() {
  return (
    <DocArticle slug="api" toc={toc} lede="The CLI, the Vite plugin's options, the HTTP API every Retake server answers under /__retake/, and the runtime API inside your app's frame.">
      <H2 id="cli">CLI</H2>
      <p>Installed as <C>retake</C> and <C>retake-dev</C>. With npx, use <C>npx retake-dev</C>.</p>
      <Table
        className="wrap-first"
        head={["Command", "Does"]}
        rows={[
          [<C key="c">retake &lt;project&gt;</C>, "Runs the project's dev server with the timeline: Vite apps through the plugin, frameworks behind the front server"],
          [<C key="c">retake dev &lt;project&gt;</C>, "The same"],
          [<C key="c">retake http://localhost:3000</C>, "Puts the timeline in front of a dev server that's already running"],
          [<C key="c">retake -- &lt;dev command&gt;</C>, <>Runs that command with the timeline in front (<C>retake -- next dev</C>, <C>retake -- pnpm dev</C>)</>],
          [<C key="c">retake init</C>, <>Prints the lines for <C>vite.config</C> or Next&apos;s <C>proxy.ts</C></>],
          [<C key="c">retake mcp</C>, <>The <Link href="/docs/mcp">MCP server</Link> (stdio)</>],
          [<C key="c">retake code …</C>, <>Each timeline&apos;s code, from a terminal (<Link href="#code-timelines">below</Link>)</>],
        ]}
      />
      <Table
        className="wrap-first"
        head={["Option", "Does"]}
        rows={[
          [<C key="c">--port &lt;n&gt;</C>, <>Port to serve on. Default <C>3014</C>. For <C>mcp</C>: the server at <C>http://localhost:&lt;n&gt;</C></>],
          [<C key="c">--root &lt;dir&gt;</C>, <>Where <C>.retake/</C> goes. Default: the project, or the current folder</>],
          [<C key="c">--code-timelines</C>, <>Each timeline keeps its own code: switching to one puts its code on disk (the newest goes back when Retake stops). <C>--code-branches</C> is the old name</>],
          [<C key="c">--no-code-timelines</C>, "Every timeline shares the files. Without either flag the dock asks the first time it matters"],
          [<C key="c">--verbose</C>, <>Logs every request the front server handles to <C>.retake/front.log</C></>],
          [<C key="c">--url &lt;url&gt;</C>, <>For <C>mcp</C>: the Retake server to talk to</>],
          [<C key="c">--branch &lt;name&gt;</C>, <>For <C>retake code export</C>: the branch name (default <C>retake/timeline-&lt;id&gt;</C>)</>],
          [<C key="c">-- …</C>, <>After a project: arguments for its dev server (<C>retake . -- --host</C>). Without one: the dev command</>],
          [<C key="c">-v</C>, <><C>--version</C>: prints the version</>],
          [<C key="c">-h</C>, <><C>--help</C>: prints the usage</>],
        ]}
      />
      <p>
        Environment: <C>RETAKE_URL</C> is <C>--url</C> for <C>mcp</C>. <C>RETAKE_CACHE_DIR</C> moves the wrapper config and Vite cache Retake keeps for a Vite app
        (default <C>$TMPDIR/retake/</C>). <C>PORT</C> is given to the dev command Retake starts.{" "}
        <C>RETAKE_CODE_TIMELINES</C> is for Next&apos;s <C>proxy.ts</C> / <C>middleware.ts</C>, where there are no flags: <C>1</C> separate code, <C>0</C> shared, unset the dock asks.
      </p>

      <H2 id="code-timelines">Code timelines</H2>
      <p>
        Each timeline can keep its own code (<Link href="/docs/features#code">how it works</Link>). Turn it on or off with the dock&apos;s prompt, a lane&apos;s right-click menu, or:
      </p>
      <Table
        className="wrap-first"
        head={["Where", "On", "Off"]}
        rows={[
          ["CLI", <C key="c">--code-timelines</C>, <C key="c">--no-code-timelines</C>],
          ["Vite plugin", <C key="c">{"retake({ codeTimelines: true })"}</C>, <C key="c">{"retake({ codeTimelines: false })"}</C>],
          [<>Next&apos;s <C>proxy.ts</C></>, <C key="c">RETAKE_CODE_TIMELINES=1 next dev</C>, <C key="c">RETAKE_CODE_TIMELINES=0</C>],
        ]}
      />
      <p>Left unset, the dock asks once, the first time the code changes with two timelines; the answer is kept in <C>.retake/settings.json</C>.</p>
      <p>
        <C>retake code</C> works with or without a dev server running (through its HTTP API when one is, else on <C>.retake/</C> directly). Run it in the project, or pass <C>--root</C>.
      </p>
      <Table
        className="wrap-first"
        head={["Command", "Does"]}
        rows={[
          [<C key="c">retake code status</C>, "Each timeline's code version and the files it changed since it started, and whose code is on disk. list is the same"],
          [<C key="c">retake code checkout &lt;timeline&gt;</C>, "Puts that timeline's code on disk (by id or name)"],
          [<C key="c">retake code restore [version]</C>, "Puts the newest code back on disk, or a given version"],
          [<C key="c">retake code export &lt;timeline&gt;</C>, <>Makes a git branch of that timeline&apos;s code, on top of HEAD (<C>--branch &lt;name&gt;</C>). Your working tree, index and HEAD stay as they are</>],
        ]}
      />

      <H2 id="plugin">Vite plugin</H2>
      <p><C>retake(options)</C> returns the plugins for <C>vite dev</C>; it does nothing in <C>vite build</C>.</p>
      <Code lang="ts" title="vite.config.ts">{PLUGIN}</Code>
      <Table
        className="wrap-first"
        head={["Option", "Type", "Default", "Does"]}
        rows={[
          [<C key="c">enabled</C>, <C key="t">boolean</C>, <C key="d">true</C>, "false turns the plugin off; pages are served as they are"],
          [<C key="c">codeTimelines</C>, <C key="t">{"boolean | \"ask\""}</C>, <C key="d">&quot;ask&quot;</C>, "Each timeline keeps its own code; switching to one puts its code on disk. \"ask\": the dock asks the first time it matters (codeBranches: true is the old name)"],
          [<C key="c">token</C>, <C key="t">string</C>, "random per start", <>The token mutating <C>/__retake/</C> requests must carry</>],
          [<C key="c">root</C>, <C key="t">string</C>, "Vite's root", <>Where <C>.retake/</C> goes</>],
          [<C key="c">banner</C>, <C key="t">boolean</C>, <C key="d">true</C>, "false hides the startup line"],
        ]}
      />
      <p>
        Types ship with the package (<C>RetakeOptions</C> from <C>retake-dev</C>). The plugin turns on Vite&apos;s CSS source maps in dev unless you set them, so notes can point at CSS lines.
      </p>

      <H2 id="exports">Server building blocks</H2>
      <p>For serving the dock from your own server (Retake&apos;s site does this on Vercel). All four come from <C>retake-dev</C>:</p>
      <Table
        className="wrap-first"
        head={["Export", "Returns"]}
        rows={[
          [<C key="c">shellHtml(options?)</C>, <>The dock page: a full HTML document with the app in a frame. Options: <C>marker</C> (<C>&quot;url&quot;</C> or <C>&quot;header&quot;</C>), <C>appPage</C>, <C>docs</C>, <C>server</C> (<C>false</C>: no Retake server, keep the session in memory), <C>token</C>, <C>codeBranches</C></>],
          [<C key="c">runtimeTag(options?)</C>, <>The <C>&lt;script data-retake&gt;</C> tag to put first in the framed page. It removes itself and runs only in a frame the dock made. Options: <C>rt</C>, <C>nonce</C>, <C>script</C></>],
          [<C key="c">runtimeSource(rt?)</C>, <>The time runtime as one script. <C>rt</C>: <C>marker</C>, <C>bootAt</C> (<C>&quot;dcl&quot;</C> or <C>&quot;load&quot;</C>), <C>exemptUrls</C>, <C>holdScripts</C>, <C>next</C>, <C>docId</C>, <C>docStored</C></>],
          [<C key="c">injectHtml(tag, {"{ encoding? }"})</C>, <>A stream transform that inserts <C>tag</C> after <C>&lt;head&gt;</C> as the HTML streams, decoding gzip, br, deflate or zstd first</>],
        ]}
      />

      <H2 id="http">Session HTTP API</H2>
      <p>
        Every Retake server (the plugin and the front server) answers these under <C>/__retake/</C>. Timelines, recordings and notes are kept in <C>.retake/</C>.
      </p>
      <Table
        className="wrap-first"
        head={["Route", "Does"]}
        rows={[
          [<C key="c">GET /__retake/session</C>, <><C>{"{ branches, activeId, markers, notes }"}</C>. Each branch: <C>{"{ id, parentId, forkAt, name, codeVersion }"}</C></>],
          [<C key="c">PUT /__retake/session</C>, "Replaces the session; recordings of timelines it no longer has are deleted"],
          [<C key="c">GET /__retake/recording/:id</C>, "A timeline's recording (JSON; gzipped on disk)"],
          [<C key="c">PUT /__retake/recording/:id</C>, "Saves a timeline's recording"],
          [<C key="c">DELETE /__retake/recording/:id</C>, "Deletes it"],
          [<C key="c">GET /__retake/notes</C>, "Every note"],
          [<C key="c">GET /__retake/notes/:id</C>, "One note (404 if there's none)"],
          [<C key="c">PATCH /__retake/notes/:id</C>, <><C>{"{ status?, reply? }"}</C>: <C>status</C> is pending, acknowledged, resolved or dismissed; <C>reply</C> a string (from the agent, or the user with header <C>x-retake-from: user</C>). Returns the note</>],
          [<C key="c">GET /__retake/events</C>, <>Server-sent events: <C>session</C>, <C>note-updated</C>, <C>active-changed</C>, <C>code-version</C></>],
          [<C key="c">GET /__retake/health</C>, "Front server only: 200 once the dev server behind it has answered, 503 before"],
          [<C key="c">GET /__retake/code</C>, <>Each timeline&apos;s code: <C>{"{ enabled, checkedOut, disk, newest, timelines: { [id]: { fork, head, changed, files } } }"}</C></>],
          [<C key="c">POST /__retake/code/checkout</C>, <><C>{"{ branchId, force? }"}</C>: puts a timeline&apos;s code on disk (with code timelines on). Returns the files that changed</>],
          [<C key="c">GET /__retake/code/diff?branch=&amp;against=</C>, <>The files a timeline changed since it started (or against another timeline&apos;s id), and a unified diff</>],
          [<C key="c">POST /__retake/code/enabled</C>, <><C>{"{ on }"}</C>: separate code per timeline, or shared</>],
          [<C key="c">POST /__retake/code/restore</C>, <><C>{"{ version? }"}</C>: puts that version (default: the newest) back on disk</>],
          [<C key="c">POST /__retake/code/resume</C>, "Resumes swapping after a git branch switch paused it"],
        ]}
      />
      <H3 id="token">The token</H3>
      <p>
        Every request that changes something needs the header <C>x-retake-token</C>. Reads don&apos;t. The token is random for each server start (or the plugin&apos;s <C>token</C> option).
        It&apos;s in <C>.retake/server.json</C> (<C>{"{ url, base, token, pid }"}</C>, readable only by you) and in the dock page as <C>window.__RETAKE_TOKEN</C>.
      </p>
      <Code title="Resolve a note from a script">{CURL}</Code>
      <Note tone="warn">
        <p>Recordings hold what you typed and what your API answered. The front server only answers on localhost. With the plugin and <C>vite --host</C>, anyone on your network can read the session.</p>
      </Note>

      <H2 id="runtime">window.__retake</H2>
      <p>
        Inside the dock&apos;s frame your app can read Retake&apos;s clock and timeline. In any other page or frame it&apos;s <C>{"{ inert: true }"}</C>, and without Retake it&apos;s <C>undefined</C>.
        Types: add <C>retake-dev/client</C> to <C>compilerOptions.types</C>, or reference it.
      </p>
      <Code lang="ts" title="app.ts">{CLIENT}</Code>
      <Table
        className="wrap-first"
        head={["Member", "Returns"]}
        rows={[
          [<C key="c">version</C>, "The runtime's version"],
          [<C key="c">now()</C>, "The virtual clock, in ms"],
          [<C key="c">timeline()</C>, <><C>{"{ now, end, viewport: { w, h }, markers, clips, activity }"}</C></>],
          [<C key="c">clipsFor(elementOrSelector)</C>, "Animation clips on that element and its descendants, looping ones included"],
          [<C key="c">clipAt(t, selector?)</C>, <>The latest clip running at <C>t</C>, as <C>{"{ clip, offset }"}</C> (ms into it), or <C>null</C></>],
          [<C key="c">isInteractive()</C>, "True only while playing at the live edge"],
          [<C key="c">isPaused()</C>, "Paused anywhere"],
          [<C key="c">onPlayState(fn)</C>, <><C>fn({"{ playing, now }"})</C> on every play or pause; returns an unsubscribe</>],
          [<C key="c">play()</C>, "Plays from here: replays the recorded future, then carries on live"],
          [<C key="c">pause()</C>, "Pauses"],
          [<C key="c">record()</C>, "Starts the timeline, or resumes recording from its end"],
          [<C key="c">seek(t, play?)</C>, "Goes to moment t; false before anything was recorded"],
          [<C key="c">setToolActive(on)</C>, "The dock tells the runtime a comment or select tool is on"],
        ]}
      />
      <H3 id="timeline-shape">timeline()</H3>
      <ul>
        <li><C>markers</C>: your actions only, <C>{"{ t, end?, kind, label, selector? }"}</C> with <C>kind</C> one of click, submit, route, focus or type. A <C>type</C> marker is one burst of typing (gaps under 800ms).</li>
        <li><C>clips</C>: animations, <C>{"{ id, start, end, kind, label, selector, component?, property?, path, iterations?, pseudoElement? }"}</C> with <C>kind</C> transition, css-animation or waapi; <C>end</C> is <C>null</C> while running.</li>
        <li><C>activity</C>: samples at 10 Hz, <C>{"{ t, v }"}</C>, where <C>v</C> (0 to 1) is how much of the viewport changed.</li>
      </ul>
      <H3 id="dock-height">Room for the dock</H3>
      <p>
        Your app fills the window and the dock sits over its bottom edge. In the dock&apos;s frame, <C>window.__retakeDockHeight</C> is how many px it covers (0 when it&apos;s folded away),
        and a <C>retake:dock</C> event on <C>window</C> (<C>{"detail: { height }"}</C>) says when that changes.
      </p>
      <Code lang="ts" title="app.ts">{DOCK_ROOM}</Code>
    </DocArticle>
  )
}
