import Link from "next/link"
import type { Metadata } from "next"
import { docMetadata } from "../../../src/docs/nav.ts"
import { C, Code, DocArticle, H2, H3, K, Note, Table } from "../../../src/docs/ui.tsx"

export const metadata: Metadata = docMetadata("features")

const toc = [
  { id: "timeline", label: "The timeline" },
  { id: "play-pause", label: "Play and pause" },
  { id: "scrub", label: "Scrub and preview" },
  { id: "release", label: "Let go: the rebuilt moment" },
  { id: "takes", label: "Takes" },
  { id: "code", label: "Timelines keep their own code" },
  { id: "notes", label: "Notes" },
  { id: "picking", label: "Picking an element" },
  { id: "animations", label: "Notes on animations" },
  { id: "group", label: "One note for a group" },
  { id: "triggers", label: "Hover, press and focus" },
  { id: "media", label: "Video" },
  { id: "fresh", label: "Start fresh" },
  { id: "collapse", label: "Collapse to an icon" },
  { id: "shortcuts", label: "Keyboard shortcuts" },
]

export default function Features() {
  return (
    <DocArticle slug="features" toc={toc} lede="The dock at the bottom of your app: a timeline that records from page load, timelines you can branch off any moment, each with its own code, and notes for your coding agent.">
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
      </ul>

      <H2 id="code">Timelines keep their own code</H2>
      <p>
        Make Timeline 2 from a moment of Timeline 1, leave a note on an animation there, and hand it to your agent. The change lands in Timeline 2, and Timeline 1 still
        rebuilds with the old animation.
      </p>
      <ul>
        <li>Every edit, yours or your agent&apos;s, belongs to the timeline you&apos;re in. Each version of the code is a snapshot in <C>.retake/</C>. This works in every mode: Vite, frameworks behind <C>retake .</C>, and Next&apos;s <C>proxy.ts</C> / <C>middleware.ts</C>.</li>
        <li>
          The first time the code changes while you have two timelines, the dock asks once: <b>Separate code</b> or <b>Share code</b>. The answer is kept for the project.
          Change it from a lane&apos;s right-click menu (<b>Separate code per timeline</b>), or with <C>--code-timelines</C> / <C>--no-code-timelines</C>, <C>retake({"{ codeTimelines }"})</C>
          or <C>RETAKE_CODE_TIMELINES</C> (see the <Link href="/docs/api#code-timelines">API</Link>).
        </li>
        <li>
          With separate code, switching to a lane puts its code on disk first, so its moments rebuild on the code they were recorded with. The dock says which files changed.
          A lane whose code changed shows <C>±</C> (hover it for the files), and the top row says whose code is on disk.
        </li>
        <li>When Retake stops, the newest code goes back on disk; the others stay in <C>.retake/</C>. After a crash it&apos;s put back at the next start.</li>
        <li>Your agent&apos;s <C>acknowledge</C> puts the note&apos;s timeline&apos;s code on disk and moves the dock there. While it works, switching to another lane asks first.</li>
        <li>Dependencies aren&apos;t swapped: when <C>package.json</C> differs between timelines, the dock says to run install. Your editor reloads files that change under it.</li>
      </ul>
      <p>From a terminal, with or without a dev server running:</p>
      <Code title="Terminal">{`retake code status            # each timeline's code, and whose is on disk
retake code list              # the same
retake code checkout 2        # put Timeline 2's code on disk
retake code restore           # put the newest code back (or: restore <version>)
retake code export 2          # Timeline 2's code as a git branch (--branch <name>)`}</Code>
      <H3 id="git">Safe with git</H3>
      <ul>
        <li>HEAD, the index and refs are never touched. <C>export</C> makes its branch without touching your working tree.</li>
        <li>No checkout runs while git is busy (a rebase, a merge, a cherry-pick). A branch switch pauses swapping until you resume it in the dock.</li>
        <li>Framework output (<C>next-env.d.ts</C>, <C>.svelte-kit</C>, <C>.nuxt</C>, <C>*.gen.ts</C>), <C>node_modules</C> and paths listed in <C>.retake/ignore</C> are never swapped.</li>
        <li>While files switch, the dev server&apos;s hot updates are held, so a half-written tree never reloads the app.</li>
      </ul>

      <H2 id="notes">Notes</H2>
      <p>Notes are change requests pinned to an element at a moment. They&apos;re how you hand work to your coding agent.</p>
      <ol className="d-steps">
        <li>Pause (or go back). Notes only work while the app is still: playing, your clicks belong to the app.</li>
        <li>Hold <K>⌘</K> (or pick the Comment tool in the dock) and point at the app. A list by the pointer shows everything stacked there (<Link href="#picking">picking</Link>).</li>
        <li>Click, write what should change, press <K>Enter</K> (<K>Shift</K>+<K>Enter</K> for a new line, <K>Esc</K> to cancel).</li>
      </ol>
      <p>
        A note keeps its moment and timeline. It shows as a numbered pin on the element and a tag on the timeline. Pins show only while paused. While the app is live or playing,
        pins and an open note are hidden, and the count in the dock still says how many notes the timeline has. A second ⌘-click on a pinned spot makes another note there.
      </p>
      <p>
        Click a pin to open the note: <b>Details</b> (selector, component, source file, CSS), <b>Resolve</b>, <b>Delete</b> and <b>Copy for agent</b>, which copies a prompt with the element,
        its React component, its source file and line, its CSS and the moment. Or let your agent read notes over <Link href="/docs/mcp">MCP</Link>: when it acknowledges, replies or resolves,
        the note in the dock changes right away. The exact text is on the <Link href="/docs/output">Output</Link> page.
      </p>

      <H2 id="picking">Picking an element</H2>
      <p>
        Hold <K>⌘</K> over the paused app. The list by the pointer shows everything under it, also what takes no pointer events: a drawn underline under an image, an icon,
        a thin animated stroke. A dot marks what&apos;s moving.
      </p>
      <ul>
        <li>The pick is what you can see there: text, an image or icon, a control, a painted box. One that moves wins: a word popping in, a stroke under an overlay.</li>
        <li>Empty overlays (glows, stretched links) and invisible layers stay in the list, dimmed, with why.</li>
        <li><K>Tab</K> or the scroll wheel moves through the list. Or move onto the list and click a row; the click never reaches the page.</li>
        <li>An icon is its <C>&lt;svg&gt;</C> (or its button), unless the shape inside is the one moving. Open shadow roots and embedded iframes are pickable.</li>
        <li>The note&apos;s selector finds the element again on a fresh load: no generated ids, no classes that came and went during the recording.</li>
      </ul>

      <H2 id="animations">Notes on animations</H2>
      <p>
        Each animation belongs to an element and runs on its own clock (0 is the end of its delay). ⌘-click an element and it gets a row on the track with its animations.
        Open one to see its keyframes, what it moves and the path it takes on the app.
      </p>
      <ul>
        <li><b>A point:</b> click on the open animation, or step with <K>←</K>/<K>→</K> (<K>⌥</K>: keyframe to keyframe). The note reads &ldquo;at 100ms (20%) of fadeUp&rdquo;.</li>
        <li><b>A range:</b> drag across it, or <K>Shift</K>+<K>←</K>/<K>→</K> from the point (10ms a press, stopping on keyframes). The note reads &ldquo;200–400ms of fadeUp&rdquo;.</li>
        <li><b>Without a mouse:</b> after the ⌘-click, <K>Enter</K> or <K>↓</K> opens the element&apos;s animation, <K>↑</K>/<K>↓</K> go through its other ones, and the hint names the one open (&ldquo;Open: fadeUp · 600ms (1 of 2)&rdquo;). The row&apos;s animations are buttons too, reachable with <K>Tab</K> and named for screen readers.</li>
        <li>Numbers you type in the note (&ldquo;at 100ms&rdquo;) are read on that animation&apos;s clock.</li>
      </ul>
      <p>
        The note gives your agent the animation, where it&apos;s defined, its keyframes, the point or range on its clock with the values there, and an exact edit that changes only that part.
        For &ldquo;faster&rdquo; or &ldquo;hold longer&rdquo; it adds an <C>Intent:</C> line with what to change instead. Instant animations (0ms) are never the subject, and an animation started again
        (on scroll) is one entry with its runs.
      </p>

      <H2 id="group">One note for a group</H2>
      <p>
        ⌘-click a container whose children each run their own animation (an equalizer&apos;s bars) and its row offers <b>Whole group · N</b>. Click it, or press <K>G</K>
        (<K>⌥G</K> while in the note): a lane per child. Click a moment or drag a range, and one note covers every child, each on its own clock with its own exact edit.
        Children that share one <C>@keyframes</C> (or the same keyframes) say so, for a single edit. <K>G</K> or <K>Esc</K> leaves it.
      </p>

      <H2 id="triggers">Hover, press and focus</H2>
      <ul>
        <li>A note says what started each animation: &ldquo;:hover on a.card&rdquo;, a press (<C>:active</C>), a click, a focus or a key, with the moment.</li>
        <li>When one hover starts several effects on the element and its <C>::before</C>/<C>::after</C> (border colour, shadow, glow), the note lists them as one hover state, so &ldquo;feels off here&rdquo; is about the whole hover.</li>
        <li>
          With nothing running at the note&apos;s moment (a press is over before you can pause), the note lists what ran last on the element and inside it, newest first:
          &ldquo;pressed at 00:14.02 → transform transition 150ms&rdquo;.
        </li>
      </ul>

      <H2 id="media">Video</H2>
      <p>
        When the motion is a <C>&lt;video&gt;</C> (a background clip), the note describes it as media: its source, the time and length at the moment, loop, <C>playbackRate</C>,
        and how to make it calmer or faster.
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
        While the app is live, its keys are its own (<K>Space</K> types into a field it focused): <K>⌥P</K> always plays and pauses, wherever the focus is.
        On Windows and Linux, <K>⌥</K> is <K>Alt</K> and <K>⌘</K> is the Meta key.
      </p>
      <Table
        head={["Keys", "What it does"]}
        rows={[
          [<><K>Space</K> or <K>⌥P</K></>, "Play or pause"],
          [<><K>←</K> <K>→</K></>, "Step one recorded frame back or forward (pauses first)"],
          [<><K>Shift</K>+<K>←</K> <K>→</K></>, "Jump to the previous or next edge: a marker, clip, note, bookmark or branch point"],
          [<K key="k">+</K>, "New timeline from the moment on show (= works too)"],
          [<K key="k">F</K>, "Fit the whole recording in view"],
          [<K key="k">M</K>, "Bookmark the moment on show"],
          [<K key="k">⌥T</K>, "Collapse the dock to its corner button, or bring it back"],
          [<>Hold <K>⌘</K></>, "Pick an element to leave a note on (paused)"],
          [<><K>Tab</K> / <K>Shift</K>+<K>Tab</K></>, "While picking: the next or previous layer under the pointer"],
          [<><K>Enter</K> or <K>↓</K></>, "On a picked element: open its animation on its own clock (in the note while it's empty, or with the focus out of it)"],
          [<><K>↑</K> <K>↓</K></>, "On an open animation: the element's other animations; the hint names the one open"],
          [<><K>←</K> <K>→</K> on an open animation</>, "Its frames (⌥: keyframe to keyframe; Shift: grow a range from the point)"],
          [<><K>G</K> (<K>⌥G</K> in the note)</>, "Whole group on a picked container, or off again"],
          [<><K>Tab</K> to the element&apos;s row</>, "Its animations and the Whole group chip are buttons: Enter presses one"],
          [<K key="k">Enter</K>, "Save the note (Shift+Enter: a new line)"],
          [<K key="k">Esc</K>, "Close the open animation (or the group), then the note, then leave the tool"],
          [<><K>Ctrl</K>-click the track</>, "New timeline at that point"],
          [<><K>⌘</K>-scroll the track</>, "Zoom around the pointer (pinch works too)"],
          [<><K>Shift</K>-scroll the track</>, "Pan (or scroll sideways)"],
          [<>Hold <K>⌥</K> while dragging</>, "Don't snap the playhead to edges"],
        ]}
      />
    </DocArticle>
  )
}
