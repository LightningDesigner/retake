// The playground: just the island, full screen, for the dock to rewind.
import { Island } from "../island.js"
import { Mount } from "../../src/mount.js"
import { PAGES } from "../../src/site.js"

export const metadata = { title: PAGES.try.title, description: PAGES.try.description }

export default function Playground() {
  return (
    <>
      {/* _top: in Retake this page runs in the dock's frame, and the landing page should load as a page of its own (with its own dock). */}
      <a className="pg-back mono" href="/" target="_top"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>Retake</a>
      <main className="pg-stage" id="island-stage">
        <h1 className="sr">Retake playground</h1>
        <Island />
      </main>
      <Mount page="try" />
    </>
  )
}
