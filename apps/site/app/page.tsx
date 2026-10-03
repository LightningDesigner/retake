// The overview: the pitch, one picture of Retake (a mock browser window with
// the timeline under it, the playhead dragged back), three steps, and the
// agent part. The footer's canvas is started by src/mount.tsx.
import type { Metadata } from "next"
import { Mount } from "../src/mount.tsx"
import { FootLinks, Header } from "../src/nav.tsx"
import { PAGES, pageMetadata } from "../src/site.ts"

export const metadata: Metadata = pageMetadata(PAGES.index)

// A still of Retake under a to-do app, drawn like the real dock: paused, the
// playhead dragged back past the third task, so the app shows two. Its one
// motion: on load the playhead glides back from the end to there (the third
// task leaves as it passes). Without motion it rests on that state.
function Demo() {
  return (
    <figure className="demo">
      <div className="win" role="img" aria-label="A to-do app with Retake's timeline under it. The playhead is dragged back, and the app shows the list as it was at that moment.">
        <div className="win-bar" aria-hidden="true"><i></i><i></i><i></i><span className="win-url mono">localhost:5173</span></div>
        <div className="app" aria-hidden="true">
          <div className="app-head"><b>Today</b><span>Tasks</span></div>
          <ul className="tasks">
            <li className="done"><i></i>Fix the login redirect</li>
            <li><i></i>Make the header bolder</li>
            <li className="slot">
              <span className="t3"><i></i>Ship the header</span>
              <span className="add">Add a task</span>
            </li>
          </ul>
        </div>
        <div className="dock" aria-hidden="true">
          <div className="dock-bar">
            <span className="pill">
              <span className="play"><svg viewBox="0 0 10 10" width="8" height="8"><path d="M2.5 1.5v7l6-3.5z" fill="currentColor" /></svg></span>
              <span className="time mono">00:02<small>.40</small></span>
              <span className="state">Paused</span>
            </span>
          </div>
          <div className="dock-lanes">
            <span className="lane-name"><i></i>Timeline 1</span>
            <div className="track-area">
              <div className="ruler mono">
                <span style={{ left: "0%" }}>0s</span><span style={{ left: "25%" }}>1s</span><span style={{ left: "50%" }}>2s</span><span style={{ left: "75%" }}>3s</span>
              </div>
              <div className="line">
                <span className="past"></span>
                <span className="ahead"></span>
                <span className="end"></span>
              </div>
              <span className="head"><span className="handle"></span></span>
            </div>
          </div>
        </div>
      </div>
      <figcaption>Drag the playhead back and the app goes back with it.</figcaption>
    </figure>
  )
}

export default function Overview() {
  return (
    <>
      <Header current="overview" />
      <main className="page overview">
        <h1>Rewind your app <em>while you build it.</em></h1>
        <p className="lede">
          Retake records your app as you use it in development. Drag the timeline back and the app is really there, ready for you to try something else.
        </p>

        <Demo />

        <section aria-labelledby="how-h">
          <h2 id="how-h">How it works</h2>
          <ol className="steps">
            <li><span>Run <code className="inline-code mono">npx retake-dev .</code> in your app&apos;s folder.</span></li>
            <li><span>Use your app, then pause and drag the timeline back.</span></li>
            <li><span>Press <kbd>+</kbd> to try something else from that moment.</span></li>
          </ol>
          <p className="small">Works with Vite, Next.js, React Router, Remix, Astro, SvelteKit and Nuxt. Dev only.</p>
        </section>

        <section aria-labelledby="agent-h">
          <h2 id="agent-h">With your coding agent</h2>
          <p>Hold <kbd>⌘</kbd> and click anything to leave a note on that moment. Copy it for your agent, or let the agent read notes over MCP.</p>
          <p><a className="more" href="/docs/mcp" target="_top">Set up MCP</a></p>
        </section>
      </main>

      <footer className="foot">
        <canvas id="threads" aria-hidden="true"></canvas>
        <FootLinks />
      </footer>
      <Mount page="index" />
    </>
  )
}
