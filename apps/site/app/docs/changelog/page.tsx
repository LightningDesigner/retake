import Link from "next/link"
import type { Metadata } from "next"
import { docMetadata, NPM } from "../../../src/docs/nav.ts"
import { C, DocArticle, H3, K } from "../../../src/docs/ui.tsx"

export const metadata: Metadata = docMetadata("changelog")

const toc = [
  { id: "v0-5-5", label: "0.5.5" },
  { id: "v0-5-4", label: "0.5.4" },
  { id: "v0-5-3", label: "0.5.3" },
  { id: "v0-5-2", label: "0.5.2" },
  { id: "v0-5-1", label: "0.5.1" },
  { id: "v0-5-0", label: "0.5.0" },
  { id: "v0-4-0", label: "0.4.0" },
]

function Release({ id, version, tag }: { id: string; version: string; tag: string }) {
  return (
    <div className="d-release">
      <h2 id={id} className="d-h2"><a href={`#${id}`}>{version}</a></h2>
      <span className="d-tag">{tag}</span>
    </div>
  )
}

export default function Changelog() {
  return (
    <DocArticle slug="changelog" toc={toc} lede={<>What changed in each release of <a href={NPM} target="_blank" rel="noreferrer">retake-dev</a>.</>}>
      <Release id="v0-5-5" version="0.5.5" tag="Springs" />
      <ul>
        <li><b>Motion springs.</b> A note on a spring gives its stiffness, damping, how far it overshoots and when it settles, with the numbers to change for &quot;less bouncy&quot;, &quot;slower&quot; or &quot;faster&quot;. A point or range on a spring is converted to keyframes for an exact edit.</li>
        <li>Picking an element again while writing a note keeps what you typed.</li>
      </ul>

      <Release id="v0-5-4" version="0.5.4" tag="Fixes" />
      <ul>
        <li><K>Enter</K> opens an animation at its start even when the playhead is in its delay, so the arrows and <K>Shift</K>+arrows work straight away.</li>
        <li>A click on a row of the <K>⌘</K> layer list picks that layer and never reaches the page.</li>
        <li>The note keeps focus when a rebuild replays a click.</li>
      </ul>

      <Release id="v0-5-3" version="0.5.3" tag="Keyboard" />
      <ul>
        <li><b>Everything by keyboard.</b> After ⌘-click, <K>Enter</K> or <K>↓</K> opens the element&apos;s animation, <K>↑</K>/<K>↓</K> moves between its animations, <K>Shift</K>+<K>←</K>/<K>→</K> makes a range, <K>G</K> turns on Whole group. Every item on the animation row is also a real button for screen readers.</li>
        <li><b>Hover, press and focus.</b> A note says what started an animation (&quot;started by :hover&quot;) and groups all the effects one hover started. When nothing is moving at the note&apos;s moment, it lists the element&apos;s recent animations, presses included.</li>
        <li><b>Thin animated shapes.</b> An animated SVG stroke under the pointer is listed and picked.</li>
        <li><b>Video.</b> A note on a background video gives its time, length, loop and speed.</li>
        <li><K>⌥P</K> pauses even when the app has a text field focused.</li>
      </ul>

      <Release id="v0-5-2" version="0.5.2" tag="Groups and code" />
      <ul>
        <li><b>One note for a group.</b> Pick a container whose children each animate (an equalizer&apos;s bars) and choose <b>Whole group</b>: one note carries every child&apos;s animation, its point or range on its own clock and its own exact edit.</li>
        <li><b>The animation that moves.</b> 0ms clips no longer become a note&apos;s subject, and an animation started again on scroll is one entry with its run times.</li>
        <li><b>Clearer exact edits.</b> They say they change only the note&apos;s point or range; &ldquo;faster&rdquo;, &ldquo;hold longer&rdquo; and the like get an <C>Intent:</C> line instead. Loops get exact edits too.</li>
        <li><b>Picking under overlays.</b> The ⌘ list shows everything stacked at the pointer (strokes under an image, inline words) and marks what animates; click any row.</li>
        <li><b>Ranges from the keyboard.</b> On an open animation, <K>Shift</K>+<K>←</K>/<K>→</K> grows a range from the point; <K>⌥</K>+<K>←</K>/<K>→</K> moves between keyframes.</li>
        <li><b>Timelines keep their own code.</b> Each timeline rebuilds with the code it had, in every mode. The first code change with two timelines asks <b>Separate code</b> or <b>Share code</b>; the newest code goes back on disk when Retake stops. <Link href="/docs/features#code">More</Link></li>
        <li><b>Safe with git.</b> HEAD, the index and refs are never touched, a branch switch pauses swapping, and hot updates are held while files switch.</li>
        <li><b>Code from a terminal and for agents.</b> <C>retake code status | list | checkout | restore | export</C>; <C>acknowledge</C> puts the note&apos;s timeline&apos;s code on disk, and agents get <C>checkout_timeline</C> and <C>get_code_diff</C>.</li>
        <li>Source lines on Next 15 with Turbopack for elements a bundled library rendered.</li>
        <li>Front server: a kept page is served again whenever the code it was rendered with is back on disk.</li>
      </ul>

      <Release id="v0-5-1" version="0.5.1" tag="Animations" />
      <ul>
        <li><b>Next.js on its own dev URL.</b> One line in <C>proxy.ts</C> (<C>middleware.ts</C> on Next 15) and the timeline shows on <C>next dev</C>&apos;s own address. <Link href="/docs/install#nextjs">Install</Link></li>
        <li><b>The right element.</b> ⌘-click picks what&apos;s under the pointer, SVG paths and overlays included, with a selector that matches exactly one element.</li>
        <li><b>Each element&apos;s animations on their own clock.</b> Open one from the element&apos;s row: its keyframes, what it moves, and x, y and size at the playhead, with its path drawn on the app.</li>
        <li><b>Notes at a frame or over a range.</b> Click a point on the animation, or drag across it (200–400 ms). Your agent gets the animation, where it&apos;s defined, the local times and values, and an exact edit for that part only.</li>
        <li><b>Agents can read the recording.</b> MCP <C>get_moment</C>, <C>get_timeline_events</C> and <C>get_animation</C>; sources resolve through source maps to your files.</li>
      </ul>

      <Release id="v0-5-0" version="0.5.0" tag="Dock" />
      <ul>
        <li><b>Collapse to an icon.</b> Drag the divider to the bottom edge, or press <K>⌥T</K>: the dock folds into a round button in the corner, keeps recording, and shows the phase as a dot. Remembered across reloads. <Link href="/docs/features#collapse">More</Link></li>
        <li><b>Notes only when paused.</b> Note pins show while the app is paused or in the past. While it&apos;s live or playing they&apos;re hidden, and the count still shows how many notes the take has.</li>
        <li><b>Leaving the page keeps the last seconds.</b> Typing a new address or reloading the dock while recording no longer loses what came after the last save.</li>
        <li><b>Phones.</b> 40px controls, a divider you can drag with a finger to resize or fold the dock, Start fresh as an icon on narrow screens, and the dock and its corner button clear of the home indicator.</li>
        <li><b>Room for the dock.</b> In the app&apos;s frame, <C>window.__retakeDockHeight</C> is the height the dock covers (0 when folded), and a <C>retake:dock</C> event says when it changes.</li>
        <li><C>shellHtml({"{ server: false }"})</C> for a dock with no Retake server behind it (a static deploy): it never asks <C>/__retake/</C> and keeps the session in memory.</li>
        <li><b>Timeline names.</b> Timelines are named Timeline 1, Timeline 2 (they were Main, Take 2). Old sessions show the new names; names you gave them stay.</li>
      </ul>

      <Release id="v0-4-0" version="0.4.0" tag="First release" />
      <H3>Going back</H3>
      <ul>
        <li>A timeline docked at the bottom of your app that records from page load. Drag back and the app is at that moment.</li>
        <li>A virtual clock for timers, <C>requestAnimationFrame</C>, <C>Date</C>, idle callbacks, CSS and Web Animations; seeded <C>Math.random</C> and <C>crypto</C>.</li>
        <li>Server replies answered from the recording: <C>fetch</C> (streams chunk by chunk), XHR, <C>EventSource</C>, WebSockets; observers and worker messages too. Storage, cookies and IndexedDB restored.</li>
        <li>Going back shows a live preview at once, builds the real moment behind it and swaps it in.</li>
      </ul>
      <H3>Takes and notes</H3>
      <ul>
        <li>Takes: <K>+</K> or <K>Ctrl</K>-click starts a new timeline from any moment, paused.</li>
        <li>Notes on elements and their animation layers, with <b>Copy for agent</b>: element, React component, source file and line, CSS and the moment.</li>
        <li>An MCP server (<C>retake mcp</C>) with seven tools, so your coding agent can read, acknowledge, reply to and resolve notes.</li>
        <li><C>--code-branches</C>: each take keeps its own version of the code (Vite apps).</li>
      </ul>
      <H3>Any dev server</H3>
      <ul>
        <li>The Vite plugin, <C>retake()</C>, and the CLI, <C>npx retake-dev .</C>, which leaves your files alone.</li>
        <li>The front server for frameworks that render their own HTML: Next.js 15 and 16, React Router 7, Remix 2, Astro, SvelteKit, Nuxt; <C>retake -- &lt;command&gt;</C> and <C>retake http://…</C> for anything else.</li>
        <li>Types for the plugin and for <C>window.__retake</C> (<C>retake-dev/client</C>).</li>
        <li>Licensed under PolyForm Shield 1.0.0.</li>
      </ul>
    </DocArticle>
  )
}
