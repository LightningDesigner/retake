# Retake

A time machine for Vite prototypes. A timeline docks over the bottom of your
app and records everything from page load. Drag it back and the app is at that
moment. Ctrl-click the timeline to start a new take from there; the old one
stays as a lane you can click back into. Dev only: nothing ships in builds.

## Getting started

### Requirements
- Node 18 or newer
- A Vite 5+ app served from an `index.html` (React, Vue, Svelte, plain JS).
  SSR/framework setups (Next, Remix, React Router framework mode, Astro) aren't supported yet.
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
touched: it runs your own `vite.config` through a wrapper kept in your temp folder.
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

### Connect Claude Code (MCP)
Notes you leave in the dock can go straight to Claude Code. Once, from the app folder:

```sh
claude mcp add retake -- npx -y retake-dev mcp
```

With the dev server running, Claude can `list_notes`, `get_note`,
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
   write what should change, press Enter. "Copy for Claude" copies a prompt with
   the element, its React component, source file:line and CSS; or let Claude
   pick it up over MCP.

### Uninstall
```sh
npm uninstall retake-dev          # or pnpm remove / yarn remove / bun remove
rm -rf .retake                    # Retake's session and recordings
claude mcp remove retake          # if you added the MCP server
```
Remove `retake()` from `vite.config` if you added it.

## Commands
```sh
retake <project>                     # run the project's dev server with the timeline
retake <project> --port 4000
retake <project> --code-branches     # each timeline keeps its own version of the code (rewrites files!)
retake <project> -- --host           # anything after -- goes to vite
retake init                          # print the vite.config lines
retake mcp                           # the MCP server (what `claude mcp add` runs)
```
Opt out for one page load with `?retake=0`.

**Code per timeline** (`--code-branches`): when the source changes, the timeline
you're on takes the new code; the others keep theirs. Stepping into a timeline
checks its code out on disk (snapshots are kept in `.retake/`, and the newest
code is put back when the server stops), but use it on prototypes, not shared repos.

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

Requires Node 18+ and Vite 5 or newer.
