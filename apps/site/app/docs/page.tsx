import Link from "next/link"
import type { Metadata } from "next"
import { PmTabs } from "../../src/docs/client.tsx"
import { docMetadata } from "../../src/docs/nav.ts"
import { C, DocArticle, H2, K, Note } from "../../src/docs/ui.tsx"

export const metadata: Metadata = docMetadata("")

const toc = [
  { id: "start", label: "30-second start" },
  { id: "what-rewinds", label: "What rewinds" },
  { id: "how", label: "How going back works" },
  { id: "next", label: "Where next" },
]

// Two timelines: Timeline 1 (blue) records on; Timeline 2 (amber) branches off it at the playhead.
function Threads() {
  return (
    <figure className="d-figure">
      <svg viewBox="0 0 640 128" fill="none" role="img" aria-label="A timeline with a second one branching off it at the playhead">
        <text x="0" y="34" fill="#8f8f8f" fontFamily="var(--d-mono)" fontSize="11">Timeline 1</text>
        <path d="M84 30 H620" stroke="#52a8ff" strokeWidth="2" strokeLinecap="round" opacity=".7" />
        <text x="0" y="94" fill="#8f8f8f" fontFamily="var(--d-mono)" fontSize="11">Timeline 2</text>
        <path d="M300 30 C340 30 340 90 380 90 H560" stroke="#ffb224" strokeWidth="2" strokeLinecap="round" />
        <circle cx="300" cy="30" r="5" fill="#fff" />
        <circle cx="300" cy="30" r="10" stroke="rgba(255,255,255,.25)" />
        <rect x="459" y="72" width="2" height="36" rx="1" fill="#fff" />
        <path d="M454 66h12v6l-6 5-6-5z" fill="#fff" />
      </svg>
      <figcaption>Press <K>+</K> on a moment of Timeline 1 and Timeline 2 starts there. Timeline 1 stays one click away.</figcaption>
    </figure>
  )
}

export default function Overview() {
  return (
    <DocArticle
      slug=""
      toc={toc}
      lede={<>Retake records your prototype while you use it. Drag the timeline back and the app is at that moment, rebuilt by its own code. Press <K>+</K> to try something else from there.</>}
    >
      <p>
        It runs in front of your dev server: a Vite app, Next.js, React Router, Remix, Astro, SvelteKit, Nuxt, or anything else that serves HTML.
        The timeline docks at the bottom of the page. Your files aren&apos;t touched and nothing ships in a production build.
      </p>

      <H2 id="start">30-second start</H2>
      <p>From your app&apos;s folder:</p>
      <PmTabs label="Package manager" commands={{ npm: "npx retake-dev .", pnpm: "pnpm dlx retake-dev .", yarn: "yarn dlx retake-dev .", bun: "bunx retake-dev ." }} />
      <ol className="d-steps">
        <li>Open the URL it prints, <C>http://localhost:3014</C> by default. It&apos;s recording from page load.</li>
        <li>Use the app for a few seconds, then press <K>Space</K> to pause. Paused, the app is view-only: you can scroll, not click.</li>
        <li>Drag the playhead back. The moment shows at once as a preview; let go and it&apos;s rebuilt for real.</li>
        <li>Press <K>+</K>. A new timeline starts at that moment, paused. Press play and do something different.</li>
        <li>Hold <K>⌘</K> and click an element to leave a note. <b>Copy for agent</b> copies it as a prompt, or your agent reads it over <Link href="/docs/mcp">MCP</Link>.</li>
      </ol>
      <Note>
        <p>Use the full name <C>retake-dev</C> with npx. The short <C>retake</C> command exists once it&apos;s installed in the project; an unrelated npm package is called <C>retake</C>.</p>
      </Note>

      <H2 id="what-rewinds">What rewinds</H2>
      <p>The browser side of your app:</p>
      <ul>
        <li>Timers, <C>requestAnimationFrame</C>, <C>Date</C>, <C>performance.now</C> and idle callbacks run on a virtual clock.</li>
        <li>CSS transitions, keyframe animations, Web Animations and SVG&apos;s own animations follow that clock.</li>
        <li><C>Math.random</C> and <C>crypto</C> are seeded, so a replay draws the same numbers.</li>
        <li>Server replies are answered from the recording: <C>fetch</C> (streams chunk by chunk), XHR, <C>EventSource</C> and WebSockets. So are observer callbacks and worker messages.</li>
        <li>Web storage, cookies and IndexedDB go back to how they were when the recording began.</li>
      </ul>
      <p>
        Your server doesn&apos;t rewind. Database writes and server sessions stay as they are; replays never call the server again. See <Link href="/docs/faq#not-rewound">what isn&apos;t rewound</Link>.
      </p>

      <H2 id="how">How going back works</H2>
      <Threads />
      <p>
        Retake doesn&apos;t snapshot the DOM. It records every input (pointer, keys, typing, scrolling, back and forward) and runs time on a virtual clock.
        Going back loads the page again in a hidden frame and replays those inputs at full speed up to the moment you picked, so your app&apos;s own code builds the screen.
        While that frame builds, a preview of the moment is on show, and the real one swaps in when it&apos;s ready. You only wait if you press play or <K>+</K> before then.
      </p>

      <H2 id="next">Where next</H2>
      <div className="d-cards">
        <Link className="d-card" href="/docs/install"><b>Install</b><span>Every framework&apos;s command, the Vite plugin, uninstalling.</span></Link>
        <Link className="d-card" href="/docs/features"><b>Features</b><span>Timelines, notes, Start fresh and the keyboard shortcuts.</span></Link>
        <Link className="d-card" href="/docs/mcp"><b>MCP</b><span>Hand notes to your coding agent and let it answer them.</span></Link>
      </div>
    </DocArticle>
  )
}
