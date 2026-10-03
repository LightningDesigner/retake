import Link from "next/link"
import type { Metadata } from "next"
import { activeTimelineText, resolveText } from "../../../src/docs/example.ts"
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

const CURSOR = `{
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

export default async function Mcp() {
  const [active, resolved] = await Promise.all([activeTimelineText(), resolveText()])
  return (
    <DocArticle slug="mcp" toc={toc} lede="Retake's MCP server lets your coding agent read the notes you leave in the dock, say it's on them, reply, and mark them done. Changes show on the note in the dock as they happen.">
      <H2 id="setup">Setup</H2>
      <p>Register it once. It&apos;s a stdio server started with <C>npx -y retake-dev mcp</C>; every client takes that command.</p>
      <H3 id="claude-code">Claude Code</H3>
      <p>From your app&apos;s folder:</p>
      <Code title="Terminal">{"claude mcp add retake -- npx -y retake-dev mcp"}</Code>
      <H3 id="cursor">Cursor</H3>
      <p>In <C>.cursor/mcp.json</C> in the project (or <C>~/.cursor/mcp.json</C> for every project):</p>
      <Code lang="json" title=".cursor/mcp.json">{CURSOR}</Code>
      <H3 id="codex">Codex</H3>
      <p>In <C>~/.codex/config.toml</C>:</p>
      <Code lang="toml" title="~/.codex/config.toml">{CODEX}</Code>
      <H3 id="other">Any other client</H3>
      <p>Windsurf, Zed, VS Code and the rest: add a stdio server named <C>retake</C> with command <C>npx</C> and arguments <C>-y retake-dev mcp</C>.</p>
      <Note>
        <p>The server talks to a running Retake. Start your app with Retake first (<C>npx retake-dev .</C>), then ask your agent to look at the notes.</p>
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
        <li><C>get_note</C> for one note&apos;s details (<Link href="/docs/output#get-note">example</Link>).</li>
        <li><C>acknowledge</C> when it starts. The pin in the dock turns to acknowledged.</li>
        <li>Change the code. Your dev server hot-reloads it as usual.</li>
        <li><C>resolve</C> with a one or two sentence summary. It shows on the note.</li>
      </ol>
      <p>To keep going without being asked, an agent can call <C>watch_notes</C>: it waits until you add a note or reply to one, then returns what changed.</p>

      <H2 id="tools">Tools</H2>
      <Table
        className="wrap-first"
        head={["Tool", "Parameters", "Does"]}
        rows={[
          [<C key="c">list_notes</C>, <><C>status</C>? <C>open</C> (default: pending and acknowledged), <C>pending</C>, <C>acknowledged</C>, <C>resolved</C>, <C>dismissed</C> or <C>all</C></>, "Lists notes with their id, status, text, take, moment, selector, component, source and reply count"],
          [<C key="c">get_note</C>, <><C>id</C></>, "Everything about one note as text: the request, the element, the moment and take, and the conversation"],
          [<C key="c">get_active_timeline</C>, "none", "The take you're looking at, every take with its parent, branch point and code version, and the active take's open notes"],
          [<C key="c">acknowledge</C>, <><C>id</C>, <C>message</C>?</>, "Sets the note to acknowledged; a message is added as a reply"],
          [<C key="c">resolve</C>, <><C>id</C>, <C>summary</C></>, "Sets the note to resolved, with the summary as a reply"],
          [<C key="c">reply</C>, <><C>id</C>, <C>text</C></>, "Adds a reply without changing the status"],
          [<C key="c">watch_notes</C>, <><C>timeout_seconds</C>? (default 60, at most 600)</>, "Waits for a new note or a reply from you; returns the notes that changed (each with new: true or false), or an empty list on timeout"],
        ]}
      />
      <p>An unknown id comes back as an error that says so (&ldquo;no note with id …; list_notes shows the ids&rdquo;), and so does a dev server that isn&apos;t running.</p>

      <H2 id="returns">What they return</H2>
      <p>
        <C>get_note</C> returns text; <C>acknowledge</C>, <C>resolve</C> and <C>reply</C> a one-line confirmation; the others JSON. Generated from Retake&apos;s MCP code for
        the <Link href="/docs/output#example">example note</Link>:
      </p>
      <Code lang="json" title="get_active_timeline {}">{active}</Code>
      <Code lang="text" title='resolve { "id": "…", "summary": "…" }'>{resolved}</Code>
      <p>
        A reply&apos;s <C>from</C> is <C>agent</C>. Agents&apos; own replies don&apos;t wake <C>watch_notes</C>; yours do. The same calls are plain HTTP if you&apos;d rather script them: see the <Link href="/docs/api#http">session API</Link>.
      </p>

      <H2 id="protocol">Protocol</H2>
      <ul>
        <li>JSON-RPC 2.0 over stdio, one message per line. Protocol versions 2025-06-18, 2025-03-26 and 2024-11-05.</li>
        <li>Tools only (no resources or prompts). The server&apos;s instructions tell the agent: list, get, acknowledge when starting, resolve with a summary when done.</li>
        <li>It answers what&apos;s in flight before exiting when the client closes its end.</li>
      </ul>
    </DocArticle>
  )
}
