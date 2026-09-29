# Wayback Machine

A time machine for prototypes. A timeline docks at the bottom of your Vite app.
Drag it back and the app is at that moment. Do something new from there and the
timeline branches; the old future stays as a lane you can click back into.

```sh
wayback dev <project>                    # run the project's dev server with the timeline
wayback dev <project> --port 4000
wayback dev <project> --markers moments.json
wayback dev <project> --code-branches    # code changes branch the timeline too
wayback init                             # print the 2-line vite.config option instead
```

Until it's published: `node bin/wayback.js dev <project>` (or `npm link` here once).

- **Switch** turns the timeline on. Off, the prototype runs normally.
- **Play / pause** freezes timers, animations and streaming. `⌥P`
- **Scrubber**: forward follows the pointer; back rebuilds the moment on release.
- **Branches**: acting after going back starts a new lane. Click a lane to go there.
- **Loop**: the loop button replays the last 3 seconds on repeat; shift-drag the
  scrubber for any range. Handy while tuning an animation.
- **Notes**: press the comment button, click any element in the prototype, write
  what should change. Each note keeps its moment and branch, sits as a pin on the
  timeline, and copies as a prompt (element, selector, React component, size) you
  can paste straight into a coding agent.
- **Code branches** (`--code-branches`): when the source changes, the timeline
  forks at the current moment; the old branch keeps the old code. Stepping into a
  branch checks its code back out on disk, so use it on prototypes, not on repos
  others are editing.
- **Markers**: `⌥M`, or rules in `markers/<project>.json` (fire when text appears
  or a selector matches). Opt out for one load with `?wayback=0`.

## How going back works

It doesn't snapshot or edit the DOM. While you use the app it notes every input:
clicks and keys, server responses, the passage of time (timers, rAF, `Date`,
animations all run on a virtual clock) and randomness (seeded). Going back reloads
the app and replays those inputs at full speed up to the chosen moment, with the
app's own code rebuilding the screen. Server calls are answered from the saved copy.

It rewinds everything in the browser and nothing on a server, so it suits
prototypes whose backends don't remember state. Dev only; nothing ships in builds.

## Layout

- `bin/wayback.js`: CLI. `dev` writes a wrapper config under `.cache/` that loads
  the project's own `vite.config` and adds the plugin.
- `src/plugin.js`: Vite plugin. Pages get the dock shell; the app frame gets the runtime.
- `src/runtime/`: virtual clock, animations, media, history, input replay, engine, markers.
- `src/shell/`: the docked timeline UI (dock, loop, notes, code branches).
- `src/code-versions.js`: source snapshots and checkout for code branches.
- `site/`: landing page.
- `test/`: Playwright checks (`node test/branches.mjs` with a dev server on :3014).
