import Link from "next/link"
import type { Metadata } from "next"
import { docMetadata } from "../../../src/docs/nav.ts"
import { C, DocArticle, H2, K, Note, Table } from "../../../src/docs/ui.tsx"

export const metadata: Metadata = docMetadata("features")

const toc = [
  { id: "timeline", label: "The timeline" },
  { id: "play-pause", label: "Play and pause" },
  { id: "scrub", label: "Scrub and preview" },
  { id: "release", label: "Let go: the rebuilt moment" },
  { id: "takes", label: "Takes" },
  { id: "notes", label: "Notes" },
  { id: "fresh", label: "Start fresh" },
  { id: "collapse", label: "Collapse to an icon" },
  { id: "shortcuts", label: "Keyboard shortcuts" },
]

export default function Features() {
  return (
    <DocArticle slug="features" toc={toc} lede="The dock at the bottom of your app: a timeline that records from page load, takes you can branch off any moment, and notes for your coding agent.">
      <H2 id="timeline">The timeline</H2>
      <p>
        Recording starts when the page loads. The track shows what happened: your clicks, form submits, route changes, focus and bursts of typing as markers,
        animations as clips, and a band of activity (how much of the screen changed). Each take is a lane of its own colour.
      </p>
      <ul>
        <li><K>⌘</K>-scroll or pinch on the track zooms around the pointer; a sideways scroll (or <K>Shift</K>-scroll) pans. <K>F</K> fits everything.</li>
        <li><K>M</K> drops a bookmark at the moment on show. Click it later to go back there.</li>
        <li>Drag the divider at the top of the dock to resize it, like docked DevTools.</li>
      </ul>

      <H2 id="play-pause">Play and pause</H2>
      <p>
        The play button, <K>Space</K> or <K>⌥P</K> are the only things that start or stop the clock. Nothing else resumes it: not clicks, keys, scrolling, branching or switching takes.
      </p>
      <ul>
        <li><b>Playing at the live edge:</b> the app is interactive and everything is recorded.</li>
        <li><b>Paused, or anywhere in the past:</b> the app is view-only, like a paused video. Clicks and keys don&apos;t reach it and time doesn&apos;t move. You can still scroll to look around; that scrolling isn&apos;t recorded.</li>
        <li><b>Play from the past</b> replays the recording; at its end it carries on live, recording.</li>
      </ul>

      <H2 id="scrub">Scrub and preview</H2>
      <p>
        Drag the playhead and the app shows that moment at once: the DOM, form fields, animations (SVG&apos;s own too), <C>:hover</C>, media and scroll.
        The playhead snaps to the edges of markers, clips, notes and bookmarks; hold <K>⌥</K> while dragging to place it freely.
        <K>←</K> and <K>→</K> step one recorded frame; <K>Shift</K>+<K>←</K>/<K>→</K> jump to the previous or next edge.
      </p>
      <Note>
        <p>The preview doesn&apos;t restore canvas or WebGL pixels. They&apos;re right once the rebuilt moment swaps in.</p>
      </Note>

      <H2 id="release">Let go: the rebuilt moment</H2>
      <p>
        When you let go (or step with a key, or click a note or bookmark), Retake builds the real moment in a hidden frame behind the preview: it loads the page and replays
        every input up to that moment at full speed. When it&apos;s ready it swaps in, carrying your scroll, with nothing on screen moving. The readout says <b>Paused</b>.
      </p>
      <p>
        You only wait if you ask for the real moment before it&apos;s ready: Play or <K>+</K> straight away, a moment the preview can&apos;t show (an earlier page, or past a reload),
        a switch to another take, or a seek from the API. Then the readout says <b>Building N%</b>.
      </p>

      <H2 id="takes">Takes</H2>
      <p>A take is a timeline that starts from a moment of another one. The first is <b>Timeline 1</b>; new ones are <b>Timeline 2</b>, <b>Timeline 3</b> and so on.</p>
      <ul>
        <li>Press <K>+</K> to start a take at the moment on show, or <K>Ctrl</K>-click the track to start one at that point (hold <K>Ctrl</K> over the track to see where).</li>
        <li>A new take starts <b>paused</b>. Recording into it starts when you press play.</li>
        <li>Click another lane to switch to it. It opens at the current moment, paused. It never plays by itself.</li>
        <li>Double-click a lane&apos;s name to rename it. Right-click a lane to rename or delete it (with the takes branched from it, and their notes). The first timeline can&apos;t be deleted.</li>
        <li>With <C>--code-branches</C> (Vite apps), each take also keeps its own version of the code. It rewrites files on disk, so use it on prototypes. See the <Link href="/docs/api#cli">CLI flags</Link>.</li>
      </ul>

      <H2 id="notes">Notes</H2>
      <p>Notes are change requests pinned to an element at a moment. They&apos;re how you hand work to your coding agent.</p>
      <ol className="d-steps">
        <li>Pause (or go back). Notes only work while the app is still: playing, your clicks belong to the app.</li>
        <li>Hold <K>⌘</K> (or pick the Comment tool in the dock) and point at the app. The layers under the pointer are listed, including animations on <C>::before</C> and <C>::after</C>; <K>Tab</K> or the scroll wheel moves through them.</li>
        <li>Click, write what should change, press <K>Enter</K> (<K>Shift</K>+<K>Enter</K> for a new line, <K>Esc</K> to cancel).</li>
      </ol>
      <p>
        A note keeps its moment and take. It shows as a numbered pin on the element and a tag on the timeline. Pins show only while paused. While the app is live or playing,
        pins and an open note are hidden, and the count in the dock still says how many notes the take has.
      </p>
      <p>
        Click a pin to open the note: <b>Details</b> (selector, component, source file, CSS), <b>Resolve</b>, <b>Delete</b> and <b>Copy for agent</b>, which copies a prompt with the element,
        its React component, its source file and line, its CSS and the moment. Or let your agent read notes over <Link href="/docs/mcp">MCP</Link>: when it acknowledges, replies or resolves,
        the note in the dock changes right away. The exact text is on the <Link href="/docs/output">Output</Link> page.
      </p>

      <H2 id="fresh">Start fresh</H2>
      <p>
        <b>Start fresh</b> in the dock (an icon on narrow screens) clears the session: one empty timeline, no notes, a new recording, straight away. For five seconds an
        <b> Undo</b> brings everything back; after that the server forgets it too.
      </p>

      <H2 id="collapse">Collapse to an icon</H2>
      <p>
        Drag the dock&apos;s divider all the way to the bottom edge and let go, or press <K>⌥T</K>. The dock folds into a round button in the corner and the app gets the whole window.
        It keeps recording. A dot on the button shows the phase: green live, blue playing, amber paused. Click the button (or <K>⌥T</K> again) to bring the dock back at its default height.
        It stays folded across reloads.
      </p>
      <p>To skip Retake for one page load, add <C>?retake=0</C> to the URL.</p>

      <H2 id="shortcuts">Keyboard shortcuts</H2>
      <p>
        These work in the dock, and in the app while it&apos;s view-only (paused or in the past). While you type in a field of the dock they&apos;re off, except <K>⌥P</K> and <K>⌥T</K>.
        On Windows and Linux, <K>⌥</K> is <K>Alt</K> and <K>⌘</K> is the Meta key.
      </p>
      <Table
        head={["Keys", "What it does"]}
        rows={[
          [<><K>Space</K> or <K>⌥P</K></>, "Play or pause"],
          [<><K>←</K> <K>→</K></>, "Step one recorded frame back or forward (pauses first)"],
          [<><K>Shift</K>+<K>←</K> <K>→</K></>, "Jump to the previous or next edge: a marker, clip, note, bookmark or branch point"],
          [<K key="k">+</K>, "New take from the moment on show (= works too)"],
          [<K key="k">F</K>, "Fit the whole recording in view"],
          [<K key="k">M</K>, "Bookmark the moment on show"],
          [<K key="k">⌥T</K>, "Collapse the dock to its corner button, or bring it back"],
          [<>Hold <K>⌘</K></>, "Pick an element to leave a note on (paused)"],
          [<><K>Tab</K> / <K>Shift</K>+<K>Tab</K></>, "While picking: the next or previous layer under the pointer"],
          [<K key="k">Enter</K>, "Save the note (Shift+Enter: a new line)"],
          [<K key="k">Esc</K>, "Close the note, leave the tool"],
          [<><K>Ctrl</K>-click the track</>, "New take at that point"],
          [<><K>⌘</K>-scroll the track</>, "Zoom around the pointer (pinch works too)"],
          [<><K>Shift</K>-scroll the track</>, "Pan (or scroll sideways)"],
          [<>Hold <K>⌥</K> while dragging</>, "Don't snap the playhead to edges"],
        ]}
      />
    </DocArticle>
  )
}
