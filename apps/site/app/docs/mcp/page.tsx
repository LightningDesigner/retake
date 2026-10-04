import Link from "next/link"
import type { Metadata } from "next"
import { activeTimelineText, animationText, checkoutText, codeDiffText, momentText, resolveText, timelineEventsText } from "../../../src/docs/example.ts"
import { docMetadata } from "../../../src/docs/nav.ts"
import { C, Code, DocArticle, H2, H3, Note, Table } from "../../../src/docs/ui.tsx"

export const metadata: Metadata = docMetadata("mcp")
export const dynamic = "force-static"

const toc = [
  { id: "setup", label: "Setup" },
  { id: "finding", label: "How it finds your dev server" },
  { id: "loop", label: "The loop" },
  { id: "tools", label: "Tools" },
  { id: "returns", label: "What they return" },
  { id: "protocol", label: "Protocol" },
]

const PROJECT_MCP = `{
  "mcpServers": {
    "retake": {
      "command": "npx",
      "args": ["-y", "retake-dev", "mcp"]
    }
  }
}`

const CODEX = `[mcp_servers.retake]
command = "npx"
args = ["-y", "retake-dev", "mcp"]`

const opt = (name: string) => <><C>{name}</C>?</>

export default async function Mcp() {
  const [active, resolved, moment, events, animation, checkout, diff] = await Promise.all([
    activeTimelineText(),
    resolveText(),
    momentText(),
    timelineEventsText(),
    animationText(),
    checkoutText(),
    codeDiffText(),
  ])
  return (
    <DocArticle slug="mcp" toc={toc} lede="Retake's MCP server lets your coding agent read the notes you leave in the dock, see what happened around them, say it's on them, reply, and mark them done. Changes show on the note in the dock as they happen.">
      <H2 id="setup">Setup</H2>
      <p>Register it once. It&apos;s a stdio server started with <C>npx -y retake-dev mcp</C>; every client takes that command.</p>
      <H3 id="skill">With the skill</H3>
      <p>
        The <Link href="/docs/install#agent">retake skill</Link> sets this up for you: it adds the server to the project&apos;s <C>.mcp.json</C> (Claude Code) or{" "}
        <C>.cursor/mcp.json</C> (Cursor), next to any servers already there. Your agent asks once to turn the <C>retake</C> server on (in Claude Code, when the project is next opened, or run <C>/mcp</C>).
      </p>
      <Code lang="json" title=".mcp.json">{PROJECT_MCP}</Code>
      <H3 id="claude-code">Claude Code</H3>
      <p>From your app&apos;s folder:</p>
      <Code title="Terminal">{"claude mcp add retake -- npx -y retake-dev mcp"}</Code>
      <H3 id="cursor">Cursor</H3>
      <p>The same <C>mcpServers</C> entry in <C>.cursor/mcp.json</C> in the project (or <C>~/.cursor/mcp.json</C> for every project).</p>
      <H3 id="codex">Codex</H3>
      <Code title="Terminal">{"codex mcp add retake -- npx -y retake-dev mcp"}</Code>
      <p>Or by hand, in <C>~/.codex/config.toml</C>:</p>
      <Code lang="toml" title="~/.codex/config.toml">{CODEX}</Code>
      <H3 id="other">Any other client</H3>
      <p>Windsurf, Zed, VS Code and the rest: add a stdio server named <C>retake</C> with command <C>npx</C> and arguments <C>-y retake-dev mcp</C>.</p>
      <Note>
        <p>The server talks to a running Retake. Start your app with Retake first (<C>npx retake-dev .</C>, or <C>next dev</C> with Retake&apos;s <C>proxy.ts</C>), then ask your agent to look at the notes.</p>
      </Note>

      <H2 id="finding">How it finds your dev server</H2>
      <p>
        Retake writes <C>.retake/server.json</C> (its URL and token) when it starts, and removes it when it stops. The MCP server looks for that file in the folder it was started in,
        then each parent. If your client starts it somewhere else, point it at the server yourself:
      </p>
      <Code title="Terminal">{`npx -y retake-dev mcp --url http://localhost:3014
RETAKE_URL=http://localhost:3014 npx -y retake-dev mcp   # the same, from the environment`}</Code>
      <p><C>--port 4000</C> is short for <C>--url http://localhost:4000</C>.</p>

      <H2 id="loop">The loop</H2>
      <ol className="d-steps">
        <li><C>list_notes</C> to see what&apos;s open.</li>
        <li><C>get_note</C> for one note&apos;s details (<Link href="/docs/output#get-note">example</Link>), and <C>get_moment</C> for what happened around its moment.</li>
        <li>
          <C>acknowledge</C> before editing. The pin in the dock turns to acknowledged, the dock moves to the note&apos;s timeline and, with{" "}
          <Link href="/docs/features#code">separate code</Link> on, that timeline&apos;s code goes on disk, so the edit lands there.
        </li>
        <li>Change the code. Your dev server hot-reloads it as usual.</li>
        <li><C>resolve</C> with a one or two sentence summary. It shows on the note, and says so if the edit landed on another timeline.</li>
      </ol>
      <p>To keep going without being asked, an agent can call <C>watch_notes</C>: it waits until you add a note or reply to one, then returns what changed.</p>

      <H2 id="tools">Tools</H2>
      <p>Twelve tools. Times are written as the dock shows them (<C>00:06.38</C>); a timeline is its name or id, and defaults to the one on show.</p>
      <H3 id="tools-notes">Notes</H3>
      <Table
        className="wrap-first"
        head={["Tool", "Parameters", "Does"]}
        rows={[
          [<C key="c">list_notes</C>, <>{opt("status")} <C>open</C> (default: pending and acknowledged), <C>pending</C>, <C>acknowledged</C>, <C>resolved</C>, <C>dismissed</C> or <C>all</C></>, "Lists notes with their id, status, text, timeline, moment or range, selector, component, source, animation and reply count"],
          [<C key="c">get_note</C>, <C key="p">id</C>, "Everything about one note as text: the request, the element, its animation (or a group's) with an exact edit, the moment and timeline, whose code is on disk, and the conversation"],
          [<C key="c">watch_notes</C>, <>{opt("timeout_seconds")} (default 60, at most 600)</>, "Waits for a new note or a reply from you; returns the notes that changed (each with new: true or false), or an empty list on timeout"],
        ]}
      />
      <H3 id="tools-recording">The recording</H3>
      <Table
        className="wrap-first"
        head={["Tool", "Parameters", "Does"]}
        rows={[
          [<C key="c">get_moment</C>, <><C>id</C> (a note), or {opt("timeline")} <C>at</C> {opt("selector")}; {opt("before_seconds")} {opt("after_seconds")} (default 5 each)</>, "What happened around a moment: the user's actions, requests, routes, the animations on or near the element (start, end, values, how far along) and when the screen changed most"],
          [<C key="c">get_timeline_events</C>, <>{opt("timeline")} {opt("from")} {opt("to")} {opt("selector")} {opt("limit")} (default 60, at most 200)</>, "The same for a stretch of a timeline, in order"],
          [<C key="c">get_animation</C>, <><C>id</C> (a note) or <C>clip</C> (with {opt("timeline")}); {opt("at")} or {opt("from")} {opt("to")}</>, "An animation's timing and every keyframe, and any recording time mapped onto its own clock, in CSS %, Motion times and GSAP seconds. A group note gives each member's"],
        ]}
      />
      <H3 id="tools-answer">Answering</H3>
      <Table
        className="wrap-first"
        head={["Tool", "Parameters", "Does"]}
        rows={[
          [<C key="c">acknowledge</C>, <><C>id</C>, {opt("message")}</>, "Sets the note to acknowledged and moves the dock (and, with separate code, the files) to its timeline; a message is added as a reply"],
          [<C key="c">reply</C>, <><C>id</C>, <C>text</C></>, "Adds a reply without changing the status"],
          [<C key="c">resolve</C>, <><C>id</C>, <C>summary</C></>, "Sets the note to resolved, with the summary as a reply; warns when the edit landed on another timeline's code"],
        ]}
      />
      <H3 id="tools-code">Timelines and code</H3>
      <Table
        className="wrap-first"
        head={["Tool", "Parameters", "Does"]}
        rows={[
          [<C key="c">get_active_timeline</C>, "none", "The timeline on show, every timeline with its parent, branch point and code version, its open notes, and whose code is on disk"],
          [<C key="c">checkout_timeline</C>, <><C>timeline</C>, {opt("force")}</>, "Puts a timeline's code on disk and moves the dock there; returns the files that changed. force takes the files while another note's timeline is held for an agent"],
          [<C key="c">get_code_diff</C>, <>{opt("timeline")} (default: the one on disk), {opt("against")} (default: where it started)</>, "The files a timeline's code changed and a unified diff"],
        ]}
      />
      <p>An unknown id comes back as an error that says so (&ldquo;no note with id …; list_notes shows the ids&rdquo;), and so does a dev server that isn&apos;t running.</p>

      <H2 id="returns">What they return</H2>
      <p>
        <C>get_note</C>, <C>get_moment</C>, <C>get_timeline_events</C>, <C>get_animation</C>, <C>checkout_timeline</C> and <C>get_code_diff</C> return text; <C>acknowledge</C>, <C>resolve</C> and{" "}
        <C>reply</C> a short confirmation; the others JSON. Generated from Retake&apos;s MCP code for the <Link href="/docs/output#example">example note</Link>, a toast that slid in after a save:
      </p>
      <Code lang="text" title={'get_moment { "id": "…", "before_seconds": 1.5, "after_seconds": 1 }'}>{moment}</Code>
      <Code lang="text" title={'get_timeline_events { "timeline": "Timeline 2", "from": "00:05.00", "to": "00:07.00" }'}>{events}</Code>
      <Code lang="text" title={'get_animation { "id": "…", "at": "00:06.38" }'}>{animation}</Code>
      <Code lang="json" title="get_active_timeline {}">{active}</Code>
      <Code lang="text" title={'resolve { "id": "…", "summary": "…" }'}>{resolved}</Code>
      <p>After the agent&apos;s edit landed in Timeline 2, with separate code on:</p>
      <Code lang="text" title={'get_code_diff { "timeline": "Timeline 2" }'}>{diff}</Code>
      <Code lang="text" title={'checkout_timeline { "timeline": "Timeline 1" }'}>{checkout}</Code>
      <p>
        A reply&apos;s <C>from</C> is <C>agent</C>. Agents&apos; own replies don&apos;t wake <C>watch_notes</C>; yours do. The same calls are plain HTTP if you&apos;d rather script them: see the <Link href="/docs/api#http">session API</Link>.
      </p>

      <H2 id="protocol">Protocol</H2>
      <ul>
        <li>JSON-RPC 2.0 over stdio, one message per line. Protocol versions 2025-06-18, 2025-03-26 and 2024-11-05.</li>
        <li>
          Tools only (no resources or prompts). The server&apos;s instructions tell the agent the loop (list, get, check the moment, acknowledge before editing, resolve with a summary), how to read a
          note on an animation, and how to edit each kind: CSS keyframes and transitions, <C>element.animate()</C>, Motion, GSAP, script-driven and scroll-driven motion.
        </li>
        <li>It answers what&apos;s in flight before exiting when the client closes its end.</li>
      </ul>
    </DocArticle>
  )
}
