import Link from "next/link"
import type { Metadata } from "next"
import { COPY_PROMPT, NOTE, getNoteText, listNotesText } from "../../../src/docs/example.ts"
import { docMetadata } from "../../../src/docs/nav.ts"
import { C, Code, DocArticle, H2, Note, Table } from "../../../src/docs/ui.tsx"

export const metadata: Metadata = docMetadata("output")
export const dynamic = "force-static"

const toc = [
  { id: "example", label: "The example" },
  { id: "copy", label: "Copy for agent" },
  { id: "fields", label: "Field by field" },
  { id: "get-note", label: "Over MCP: get_note" },
  { id: "list-notes", label: "Over MCP: list_notes" },
  { id: "stored", label: "The note on disk" },
  { id: "sources", label: "Where components and lines come from" },
]

export default async function Output() {
  const [getNote, listNotes] = await Promise.all([getNoteText(), listNotesText()])
  const { el: _el, ...stored } = NOTE
  return (
    <DocArticle slug="output" toc={toc} lede="A note gives your coding agent what you'd otherwise explain by hand: what to change, the element, where it lives in the code, and the moment it's about.">
      <H2 id="example">The example</H2>
      <p>
        One note, left on a toast in the middle of its entrance: paused at <C>00:06.38</C> on <b>Timeline 2</b>, the toast 140ms into its 350ms transform transition.
        The note says <i>&ldquo;{NOTE.text}&rdquo;</i>. Below is what that note becomes, in the dock and over MCP.
      </p>

      <H2 id="copy">Copy for agent</H2>
      <p><b>Copy for agent</b> on the note&apos;s card puts this Markdown on your clipboard, ready to paste into any agent&apos;s chat:</p>
      <Code lang="md" title="Clipboard">{COPY_PROMPT}</Code>

      <H2 id="fields">Field by field</H2>
      <p>Lines without a value are left out: an app without React has no Component line, a still element gets &ldquo;nothing animating&rdquo;.</p>
      <Table
        className="wrap-first"
        head={["Line", "What it holds"]}
        rows={[
          [<C key="c">## …</C>, "What you wrote"],
          [<C key="c">Page</C>, "The app's path and query at that moment"],
          [<C key="c">Element</C>, "Tag with its id or first class, and up to 80 characters of its text"],
          [<C key="c">Selector</C>, <>A CSS path from the nearest ancestor with an id, with <C>:nth-of-type</C> where siblings share a tag</>],
          [<C key="c">Component</C>, <>React components that rendered it, innermost first (<C>Toast &lt; ToastStack</C>). Library wrappers (providers, Radix slots, Framer Motion presence) are skipped</>],
          [<C key="c">Animation</C>, <>For a note on an animation: its kind, where it&apos;s defined, timing, keyframes, the point or range on its own clock, what started it, and an exact edit (<Link href="/docs/features#animations">more</Link>)</>],
          [<C key="c">CSS</C>, <>The stylesheet rule&apos;s file and line (and its <C>@keyframes</C>), when found</>],
          [<C key="c">Source</C>, "The file and line of the JSX that made the element"],
          [<C key="c">Classes</C>, "Its class list"],
          [<C key="c">Computed</C>, "Computed styles an agent asks about first (display, position, size, spacing, colour, type, radius, opacity, transform, transition, animation, z-index, gap), defaults left out"],
          [<C key="c">Size</C>, "Its box in the viewport: width × height at (x, y)"],
          [<C key="c">Moment</C>, "Where in the recording, and what was animating on it (or its nearest ancestors) right then"],
          [<C key="c">Timeline</C>, "The take, and where it branched from"],
          [<C key="c">Earlier replies</C>, "Your agent's replies so far, if any"],
        ]}
      />
      <p>
        Some notes carry more: a <b>Group</b> block for a <Link href="/docs/features#group">Whole group</Link> note, a hover, press or focus <b>state</b> listing every effect it started,{" "}
        <b>Recent animations</b> when nothing ran at the moment, and a <b>Media</b> line for a video (<Link href="/docs/features#triggers">more</Link>).
      </p>

      <H2 id="get-note">Over MCP: get_note</H2>
      <p>
        With the <Link href="/docs/mcp">MCP server</Link> connected, your agent doesn&apos;t need the clipboard. <C>get_note</C> returns the same note as text. This is the real output of
        Retake&apos;s MCP code for the note above, generated when these docs were built:
      </p>
      <Code lang="text" title={`get_note { "id": "${NOTE.id}" }`}>{getNote}</Code>
      <p>
        <C>Box</C> is the element&apos;s size and position; <C>During an animation</C> names the clip so a later look at the timeline can find it. Replies, once there are some, follow under <C>Conversation:</C>.
      </p>

      <H2 id="list-notes">Over MCP: list_notes</H2>
      <p>The overview your agent starts from. By default only open notes (pending or acknowledged):</p>
      <Code lang="json" title="list_notes {}">{listNotes}</Code>

      <H2 id="stored">The note on disk</H2>
      <p>
        Notes live in <C>.retake/session.json</C> in your project, next to the takes. Each one has this shape (plus <C>el</C>, the full element description the dock uses to redraw it):
      </p>
      <Code lang="json" title=".retake/session.json → notes[0]">{JSON.stringify(stored, null, 2)}</Code>
      <p>
        <C>status</C> is <C>pending</C>, <C>acknowledged</C>, <C>resolved</C> or <C>dismissed</C>. <C>replies</C> is a list of <C>{"{ from: \"user\" | \"agent\", text, at }"}</C>.
        <C> t</C> is in milliseconds on the recording&apos;s clock.
      </p>

      <H2 id="sources">Where components and lines come from</H2>
      <ul>
        <li>Component names come from React&apos;s owner chain, so a component the element was merely passed through doesn&apos;t count.</li>
        <li>React 18 and older keep the source line on the element. React 19 keeps a stack; the dock maps its first app frame back to your source with the module&apos;s source map.</li>
        <li>CSS lines come from Vite&apos;s CSS source maps, which the plugin turns on in dev.</li>
        <li>A server component has no client-side source to point at, so it gets no Source line.</li>
      </ul>
      <Note>
        <p>Components and source lines need React in development mode. Everything else (selector, classes, styles, size, moment) works with any framework or none.</p>
      </Note>
    </DocArticle>
  )
}
