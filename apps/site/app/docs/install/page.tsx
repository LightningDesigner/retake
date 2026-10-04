import Link from "next/link"
import type { Metadata } from "next"
import { PmTabs } from "../../../src/docs/client.tsx"
import { docMetadata } from "../../../src/docs/nav.ts"
import { C, Code, DocArticle, H2, H3, Note, Table } from "../../../src/docs/ui.tsx"

export const metadata: Metadata = docMetadata("install")

const toc = [
  { id: "requirements", label: "Requirements" },
  { id: "agent", label: "Install with your agent" },
  { id: "npx", label: "Try it without installing" },
  { id: "install", label: "Install in the project" },
  { id: "vite-plugin", label: "Vite plugin" },
  { id: "nextjs", label: "Next.js" },
  { id: "frameworks", label: "Frameworks" },
  { id: "running", label: "A server that's already running" },
  { id: "ports", label: "Ports" },
  { id: "uninstall", label: "Uninstall" },
]

const VITE_CONFIG = `import { defineConfig } from "vite"
import { retake } from "retake-dev"

export default defineConfig({
  plugins: [retake(), /* ...your plugins */],
})`

const NEXT_16 = `export { default } from "retake-dev/next"`

const NEXT_15 = `import retake from "retake-dev/next"
export default retake
export const config = { runtime: "nodejs" }`

const NEXT_WRAP = `import { withRetake } from "retake-dev/next"

export default withRetake(async (req) => {
  // ...your middleware, as before
})`

const NEXT_MATCHER = `export const config = {
  matcher: [
    "/__retake/:path*",
    { source: "/((?!_next/static|_next/image).*)", has: [{ type: "header", key: "sec-fetch-mode", value: "navigate" }] },
    // ...your entries
  ],
}`

export default function Install() {
  return (
    <DocArticle slug="install" toc={toc} lede="One command in your app's folder. Retake works out what kind of project it is and how to run it.">
      <H2 id="requirements">Requirements</H2>
      <ul>
        <li>Node 18 or newer.</li>
        <li>A Vite 5+ app served from an <C>index.html</C> (React, Vue, Svelte, plain JS), or any dev server that serves HTML: Next.js, React Router, Remix, Nuxt, SvelteKit, Astro.</li>
        <li>Chrome, Edge or another Chromium browser. That&apos;s what it&apos;s tested on (<Link href="/docs/faq#browsers">browsers</Link>).</li>
      </ul>

      <H2 id="agent">Install with your agent</H2>
      <p>Paste this into Claude Code, Cursor or any coding agent:</p>
      <Code title="Prompt">{`Add Retake to this project so its timeline shows on the normal dev URL: install retake-dev as a dev dependency with the project's package manager. Put the Next file next to the app/ folder (the root, or src/ for src/app). Next.js 16: add proxy.ts with export { default } from "retake-dev/next". Next.js 15: add middleware.ts with import retake from "retake-dev/next", export default retake, export const config = { runtime: "nodejs" }. If a proxy or middleware already exists, wrap its default export in withRetake from "retake-dev/next". Vite: add retake() from "retake-dev" to the Vite plugins. Anything else: add a "dev:retake": "retake ." script to package.json. Add .retake/ to .gitignore, and don't change anything else. Docs: https://retake-omega.vercel.app/docs/install`}</Code>
      <p>Or install the skill once and run <C>/retake</C> in your agent:</p>
      <Code title="Terminal">{"npx skills add LightningDesigner/retake"}</Code>
      <p>
        The skill does the same, and also connects the <Link href="/docs/mcp">MCP server</Link>: it adds <C>retake</C> to the project&apos;s <C>.mcp.json</C> (or <C>.cursor/mcp.json</C>),
        so your notes reach your agent without another step. Your agent asks once to turn it on. It installs a second skill, <C>retake-notes</C>, on how to work through notes.
      </p>

      <H2 id="npx">Try it without installing</H2>
      <PmTabs label="Package manager" commands={{ npm: "npx retake-dev .", pnpm: "pnpm dlx retake-dev .", yarn: "yarn dlx retake-dev .", bun: "bunx retake-dev ." }} />
      <p>
        Open the URL it prints (<C>http://localhost:3014</C> by default). On a Vite app it runs your own <C>vite.config</C> through a wrapper kept in your temp folder;
        on a framework it runs your <C>dev</C> script and sits in front of it. Retake keeps its session in a <C>.retake/</C> folder in the app, which git-ignores itself.
      </p>
      <Note>
        <p>With npx or dlx, use the full name <C>retake-dev</C>. The short <C>retake</C> command only exists after you install <C>retake-dev</C> in the project.</p>
      </Note>

      <H2 id="install">Install in the project</H2>
      <PmTabs label="Package manager" commands={{ npm: "npm i -D retake-dev", pnpm: "pnpm add -D retake-dev", yarn: "yarn add -D retake-dev", bun: "bun add -d retake-dev" }} />
      <p>Then run it from <C>node_modules</C>:</p>
      <Code title="Terminal">{"npx retake ."}</Code>
      <p>Or add a script, so <C>npm run retake</C> starts it:</p>
      <Code lang="json" title="package.json">{`{
  "scripts": {
    "dev": "vite",
    "retake": "retake ."
  }
}`}</Code>

      <H2 id="vite-plugin">Vite plugin</H2>
      <p>To keep your usual <C>npm run dev</C>, add the plugin to <C>vite.config</C> instead. <C>npx retake-dev init</C> prints these lines.</p>
      <Code lang="ts" title="vite.config.ts">{VITE_CONFIG}</Code>
      <p>
        <C>retake()</C> only runs in <C>vite dev</C>; <C>vite build</C> output has no Retake code in it. With no <C>index.html</C> in the Vite root (React Router, SvelteKit, Astro and other
        Vite-based frameworks render their own pages), the plugin docks into the pages your framework renders, on your usual dev server port. Options are on the <Link href="/docs/api#plugin">API page</Link>.
      </p>

      <H2 id="nextjs">Next.js</H2>
      <p>
        Install <C>retake-dev</C> in the project (<Link href="#install">above</Link>), add one file, and keep running <C>next dev</C>: the timeline shows on your usual dev URL,
        with no second port. <C>npx retake-dev init</C> prints these lines.
      </p>
      <ul>
        <li><b>Where the file goes:</b> next to your <C>app/</C> folder. That&apos;s the project root, or <C>src/</C> if your app lives in <C>src/app</C> (<C>src/proxy.ts</C> / <C>src/middleware.ts</C>).</li>
        <li><b>Which file:</b> Next 16 and Next 15 need different ones. Check <C>next</C> in your <C>package.json</C>.</li>
      </ul>
      <Code lang="ts" title="proxy.ts (Next 16)">{NEXT_16}</Code>
      <Code lang="ts" title="middleware.ts (Next 15)">{NEXT_15}</Code>
      <Note>
        <p>
          On Next 15, don&apos;t copy the Next 16 line into <C>middleware.ts</C>: it needs all three lines, including the Node.js runtime (Retake keeps <C>.retake/</C> on disk).
        </p>
      </Note>
      <p>
        <b>Open the page in a browser</b> to see the timeline. It&apos;s added only for real page loads, so <C>curl</C> shows the plain page, and the first request or two right after{" "}
        <C>next dev</C> starts may arrive before Retake has loaded (&ldquo;Retake timeline docked&rdquo; prints when it has).
      </p>
      <p>
        It only runs in <C>next dev</C>; in <C>next build</C> and <C>next start</C> every request goes straight on, and the build has no dock or runtime in it. Notes and{" "}
        <C>npx -y retake-dev mcp</C> work as with the CLI. For separate code per timeline without CLI flags, set <C>RETAKE_CODE_TIMELINES=1</C> (<Link href="/docs/api#code-timelines">more</Link>).
      </p>
      <p>
        Install it from the registry (or a tarball). A <C>file:</C> or linked install is a symlink, which Turbopack doesn&apos;t follow out of the project, and <C>retake-dev/next</C> isn&apos;t found.
      </p>
      <p>Already have a proxy or middleware? Wrap yours:</p>
      <Code lang="ts" title="proxy.ts">{NEXT_WRAP}</Code>
      <p>
        Next reads <C>config</C> from your file as written, so it can&apos;t come from Retake. With a <C>matcher</C> of your own, add Retake&apos;s two entries to it. Your function then also sees
        page loads it didn&apos;t match before.
      </p>
      <Code lang="ts" title="proxy.ts">{NEXT_MATCHER}</Code>
      <p>
        Without installing anything, <C>npx retake-dev .</C> runs <C>next dev</C> behind Retake&apos;s own port (3014) instead. Behind that front server a rebuilt moment gets the page&apos;s HTML as it
        was recorded; with <C>proxy.ts</C> the page is rendered again.
      </p>

      <H2 id="frameworks">Frameworks</H2>
      <p>
        A Vite single-page app gets Retake from the plugin. Anything that renders its own HTML gets it from Retake&apos;s front server: Retake listens on its port, serves the dock there,
        and passes everything else through to your dev server, adding a small script to the framed page as it streams. Assets, data fetches, server actions, API routes and the HMR socket go through untouched.
      </p>
      <p>
        <C>retake .</C> picks the front server for a project that depends on Next, Nuxt, React Router (framework mode), Remix, SvelteKit, Astro, TanStack Start, SolidStart, Vike, Waku or Analog,
        and runs its <C>dev</C> script with the package manager its lockfile names.
      </p>
      <Table
        className="wrap-first"
        head={["Framework", "Run", "Tested on"]}
        rows={[
          ["Vite SPA (React, Vue, Svelte, plain)", <C key="c">npx retake-dev .</C>, <>Vite 5 and newer. Or <C>plugins: [retake()]</C> in <C>vite.config</C>.</>],
          ["Next.js", <C key="c">npx retake-dev .</C>, <>16.3 (app and pages router, server actions) and 15.5 (app router), Turbopack. Or <Link href="#nextjs">proxy.ts</Link> and your usual <C>next dev</C>.</>],
          ["React Router 7 (framework mode)", <C key="c">npx retake-dev .</C>, <>7.18. Or <C>plugins: [retake(), reactRouter()]</C> and your usual <C>npm run dev</C>.</>],
          ["Remix 2 (Vite)", <C key="c">npx retake-dev .</C>, "2.17"],
          ["Astro", <C key="c">npx retake-dev .</C>, <>7.3, with React islands and <C>&lt;ClientRouter /&gt;</C></>],
          ["SvelteKit", <C key="c">npx retake-dev .</C>, "3.0 (Svelte 5)"],
          ["Nuxt", <C key="c">npx retake-dev .</C>, <>4.5. Nuxt ignores <C>PORT</C>: <C>npx retake-dev . -- --port 3001</C> picks its port.</>],
          ["TanStack Start, SolidStart, Vike, Waku, Analog", <C key="c">npx retake-dev .</C>, <>Untested. On Vite you can also add <C>retake()</C> to its Vite plugins.</>],
          ["Anything else that serves HTML", <C key="c">npx retake-dev -- &lt;dev command&gt;</C>, <>e.g. <C>npx retake-dev -- npm run dev</C></>],
          ["A dev server that's already running", <C key="c">npx retake-dev http://localhost:3000</C>, <><C>.retake/</C> goes in the current folder, or <C>--root</C>.</>],
        ]}
      />
      <p>
        Tested means: the app hydrates in the dock with no warning, and recording, scrubbing back, the rebuilt moment, Play, hot updates and reloads all work, started either way.
        The untested ones go through the same front server.
      </p>
      <H3 id="dev-args">Arguments for your dev server</H3>
      <p>Anything after <C>--</C> goes to the dev server. Without a project before it, it&apos;s the command to run:</p>
      <Code title="Terminal">{`npx retake-dev . -- --host        # retake runs your dev script with --host
npx retake-dev -- next dev --turbo  # retake runs this command`}</Code>
      <H3 id="next16">Next.js 16</H3>
      <p>
        Next 16 sends React debug data for each request over its HMR socket. Retake keeps it with the recording and hands it back on replay, so nothing needs changing.
        For a Next version with a debug channel Retake doesn&apos;t know yet, it prints a warning that says to set <C>experimental: {"{ reactDebugChannel: false }"}</C>.
      </p>

      <H2 id="running">A server that&apos;s already running</H2>
      <Code title="Terminal">{"npx retake-dev http://localhost:3000"}</Code>
      <p>Retake serves the dock on its own port and proxies to that server. Ctrl-C stops Retake; your server keeps running.</p>

      <H2 id="ports">Ports</H2>
      <ul>
        <li>Retake serves on <C>3014</C>; <C>--port 4000</C> picks another.</li>
        <li>For a dev command it starts, Retake sets <C>PORT</C> to a free port (or keeps yours if it&apos;s free), and otherwise follows the first <C>http://localhost:…</C> the command prints, so tools that ignore <C>PORT</C> work too.</li>
        <li>Ctrl-C stops the dev server with it.</li>
        <li>The front server only answers requests for localhost, <C>*.localhost</C> and IP addresses. For OAuth sign-in, see the <Link href="/docs/faq#sign-in">FAQ</Link>.</li>
      </ul>

      <H2 id="uninstall">Uninstall</H2>
      <Code title="Terminal">{`npm uninstall retake-dev    # or pnpm remove / yarn remove / bun remove
rm -rf .retake              # the session, recordings, notes and code snapshots
claude mcp remove retake    # if you added the MCP server`}</Code>
      <p>
        Remove <C>retake()</C> from <C>vite.config</C> or Retake&apos;s <C>proxy.ts</C> / <C>middleware.ts</C> if you added it, the <C>retake</C> entry from <C>.mcp.json</C> if the skill
        added one, and the server from any other MCP client&apos;s settings. With separate code on, stop Retake first so the newest code is back on disk.
      </p>
    </DocArticle>
  )
}
