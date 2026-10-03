import Link from "next/link"
import type { Metadata } from "next"
import { docMetadata } from "../../../src/docs/nav.ts"
import { C, DocArticle, H2, Table } from "../../../src/docs/ui.tsx"

export const metadata: Metadata = docMetadata("faq")

const toc = [
  { id: "production", label: "Does it ship to production?" },
  { id: "browsers", label: "Which browsers?" },
  { id: "safari", label: "Does it work in Safari?" },
  { id: "not-rewound", label: "What isn't rewound?" },
  { id: "data", label: "Where does my data live?" },
  { id: "sign-in", label: "Sign-in and OAuth" },
  { id: "covered", label: "The dock covers my app" },
  { id: "react", label: "Do I need React?" },
  { id: "license", label: "What's the license?" },
]

export default function Faq() {
  return (
    <DocArticle slug="faq" toc={toc} lede="Short answers. If yours isn't here, open an issue on GitHub.">
      <div className="d-faq">
        <H2 id="production">Does it ship to production?</H2>
        <p>
          No. The Vite plugin only runs in <C>vite dev</C>; <C>vite build</C> output has no Retake code in it. The CLI and the front server are dev tools you start by hand,
          and they don&apos;t change your project&apos;s files (except <C>--code-branches</C>, which does, on purpose). Uninstall it and nothing is left but the <C>.retake/</C> folder.
        </p>
      </div>
      <div className="d-faq">
        <H2 id="browsers">Which browsers?</H2>
        <p>
          Chrome, Edge, Arc, Brave and other Chromium browsers. That&apos;s what every test and framework check runs in. Firefox hasn&apos;t been tested.
        </p>
      </div>
      <div className="d-faq">
        <H2 id="safari">Does it work in Safari?</H2>
        <p>
          It isn&apos;t tested in Safari, so treat it as unsupported for now. Retake tells its frame apart from the dock page by the <C>Sec-Fetch-*</C> headers browsers send;
          for browsers that don&apos;t send them, the front server falls back to a marker in the frame&apos;s URL, but that path hasn&apos;t run in a real Safari. Use a Chromium browser for Retake.
        </p>
      </div>
      <div className="d-faq">
        <H2 id="not-rewound">What isn&apos;t rewound?</H2>
        <p>Retake rewinds the browser, not your server. Replays answer from the recording instead of calling the server again.</p>
        <Table
          className="wrap-first"
          head={["Not rewound", "Why, or what to do"]}
          rows={[
            ["Database writes, server sessions, server-action side effects", "They happened on your server and stay as they are. Retake suits prototypes whose backends don't remember state"],
            ["Service workers and the Cache API", "Service workers are off while Retake is in front"],
            ["Cross-origin iframes", "Retake can't run its clock inside another origin's page"],
            [<>Native <C>import()</C> timing</>, "Vite's lazy routes and Astro islands load when the browser fetches them; they can't be held to their recorded moment"],
            ["Canvas and WebGL pixels in the preview", "Dragging shows the DOM; canvas pixels are right once the rebuilt moment swaps in"],
            [<><C>--code-branches</C> on frameworks</>, "Code per take is for Vite apps only"],
          ]}
        />
      </div>
      <div className="d-faq">
        <H2 id="data">Where does my data live?</H2>
        <p>In a <C>.retake/</C> folder in your project, on your machine. Nothing is sent anywhere. The folder git-ignores itself.</p>
        <Table
          head={["Path", "What"]}
          rows={[
            [<C key="c">session.json</C>, "Takes, bookmarks and notes"],
            [<C key="c">recordings/</C>, "One gzipped recording per take: your inputs and what your API answered"],
            [<C key="c">docs/</C>, "Front server: the frame's pages as they came, so a rebuild gets the HTML it was recorded with (the last 200)"],
            [<C key="c">versions/</C>, <>With <C>--code-branches</C>: code snapshots</>],
            [<C key="c">server.json</C>, "The running server's URL and token, for the MCP server. Removed when it stops"],
            [<C key="c">front.log</C>, <>With <C>--verbose</C>: every request the front server handled</>],
          ]}
        />
        <p>
          Recordings hold what you typed and what your API answered, so treat <C>.retake/</C> like any local data. <b>Start fresh</b> in the dock clears the takes, notes and recordings; <C>rm -rf .retake</C> clears everything.
          <C> --root</C> puts it somewhere else.
        </p>
      </div>
      <div className="d-faq">
        <H2 id="sign-in">Sign-in and OAuth</H2>
        <p>
          Sign-in pages from other sites refuse to load inside a frame, and Retake runs your app in one. Sign in at your app&apos;s own port first (cookies on <C>localhost</C> are shared
          across ports), then open Retake&apos;s. Retake prints that reminder when it starts. A sign-in redirect that comes back from another site gets the plain page, so the sign-in completes;
          reload to get the dock back.
        </p>
      </div>
      <div className="d-faq">
        <H2 id="covered">The dock covers the bottom of my app</H2>
        <p>
          It floats over it, so a cookie banner&apos;s buttons or Next&apos;s dev badge can end up underneath. Drag the dock&apos;s divider down, <Link href="/docs/features#collapse">collapse it</Link> with <kbd>⌥T</kbd>,
          or open the app with <C>?retake=0</C> for one load.
        </p>
      </div>
      <div className="d-faq">
        <H2 id="react">Do I need React?</H2>
        <p>
          No. Recording, going back and takes work with any framework or none. Notes name the React component and source line when the app is React in development mode;
          on anything else they still carry the selector, classes, computed styles, size and moment.
        </p>
      </div>
      <div className="d-faq">
        <H2 id="license">What&apos;s the license?</H2>
        <p>
          <a href="https://polyformproject.org/licenses/shield/1.0.0" target="_blank" rel="noreferrer">PolyForm Shield 1.0.0</a>. In plain words: use it, change it and share it for anything, at work or at home,
          except to build a product that competes with Retake. Keep the license and its copyright notice with any copy you share.
        </p>
      </div>
    </DocArticle>
  )
}
