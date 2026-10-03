# Retake

A time machine for your dev server: Vite apps, Next.js, React Router and other
frameworks. A timeline docks over the bottom of your app and records from page load. Drag it back and the app is at that
moment. Ctrl-click the timeline to start a new take from there; the old one
stays as a lane you can click back into. Dev only: nothing ships in builds.

## Getting started

### Requirements
- Node 18 or newer
- A Vite 5+ app served from an `index.html` (React, Vue, Svelte, plain JS), or anything
  else with a dev server that serves HTML (Next.js, React Router, Remix, Nuxt, SvelteKit, Astro...):
  see [Frameworks](#frameworks).
- Chrome, Edge or another Chromium browser (that's what it's tested on)

### Try it without installing
From your app's folder:

```sh
npx retake-dev .          # npm
pnpm dlx retake-dev .     # pnpm
yarn dlx retake-dev .     # yarn (berry)
bunx retake-dev .         # bun
```

Open the URL it prints (default http://localhost:3014). Your files aren't
touched: on a Vite app it runs your own `vite.config` through a wrapper kept in your temp
folder; on a framework it runs your `dev` script and sits in front of it.
Retake keeps its session in a `.retake/` folder in the app (it git-ignores itself).

> Use the full name `retake-dev` with `npx`/`dlx`. The short `retake` command only
> exists after you install `retake-dev` in the project (an unrelated npm package
> is called `retake`).

### Install it in the project
```sh
npm i -D retake-dev       # or: pnpm add -D retake-dev / yarn add -D retake-dev / bun add -d retake-dev
npx retake .              # same as above, now from node_modules
```

Or keep your usual `npm run dev` and add the plugin to `vite.config`:

```js
import { retake } from "retake-dev"

export default defineConfig({
  plugins: [retake(), /* ...your plugins */],
})
```

`retake()` only runs in `vite dev`; `vite build` output has no Retake code in it.

### Connect your coding agent (MCP)
Notes you leave in the dock can go straight to your coding agent. Register the
MCP server once, from the app folder. With Claude Code:

```sh
claude mcp add retake -- npx -y retake-dev mcp
```

Any other MCP client (Cursor, Codex, Windsurf...) takes the same command,
`npx -y retake-dev mcp`, in its MCP settings.

With the dev server running, the agent can `list_notes`, `get_note`,
`get_active_timeline`, `acknowledge`, `resolve`, `reply` and `watch_notes`.
It finds the server through `.retake/server.json` (or pass `--url http://localhost:3014`).
Acknowledging and resolving show up on the note in the dock right away.

### The first 60 seconds
1. **Use your app** for a few seconds: it's being recorded already.
2. **Pause** with space (or ⌥P, or the play button). The app goes view-only:
   you can scroll, not click.
3. **Rewind**: drag the playhead back. Let go and the moment is rebuilt for real.
   ⌘-scroll on the timeline zooms in; ←/→ step frame by frame; F fits everything.
4. **Branch**: Ctrl-click the timeline at a moment to start a new take there.
   It starts paused: press play and do something different. Click the other
   lane to go back to the first take.
5. **Note**: hold ⌘ and click an element (or one of its animation layers),
   write what should change, press Enter. "Copy for agent" copies a prompt with
   the element, its React component, source file:line and CSS; or let your
   agent pick it up over MCP.

### The dock
- **Keys**: space or ⌥P plays and pauses, ←/→ step, F fits everything, + starts
  a new timeline at the playhead, M drops a bookmark, ⌥T folds the dock away.
- **Resize** by dragging the divider at its top. Drag it all the way down and
  the timeline folds into a round button (bottom-right at first): the whole
  window is the app's, and recording carries on. Drag the button anywhere; it
  keeps to the nearer side edge. Click it (or ⌥T) to bring the dock back.
  Folded or not, and where the button sits, are remembered across reloads.
- **Notes show when paused.** While the app is live or playing, note pins stay
  off it (the count on the notes icon stays). Pause and the notes come back.

### Uninstall
```sh
npm uninstall retake-dev          # or pnpm remove / yarn remove / bun remove
rm -rf .retake                    # Retake's session and recordings
claude mcp remove retake          # if you added the MCP server (or remove it in your client's MCP settings)
```
Remove `retake()` from `vite.config` if you added it.

## Commands
```sh
retake <project>                     # run the project's dev server with the timeline
retake <project> --port 4000
retake <project> --code-branches     # each timeline keeps its own version of the code (Vite apps; rewrites files!)
retake <project> -- --host           # anything after -- goes to the dev server
retake -- <dev command>              # run that command with the timeline in front (retake -- next dev)
retake http://localhost:3000         # put the timeline in front of a dev server that's already running
retake init                          # print the vite.config lines
retake mcp                           # the MCP server your coding agent runs
```
`--root <dir>` puts `.retake/` somewhere else; `--verbose` logs every request the
front server handles to `.retake/front.log`. Opt out for one page load with `?retake=0`.

Recordings hold what you typed and what your API answered. Retake's front server
only answers on localhost; with the plugin and `vite --host`, anyone on your
network can read the session.

## Frameworks

Retake needs to put a small script first in the page the dock frames. A Vite
single-page app gets it from the Vite plugin. Anything that renders its own HTML
gets it from Retake's **front server**: Retake listens on its port (3014), serves
the dock there, and passes everything else through to your dev server, adding the
script to the frame's page as it streams. Assets, data fetches, server actions,
API routes and the HMR socket go through untouched. Your config isn't changed.

`retake .` works out which one you have. A project that depends on Next, Nuxt,
React Router (framework mode), Remix, SvelteKit, Astro, TanStack Start, SolidStart,
Vike, Waku or Analog gets the front server, in front of its `dev` script (run with
the package manager its lockfile names):

| Framework | Run | Notes |
|---|---|---|
| Vite SPA (React, Vue, Svelte, plain) | `npx retake-dev .` | or `plugins: [retake()]` in `vite.config` |
| Next.js | `npx retake-dev .` | tested on 16.3 (app and pages router, server actions) and 15.5 (app router), Turbopack |
| React Router 7 framework mode | `npx retake-dev .` | or `plugins: [retake(), reactRouter()]` and your usual `npm run dev`; tested on 7.18 |
| Remix 2 (Vite) | `npx retake-dev .` | tested on 2.17 |
| Astro | `npx retake-dev .` | tested on 7.3 with React islands and `<ClientRouter />` |
| SvelteKit | `npx retake-dev .` | tested on 3.0 (Svelte 5) |
| Nuxt | `npx retake-dev .` | tested on 4.5; runs `nuxt dev` behind Retake (it ignores `PORT`: `npx retake-dev . -- --port 3001` picks its port) |
| TanStack Start, SolidStart, Vike... | `npx retake-dev .` | untested; with Vite you can also add `retake()` to its Vite plugins |
| Anything else that serves HTML | `npx retake-dev -- <your dev command>` | e.g. `npx retake-dev -- npm run dev` |
| A dev server that's already running | `npx retake-dev http://localhost:3000` | `.retake/` goes in the current folder (or `--root`) |

Tested means: the app hydrates in the dock with no warning, and recording, scrubbing back, the rebuilt moment, Play, hot
updates and reloads all work, started either way (`retake .` or `retake http://localhost:…`). The untested ones go
through the same front server and should work; open an issue if one doesn't.

- **Ports.** Retake sets `PORT` to a free port for the dev command (or keeps
  yours), and otherwise uses the first `http://localhost:…` the command prints, so
  tools that ignore `PORT` work too. Ctrl-C stops the dev server with it.
- **The plugin in a Vite-based framework.** With `retake()` in `vite.config` and
  no `index.html` in the Vite root, the plugin docks into the pages your framework
  renders, on your usual dev server port: no second server.
- **Signing in.** Sign-in pages (OAuth) refuse to load inside a frame, so sign in
  at your app's own port first (cookies on `localhost` are shared across ports),
  then open Retake's. A sign-in redirect that comes back from another site gets the
  plain page so it completes; reload to get the dock back.
- **Next 16.** Next 16 sends React debug data for every request over its HMR
  socket (`experimental.reactDebugChannel`). Retake keeps it with the recording and
  hands it back on replay, so nothing needs changing. Other Next versions with a
  debug channel aren't known yet: if replayed navigations or server actions don't
  show, Retake's warning says to set `experimental: { reactDebugChannel: false }`.
- **Exact replays on server-rendered pages.** Behind the front server the clock
  starts once the page has loaded and nothing more is loading (so an app that
  imports itself after load, like Nuxt's, has mounted), scripts and stylesheets added later (lazily
  loaded chunks) run at their recorded moment, the dev server's own traffic (HMR)
  is left out of the recording, and a rebuilt moment gets the page's HTML as it
  was recorded (kept in `.retake/docs/`), not rendered again. Native `import()`
  (Vite's lazy routes, Astro islands) can't be held to its moment.
- **The dock covers the bottom of the app.** It floats over the bottom of
  the app (a cookie banner's buttons, Next's dev badge). Drag the dock's divider
  down (all the way down folds it into a button in the corner, as does ⌥T), or
  open the app with `?retake=0`.
- **Not rewound.** Retake rewinds the browser, not your server: database writes,
  server sessions and server-action side effects stay as they are (replays answer
  from the recording). Service workers are off while Retake is in front, and
  `--code-branches` is Vite-only.

**Code per timeline** (`--code-branches`): when the source changes, the timeline
you're on takes the new code; the others keep theirs. Stepping into a timeline
checks its code out on disk (snapshots are kept in `.retake/`, and the newest
code is put back when the server stops), but use it on prototypes, not shared repos.

## The dock without a Retake server

`shellHtml(options)` (exported from `retake-dev`) returns the dock page, for a
host that serves it itself, such as a deployed demo. With no Retake server
behind it, pass `server: false`: the dock then never requests `/__retake/` (no
session fetch, so no 404 in the console) and keeps timelines and notes in memory
for the page.

```js
import { shellHtml } from "retake-dev"
const html = shellHtml({ marker: "header", server: false })
```

`markSvg()` returns Retake's mark (the folded button's icon) as an SVG string:
a 24×24 viewBox, the arc and the played part in `currentColor`, the rest white,
for a dark background.

## How going back works

It doesn't snapshot the DOM. It records every input (pointer, keys, typing,
scrolling, back/forward), runs time on a virtual clock (timers, rAF, `Date`,
idle callbacks, CSS and Web Animations) and seeds randomness (`Math.random`,
`crypto`). Going back reloads the app and replays those inputs at full speed up
to the chosen moment, with the app's own code rebuilding the screen.

Server traffic is answered from the recording: `fetch` (streamed replies too,
chunk by chunk at the pace they arrived), `XMLHttpRequest`, `EventSource` and
`WebSocket`. So are observer callbacks and worker messages. Web storage,
cookies and IndexedDB go back to how they were when the recording began.

It rewinds the browser, not your server, so it suits prototypes whose backends
don't remember state. Not covered: the Cache API / service workers, and
cross-origin iframes.

Requires Node 18+, and Vite 5 or newer for Vite apps and the plugin.

## License

[PolyForm Shield 1.0.0](LICENSE). Use it, change it and share it for anything,
except building a product that competes with Retake.
