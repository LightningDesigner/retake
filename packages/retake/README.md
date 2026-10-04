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

### Next.js: on your usual dev URL
Install `retake-dev` (above) and add one small file. Then run `next dev` /
`npm run dev` as always: the timeline shows on your normal dev URL
(http://localhost:3000), no second port.

Where the file goes: next to your `app/` folder. That's the project root, or
`src/` if your app lives in `src/app` (`src/proxy.ts` / `src/middleware.ts`).
Next 16 and Next 15 need different files: check `next` in your package.json.

```ts
// proxy.ts (Next 16)
export { default } from "retake-dev/next"
```

```ts
// middleware.ts (Next 15.5)
import retake from "retake-dev/next"
export default retake
export const config = { runtime: "nodejs" }
```

Install it from the registry (or a tarball, `npm i ../retake-dev-0.5.2.tgz`): a
`file:` or linked install is a symlink, which Turbopack doesn't follow out of the
project, and `retake-dev/next` isn't found.

On Next 15 don't copy the Next 16 line into `middleware.ts`: it needs all three
lines above, including the Node.js runtime (Retake keeps `.retake/` on disk).

Open the page in a browser to see the timeline. It's added only for real page
loads, so `curl` shows the plain page, and the first request or two right after
`next dev` starts may arrive before Retake has loaded ("Retake timeline docked"
prints when it has).

Next 15 needs the Node.js runtime. It only runs in
`next dev`: in `next build` / `next start` every request goes straight on, and the
build has no dock or runtime in it.

Already have a proxy or middleware? Wrap yours:

```ts
import { withRetake } from "retake-dev/next"

export default withRetake(async (req) => {
  // ...your middleware, as before
})
```

Next reads `config` from your file as written (it can't be re-exported). Without one
the proxy runs for every request and passes everything but page loads on. With a
`matcher` of your own, add Retake's two entries to it:

```ts
export const config = {
  matcher: [
    "/__retake/:path*",
    { source: "/((?!_next/static|_next/image).*)", has: [{ type: "header", key: "sec-fetch-mode", value: "navigate" }] },
    // ...your entries
  ],
}
```

`withRetake` hands every request it doesn't answer to your function, so with a
merged matcher your function also sees page loads it didn't match before.
No install at all: `npx retake-dev .` runs `next dev` behind Retake's own port
(3014) instead.

### Connect your coding agent (MCP)
Notes you leave in the dock can go straight to your coding agent. Register the
MCP server once, from the app folder. With Claude Code:

```sh
claude mcp add retake -- npx -y retake-dev mcp
```

Any other MCP client (Cursor, Codex, Windsurf...) takes the same command,
`npx -y retake-dev mcp`, in its MCP settings.

With the dev server running, the agent can `list_notes`, `get_note`,
`get_moment`, `get_animation`, `get_timeline_events`, `get_active_timeline`,
`acknowledge`, `resolve`, `reply`, `checkout_timeline`, `get_code_diff` and `watch_notes`.
It finds the server through `.retake/server.json` (or pass `--url http://localhost:3014`).
Acknowledging and resolving show up on the note in the dock right away.

A note is pinned to a moment of a recording. `get_moment` (a note id, or a
timeline and a time like `00:10.91`) reads that recording around it: the user's
clicks, keys, typing and route changes, the requests, the animations on or near
the element (start, end, duration, what they animate between, how far along at
the moment) and when the screen changed most. `get_timeline_events` lists the
same for any stretch of a timeline. A note whose source is only a line of a
compiled bundle (a Next.js chunk) is mapped back to the app's file and line
through the bundle's source map.

A note on an animation says exactly which part of it you mean (see
[Notes on animations](#notes-on-animations)). `get_animation` gives that
animation's timing and every keyframe, and maps any recording time onto its own
clock, in CSS %, Motion `times` and GSAP seconds. `get_note`, `get_moment` and
Copy for agent describe the element and its animation with the same words.

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

### Picking an element
Hold ⌘ over the paused app: a list by the pointer shows everything stacked
there, also what takes no pointer events (a drawn underline under an image, an
icon). A dot marks what's animating. The pick is what you can see there (text,
an image or icon, a control, a painted box), and one that moves wins: a word
popping in, a stroke under an overlay. Empty overlays and invisible layers stay
in the list, dimmed. Pick another with the wheel or Tab, or move onto the list
and click a row. On an icon you get the `<svg>` (or the button it's the icon
of), unless the shape inside it is the one animating; inside an open shadow root, the element itself;
an embedded iframe is one element (and gets no clicks while paused). A second
⌘-click on a pinned spot makes another note there.

The note's selector finds the element again on a fresh load: no generated ids
(`:r1:`, `radix-…`), no classes that came and went during the recording (`in`,
`is-open`, `opacity-100`), test ids, labels and hrefs where they're unique. Its
source is where the element itself was written, a server component's line too
(the dev server reads the chunk's source map), never just the parent it was
passed into, or the line where you used a library's component (Motion's
`<motion.span>`, also from a Turbopack chunk); Next's own layout components
aren't listed as yours.

### Notes on animations
Web animations aren't edited on a global timeline: each one belongs to an
element, runs on its own clock (0 is the end of its delay), and moves the
element between keyframes. Notes work the same way.

- **⌘-click an element** and it gets a row on the track under the timelines, with
  its own animations (and an ancestor's that moves it). Nothing moving on it?
  The row says so and lists what animates inside it; click one to switch. Two
  animations at once (a transform and an opacity transition) stack in thinner
  rows; hover one to see its name.
- **Click an animation** on that row to open it: a ruler on its own clock (the
  delay hatched before 0), a diamond where each keyframe is reached, and small
  lines of what it moves (x, y, scale, rotation, opacity, size). The hint reads
  where the playhead is on it: `fadeUp · 100ms of 500 · 20% · seg 0→40% ease-out ·
  x 248 y 568 · 320×64`. On the app, dashed boxes show where the element starts and
  ends, and a dotted line the path it takes.
- **A point**: click on the open animation (or step with ←/→ a frame at a time,
  ⌥←/→ keyframe to keyframe). The note is pinned there: "at 100ms (20%) of
  fadeUp on `<h1.title>`".
- **A range**: drag across the open animation ("200–400ms · 40–80% of fadeUp").
  It snaps to keyframes and 10ms steps (hold ⌥ to drag freely); drag past the
  end for "from here to the end". Or from the point, Shift+←/→: 10ms a press,
  stopping on keyframes (⌥ jumps to the next one); the hint reads the range.
  Shift+drag on the timeline selects a range of
  the recording first, then ⌘-click any element.
- **Typed numbers** ("at 100ms", "between 200 and 400 ms", "after 40%") are read
  on the open animation's own clock; a chip under the note says how, and a click
  switches it to recording time.
- **Whole group**: ⌘-click a container whose children each animate (an
  equalizer's bars) and its row offers **Whole group · N**. Click it: a lane per
  child, then click a moment or drag a range. One note covers every child, each
  on its own clock, with its own exact edit; children that share one
  `@keyframes` (or the same keyframes) say so, for a single edit.
- Esc closes the open animation (or the group), then the note.

The note carries, for that animation: its kind and where it's defined, timing,
every keyframe, the point or both range edges on its own clock (local ms,
progress, eased progress, the keyframe segment), the values and the element's
box there and one frame either side, samples across a range, and what to change
for its kind (CSS keyframes, transitions, `element.animate()`, Motion, GSAP,
scroll-driven). It ends with an exact edit: the keyframes again on plain time,
the point or range edges as keyframes of their own, each piece keeping its part
of the curve, so an agent changes only the marked part and the rest moves as
before. A `@keyframes` shared with other elements is flagged, and the edit gives
the noted element its own copy. Motion written as inline styles every frame
(GSAP, Motion's `x`, react-spring) is recorded too, with its first and last
values and the library named; Motion keyframes come with every keyframe, their
`times` and each segment's ease, read off the component's props. A CSS
transition's exact edit is its timing as `linear()` stops.

The exact edit is for "change it only here" requests. For timing, duration or
shape ("faster", "start earlier", "hold longer"), the note adds an `Intent:`
line with what to change instead. The note is about the animation that moves:
instant ones (0ms, or between equal values) fold into one line with their
count, and an animation started again (on scroll) is one entry with its runs.

### The dock
- **Keys**: space or ⌥P plays and pauses, ←/→ step (on an open animation: its
  frames; ⌥: its keyframes; Shift: a range from the point), F fits everything, + starts a new timeline at
  the playhead, M drops a bookmark, ⌥T folds the dock away, Esc closes an open
  animation, a selected range, then the note.
- **Resize** by dragging the divider at its top. Drag it all the way down and
  the timeline folds into a round button (bottom-right at first): the whole
  window is the app's, and recording carries on. Drag the button anywhere; it
  keeps to the nearer side edge. Click it (or ⌥T) to bring the dock back.
  Folded or not, and where the button sits, are remembered across reloads.
- **Notes show when paused.** While the app is live or playing, note pins stay
  off it (the count on the notes icon stays). Pause and the notes come back.

### Timelines keep their own code
Make Timeline 2 from a moment of Timeline 1, leave a note on an animation there,
and hand it to your agent: the change lands in Timeline 2, and Timeline 1 still
shows the old animation.

```
Timeline 1  ──rec────────●──────────►   code A
                         │ Control-click
Timeline 2               └──rec──[note]──►   code A → B (the agent's edit)

step into Timeline 1 → files become A → its moments rebuild on A (old animation)
step into Timeline 2 → files become B → its moments rebuild on B (new animation)
Retake stops         → the newest code (B) stays on disk; A is kept in .retake/
```

- Every edit (yours or your agent's) belongs to the timeline you're in. Each
  version of the code is a snapshot in `.retake/`.
- With **separate code** on, stepping into a timeline puts its code on disk
  first. A lane whose code changed gets a `±` (hover: the files), and the top row
  says whose code is on disk. When Retake stops, the newest code goes back on
  disk (also after a crash, at the next start).
- Off by default until it matters: the first time the code changes while you
  have two timelines, the dock asks **Separate code** or **Share code**. The
  answer is kept for the project; change it from a lane's right-click menu,
  `--code-timelines` / `--no-code-timelines`, `retake({ codeTimelines })` or
  `RETAKE_CODE_TIMELINES=1` for Next's `proxy.ts`.
- Agents: `acknowledge` on a note puts its timeline's code on disk and moves the
  dock there, so the edit lands in the right timeline. While the agent works,
  switching to another timeline asks first. `get_note` says whose code is on
  disk; `checkout_timeline` and `get_code_diff` work with any timeline.
- Git: HEAD, the index and refs are never touched; a checkout waits while git is
  busy, and a branch switch pauses swapping until you resume. Ignored files and
  `.retake/ignore` paths are never swapped. `retake code export 2` makes a git
  branch of Timeline 2's code without touching your working tree.
- Your editor reloads files that change under it; an unsaved buffer gets a
  conflict. Dependencies aren't swapped (`node_modules`): when `package.json`
  differs, the dock says to run install.

### Uninstall
```sh
npm uninstall retake-dev          # or pnpm remove / yarn remove / bun remove
rm -rf .retake                    # Retake's session and recordings
claude mcp remove retake          # if you added the MCP server (or remove it in your client's MCP settings)
```
Remove `retake()` from `vite.config`, or Retake's `proxy.ts` / `middleware.ts` (or `withRetake`), if you added it.

## Commands
```sh
retake <project>                     # run the project's dev server with the timeline
retake <project> --port 4000
retake <project> --code-timelines    # each timeline keeps its own code (stepping into one rewrites your files)
retake <project> -- --host           # anything after -- goes to the dev server
retake -- <dev command>              # run that command with the timeline in front (retake -- next dev)
retake http://localhost:3000         # put the timeline in front of a dev server that's already running
retake init                          # print the vite.config / proxy.ts lines
retake mcp                           # the MCP server your coding agent runs
retake code status                   # each timeline's code; also list, checkout <timeline>,
                                     #   restore [version], export <timeline> [--branch <name>]
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
| Next.js | `proxy.ts` / `middleware.ts` ([above](#nextjs-on-your-usual-dev-url)) and your usual `next dev`, or `npx retake-dev .` | tested on 16.3 (app and pages router, server actions) and 15.5 (app router), Turbopack and webpack |
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
  (Vite's lazy routes, Astro islands) can't be held to its moment. With Next's
  `proxy.ts` the same holds, except that a rebuilt moment's page is rendered again
  (what the server renders differently each time, like the time, can differ).
- **The dock covers the bottom of the app.** It floats over the bottom of
  the app (a cookie banner's buttons, Next's dev badge). Drag the dock's divider
  down (all the way down folds it into a button in the corner, as does ⌥T), or
  open the app with `?retake=0`.
- **Not rewound.** Retake rewinds the browser, not your server: database writes,
  server sessions and server-action side effects stay as they are (replays answer
  from the recording). Service workers are off while Retake is in front.
  Code timelines version the project folder only (not a package elsewhere in a
  monorepo), and `retake http://…` needs `--root` for them.

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
