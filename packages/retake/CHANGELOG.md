# Changelog

## 0.5.1

- Notes on animations work the way web animation does: per element, on the
  animation's own clock. ⌘-click an element and it gets a row on the track with
  its own animations; open one to see its clock (0 after the delay), its
  keyframes and what it moves, and the path it takes on the app. Click to pin a
  note at a point ("at 100ms (20%) of fadeUp"), drag to pin it over a range
  ("200–400ms"), or Shift+drag the timeline first. Numbers typed in the note are
  read on that clock. Copy for agent and `get_note` now give the animation's
  keyframes and timing, the exact point or range with its keyframe segment, the
  values and the box there, and how to change only that part.
- Each animation note now carries an exact edit: the keyframes again, on plain
  time, with the note's point or range edges as keyframes of their own and the
  exact part of each curve on both sides (written for CSS `@keyframes`,
  `element.animate()` or Motion's `times`/`ease`). Change the marked part and the
  rest of the motion stays as it was, even when the easing is on the whole
  effect. A `@keyframes` that runs on several elements says so, and the edit
  gives the noted element its own copy.
- Motion keyframes (`x: [0, 120, 120, 240]` with `times`) are read off the
  motion element's props: every keyframe, its times and the ease of each
  segment, so a range over a hold is on one clip and the exact edit is in
  Motion's own terms. A CSS transition's exact edit is its timing as `linear()`
  stops with the range edges marked. Two animations over the same time on one
  element (a transform and an opacity transition) stack on its row, so either
  can be opened.
- Script-driven motion is recorded: GSAP tweens, Motion's `x`/`y`/`scale` and
  react-spring write inline styles every frame, and now show as clips (kind
  `js`) with their first and last values. Motion and GSAP are named, with
  Motion's `animate`/`transition` props in the note; `element.animate()` clips
  say where they were called. A note after an animation ended is about its end
  state. CSS animations from `<link>` stylesheets (Next, any framework) get
  their `@keyframes` file and line, and source paths are relative to the project.
- ⌘-click picks what you can see under the pointer: text, media, a control or a
  painted box come first; empty overlays (glows, stretched links, scrims) and
  invisible layers (opacity 0, a closed menu sheet) are a wheel step away, shown
  dimmed with why. The highlight and the note always agree (⌘ pressed with the
  pointer already still, or a build swapping in while ⌘ is held). An svg icon is
  the `<svg>` or its button, not the section around it; shadow DOM and embedded
  iframes are pickable (an embed gets no clicks while paused). A note's clip is
  only ever its own element's (or an ancestor's that moves it). Selectors leave
  out generated ids and classes that came and went during the recording, so they
  find the element on a fresh load. A server component's element gets its own
  source line (`GET /__retake/map`), or "unknown", never its client parent's.
  Next's layout components are left out of component names. A second ⌘-click on
  a pinned spot makes a new note there.
- `retake mcp`: `get_animation` maps recording times onto an animation's own
  clock (and into CSS %, Motion `times`, GSAP seconds); `get_moment` on a note
  takes the note's word for which animations are its element's, so it can't
  disagree with `get_note`; `list_notes` shows each note's range and animation.
  The server's instructions carry a short guide to editing each kind of animation.
- Next.js: the timeline on your usual dev URL. Add `proxy.ts` with
  `export { default } from "retake-dev/next"` (Next 16), or `middleware.ts` with the
  Node.js runtime (Next 15), and run `next dev` as always: no second port. Already
  have one? `export default withRetake(yourMiddleware)`. Sessions, notes and
  `retake mcp` work as with the CLI. Dev only: `next build` output has no dock or
  runtime. `npx retake-dev .` still works without installing anything.
- Large recordings upload gzipped (a Next.js middleware reads 10 MB of a request at most).
- The dock is open on a first visit, and folds away: drag its divider down (or
  press ⌥T) and the timeline becomes a round button, bottom-right at first. The
  dock follows the pointer all the way down; let go near the bottom and it eases
  into the button, let go higher and it springs back to its minimum height. The
  app gets the whole window and recording carries on. The button (Enter/Space
  too) brings the dock back at its default height. Remembered across reloads.
- Drag the button anywhere (mouse or finger): it eases to the nearer side edge,
  stays on screen through a resize, and keeps its spot across reloads. A press
  that barely moves is still a click.
- A new mark on the button (a playhead on a track with an arc back to it), with
  a dot for the phase: green live, blue playing, amber paused. `markSvg()`
  (exported from `retake-dev`) returns it as an SVG string.
- Timelines are named "Timeline 1", "Timeline 2"... (they were "Main", "Take 2"...).
  Sessions saved with the old default names show the new ones (in the dock and
  through `retake mcp`); names you gave them stay. A new timeline says so:
  "Timeline 2 started".
- Note pins show on the app only while paused; live or playing, only the count shows.
- Phones and touch screens: the dock's top row fits at 360px (Start fresh shrinks
  to its icon), its controls are 40px, and the divider takes a finger drag (to
  resize or fold). Before, a touch drag on it left the app ignoring taps.
- ⌥T typed in a note or a timeline's name no longer folds the dock.
- The app can leave room for the dock: in its frame, `window.__retakeDockHeight`
  is the height the dock covers (0 when folded), and a `retake:dock` event says
  when it changes.
- `shellHtml({ server: false })` for a dock with no Retake server behind it: it
  never requests `/__retake/` (no session 404 in the console).
- Leaving the page while recording (a new address typed in) no longer loses the
  seconds since the last save: they're kept in the tab's sessionStorage and the
  timeline carries on from them.
- `retake mcp` reads the recording: `get_moment` (around a note's moment, or any
  moment of a timeline) and `get_timeline_events` (a stretch of a timeline) list
  the user's actions, requests, route changes, the animations on or near an
  element with their start, end and what they animate between, and when the
  screen changed most. `get_note` gives the animation's start and end too, and
  points to `get_moment`.
- A note's source in a bundled app (Next.js on Turbopack or webpack) is the
  app's file and line: the dock reads the chunk's source map, index maps
  included, and skips frames that land in the bundled JSX runtime. With no map
  it says the source isn't known (`retake mcp` tries the map again) instead of
  naming the chunk.
- "Copy for agent" starts with two lines saying what a Retake note is and how to
  see what happened around its moment.
- Recorded animations keep their first and last keyframe values (`from`/`to`),
  delay and per-iteration duration.
- A second skill, `retake-notes`: how a coding agent works through notes.

## 0.5.0

The dock folds into an icon you can drag anywhere, notes show only when paused, and timelines are named Timeline 1, Timeline 2. Everything above builds on it.

## 0.4.0

First release.

- A timeline docked over your dev server's app, recording from page load: inputs,
  a virtual clock (timers, rAF, `Date`, CSS and Web Animations), seeded randomness,
  and server traffic (`fetch`, XHR, `EventSource`, `WebSocket`).
- Drag back and the app is at that moment: a live preview at once, the real
  moment rebuilt behind it and swapped in.
- Ctrl-click (or +) to start a new take from any moment; the old one stays a lane.
- Notes on elements at a moment, with component, source file:line and CSS;
  "Copy for agent", and an MCP server (`retake mcp`) for coding agents.
- Vite plugin (`retake()`), and a front server for Next.js, React Router, Remix,
  Astro, SvelteKit, Nuxt or any dev server that serves HTML (`retake .`,
  `retake -- <cmd>`, `retake http://…`).
- `--code-branches`: each timeline keeps its own version of the code (Vite apps).
