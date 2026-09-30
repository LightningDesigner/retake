# Retake

A time machine for Vite prototypes. A timeline docks at the bottom of your app.
Drag it back and the app is at that moment. Hit **+** to start a new take from
there; the old one stays as a lane you can click back into.

```sh
npx retake-dev .                  # npm
pnpm dlx retake-dev .             # pnpm
yarn dlx retake-dev .             # yarn (berry)
bunx retake-dev .                 # bun
```

Or install it in the project and use the short name:

```sh
npm i -D retake-dev     # or: pnpm add -D / yarn add -D / bun add -d
npx retake .
```

```sh
retake <project>                     # run the project's dev server with the timeline
retake <project> --port 4000
retake <project> --code-branches     # each timeline keeps its own version of the code
retake <project> -- --host           # anything after -- goes to vite
retake init                          # print the vite.config lines instead
```

Prefer it in the config? `import { retake } from "retake-dev"` and add
`retake()` to `plugins`. It only runs in `vite dev`; nothing ships in builds.

- **Recording** is on from page load. **Pause** (`⌥P`) freezes timers,
  animations and requests.
- **Scrubbing**: drag the playhead back to see the past; let go and the moment
  is rebuilt for real.
- **Timelines**: while paused or rewound, hover the timeline and click **+** to
  start a new timeline from that moment. Only **+** creates timelines; acting
  in the past doesn't branch on its own. Click a lane to go there;
  right-click to delete it.
- **Notes**: while paused, hold ⌘ (or pick the comment tool), click any
  element and write what should change. Notes keep their moment and timeline,
  show as pins, and copy as a prompt (element, selector, React component, size)
  for a coding agent.
- **Code per timeline** (`--code-branches`): when the source changes, the
  timeline you are on takes the new code; the others keep theirs. Stepping into
  a timeline checks its code out on disk, so use it on prototypes.
- Opt out for one load with `?retake=0`.

## Notes for your coding agent (MCP)

Notes you leave in the dock can go straight to a coding agent. Add Retake's MCP
server once:

```sh
claude mcp add retake -- npx -y retake-dev mcp
```

Run it from the project folder, the same place you ran `retake`: it finds the
running dev server from `.retake/server.json` (or pass `--url
http://localhost:3014`). The agent gets `list_notes`, `get_note`,
`get_active_timeline`, `acknowledge`, `resolve`, `reply` and `watch_notes`.
Acknowledging and resolving show up on the note's pin in the dock right away.

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
