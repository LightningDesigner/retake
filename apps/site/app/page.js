// The landing page. Its markup is static; src/mount.js starts the canvas hero,
// the package-manager switch, the copy button and the four demos on it.
import { Island } from "./island.js"
import { Mount } from "../src/mount.js"
import { PAGES } from "../src/site.js"

export const metadata = { title: PAGES.index.title, description: PAGES.index.description }

const Arrow = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
)
const Bin = () => <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>

export default function Landing() {
  return (
    <>
      <nav className="nav" aria-label="Main">
        <a className="brand" href="#top" aria-label="Retake, back to top"><span className="mark" aria-hidden="true"><i></i></span>Retake</a>
        <div className="links">
          <a href="#how">How it works</a>
        </div>
        <a className="nav-cta" href="#install">Install</a>
      </nav>

      <header className="hero" id="top">
        <canvas id="threads" aria-hidden="true"></canvas>
        <div className="hero-inner">
          <h1>Retake</h1>
          <p className="lede">Your prototype, at any moment. <b>Drag back to watch. Press + to try something else from there.</b></p>
          <div className="run surface mono">
            <span className="run-clock" aria-hidden="true"><span className="dot"></span><span id="t">00:00.00</span><span id="dir">Playing</span></span>
            <span className="run-cmd"><span className="p">$</span><code id="cmd">npx retake-dev .</code></span>
            <button className="copy" data-copy="npx retake-dev ." aria-label="Copy the command">
              <svg className="i-copy" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>
              <svg className="i-done" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>
            </button>
          </div>
        </div>
      </header>

      <section id="how">
        <div className="wrap">
          <div className="eyebrow mono">How it works</div>
          <h2>Stop restarting the whole flow to see one animation again.</h2>
          <div className="steps">
            <div className="step surface">
              <div className="screen">
                <svg viewBox="0 0 300 120" fill="none" aria-hidden="true"><rect x="24" y="44" width="252" height="32" rx="16" fill="rgba(255,255,255,.04)" stroke="rgba(255,255,255,.1)"/><text x="44" y="65" fill="#8f8f8f" fontFamily="Geist Mono" fontSize="12">$ npx retake-dev .</text><rect x="178" y="54" width="7" height="12" rx="1.5" fill="#52a8ff"><animate attributeName="opacity" values="1;0;1" dur="1s" repeatCount="indefinite"/></rect></svg>
              </div>
              <div className="n mono">01</div>
              <h3>Run it</h3>
              <p>Point it at a Vite app with an index.html. Your files stay untouched. Nothing ships to production.</p>
            </div>
            <div className="step surface">
              <div className="screen">
                <svg viewBox="0 0 300 120" fill="none" aria-hidden="true"><rect x="24" y="57" width="252" height="6" rx="3" fill="rgba(255,255,255,.08)"/><rect x="24" y="57" width="180" height="6" rx="3" fill="#52a8ff" opacity=".55"><animate attributeName="width" values="180;70;70;180" keyTimes="0;.4;.7;1" dur="3.2s" repeatCount="indefinite"/></rect><g><animateTransform attributeName="transform" type="translate" values="0 0;-110 0;-110 0;0 0" keyTimes="0;.4;.7;1" dur="3.2s" repeatCount="indefinite"/><rect x="203" y="38" width="2" height="44" rx="1" fill="#fff"/><path d="M198 32h12v6l-6 5-6-5z" fill="#fff"/></g></svg>
              </div>
              <div className="n mono">02</div>
              <h3>Drag back</h3>
              <p>Timers, animations, random values and replies rewind with it: fetch, streams, XHR, SSE, WebSockets. Looking back is view-only, like a paused video.</p>
            </div>
            <div className="step surface">
              <div className="screen">
                <svg viewBox="0 0 300 120" fill="none" aria-hidden="true"><path d="M24 46 H276" stroke="#52a8ff" strokeWidth="2" strokeLinecap="round" opacity=".55"/><path d="M120 46 C160 46 160 78 200 78 H276" stroke="#ffb224" strokeWidth="2" strokeLinecap="round" strokeDasharray="200" strokeDashoffset="200"><animate attributeName="stroke-dashoffset" values="200;0;0" keyTimes="0;.5;1" dur="2.8s" repeatCount="indefinite"/></path><circle cx="120" cy="46" r="5" fill="#fff"/><circle cx="120" cy="46" r="10" fill="none" stroke="rgba(255,255,255,.25)"/></svg>
              </div>
              <div className="n mono">03</div>
              <h3>Press +</h3>
              <p>A new timeline starts from that moment. Take it somewhere else; the old one stays one click away.</p>
            </div>
          </div>
        </div>
      </section>

      <section id="try">
        <div className="wrap">
          <div className="eyebrow mono">Try it</div>
          <h2>Play with these. Then drag the timeline back.</h2>
          <p className="sub">The bar at the bottom of this page is Retake, recording as you go. Drag it back to any moment, or press <kbd>+</kbd> to try again from there.</p>
          {/* _top: in Retake this page runs in the dock's frame; the playground is a page of its own, with its own dock. */}
          <p className="pg-open"><a className="pg-btn" href="/try" target="_top">Open the playground<Arrow /></a></p>
          <div className="demos">
            <article className="demo surface">
              <div className="stage" id="island-stage">
                <Island />
              </div>
              <div className="meta"><h3>The island</h3><p>Each click morphs it into the next state. Drag back to see the frames in between.</p></div>
            </article>

            <article className="demo surface">
              <div className="stage" id="toast-stage">
                <button className="ghost-btn edge top" id="toast-add">Add a toast</button>
                <ol className="toasts" id="toasts" aria-live="polite"></ol>
              </div>
              <div className="meta"><h3>Toast stack</h3><p>Add a few, hover to fan them out, swipe one away.</p></div>
            </article>

            <article className="demo surface">
              <div className="stage">
                <button className="hold" id="hold">
                  <span className="layer base"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><Bin /></svg>Hold to delete</span>
                  <span className="layer fill" aria-hidden="true"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><Bin /></svg>Hold to delete</span>
                  <span className="layer done" aria-hidden="true"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>Deleted</span>
                </button>
                <p className="stage-hint edge bottom" id="hold-hint">Let go early to cancel</p>
              </div>
              <div className="meta"><h3>Hold to confirm</h3><p>Let go early and it slides back. Scrub the fill to check its easing.</p></div>
            </article>

            <article className="demo surface">
              <div className="stage">
                <div className="palette" id="palette">
                  <label className="search"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4-4"/></svg><span className="sr">Search commands</span><input id="cmdk" type="text" placeholder="Type a command…" autoComplete="off" spellCheck="false" role="combobox" aria-expanded="true" aria-controls="cmdk-list" /><kbd>⌘K</kbd></label>
                  <div className="list" id="cmdk-list" role="listbox" aria-label="Commands"><span className="hl" aria-hidden="true"></span></div>
                  <p className="empty" hidden>No commands match.</p>
                </div>
                <div className="ran mono" id="ran" aria-live="polite"></div>
              </div>
              <div className="meta"><h3>Command menu</h3><p>Filter, then pick with the arrow keys. Each row slides to its new place.</p></div>
            </article>
          </div>
        </div>
      </section>

      <section id="install">
        <div className="wrap">
          <div className="eyebrow mono">Install</div>
          <h2>One command. That&apos;s the setup.</h2>
          <div className="pm surface mono" role="tablist" aria-label="Package manager">
            <span className="thumb" aria-hidden="true"></span>
            <button role="tab" aria-selected="true" data-pm="npm">npm</button>
            <button role="tab" aria-selected="false" data-pm="pnpm">pnpm</button>
            <button role="tab" aria-selected="false" data-pm="yarn">yarn</button>
            <button role="tab" aria-selected="false" data-pm="bun">bun</button>
          </div>
          <div className="cli surface">
            <div className="row"><code className="mono"><span data-install>npm i -D retake-dev</span></code><span>Add it to the project. Or skip this and use <code className="inline mono">npx retake-dev .</code></span></div>
            <div className="row"><code className="mono"><span data-run>npx retake</span> <span className="dim">&lt;project&gt;</span></code><span>Run the project&apos;s own dev server with the timeline docked at the bottom.</span></div>
            <div className="row"><code className="mono"><span data-run>npx retake</span> . <span className="dim">--port 4000</span></code><span>Pick the port.</span></div>
            <div className="row"><code className="mono"><span data-run>npx retake</span> . <span className="dim">--code-branches</span></code><span>Each timeline keeps its own version of the code. Rewrites files on disk, so use it on prototypes.</span></div>
            <div className="row"><code className="mono"><span data-run>npx retake</span> init</code><span>Prefer it in the repo? Prints the two lines for vite.config.</span></div>
            <div className="row"><code className="mono">claude mcp add retake <span className="dim">-- npx -y retake-dev mcp</span></code><span>Your notes reach a coding agent over MCP. It can reply, acknowledge and resolve.</span></div>
          </div>
          <div className="keys"><span><kbd>⌥P</kbd>Play / pause</span><span><kbd>+</kbd>New timeline from here</span><span><kbd>⌘</kbd>Hold and click to leave a note while looking back</span><span><kbd>?retake=0</kbd>Skip for one load</span></div>
        </div>
      </section>
      <Mount page="index" />
    </>
  )
}
