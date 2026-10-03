// The playground: three small demos with the dock under them, stacked in the
// page's centre column. Each says what to do in one sentence; src/play.ts
// makes them work.
import type { Metadata } from "next"
import { Island } from "../island.tsx"
import { Mount } from "../../src/mount.tsx"
import { FootLinks, Header } from "../../src/nav.tsx"
import { PAGES, pageMetadata } from "../../src/site.ts"

export const metadata: Metadata = pageMetadata(PAGES.playground)

export default function Playground() {
  return (
    <>
      <Header current="playground" />
      <main className="page playground">
        <h1>Playground</h1>
        <p className="lede">
          The bar at the bottom is Retake, recording as you go. Play with a demo, then pause and drag the timeline back.
        </p>

        <div className="demos">
          <figure className="pg">
            <div className="stage" id="island-stage"><Island /></div>
            <figcaption>Click the island a few times, then drag back to see it change shape in reverse.</figcaption>
          </figure>

          <figure className="pg">
            <div className="stage">
              <p className="toast-empty">No toasts yet</p>
              <ol className="toasts" id="toasts" aria-live="polite"></ol>
              <button className="ghost-btn" id="toast-add">Add a toast</button>
            </div>
            <figcaption>Add a few toasts and swipe one away, then drag back to bring it back.</figcaption>
          </figure>

          <figure className="pg">
            <div className="stage">
              <div className="palette" id="palette">
                <label className="search"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4-4"/></svg><span className="sr">Search commands</span><input id="cmdk" type="text" placeholder="Type a command…" autoComplete="off" spellCheck="false" role="combobox" aria-expanded="true" aria-controls="cmdk-list" /></label>
                <div className="list" id="cmdk-list" role="listbox" aria-label="Commands"><span className="hl" aria-hidden="true"></span></div>
                <p className="empty" hidden>No commands match.</p>
              </div>
              <div className="ran mono" id="ran" aria-live="polite"></div>
            </div>
            <figcaption>Type to filter the list, then step back frame by frame as the rows move.</figcaption>
          </figure>
        </div>
      </main>
      <footer className="foot plain">
        <FootLinks />
      </footer>
      <Mount page="playground" />
    </>
  )
}
