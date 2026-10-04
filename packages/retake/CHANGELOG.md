# Changelog

## 0.5.5

- Motion springs are described as springs. A note on an element moved by a
  spring (`type: "spring"` with stiffness / damping / mass, visualDuration or
  duration + bounce, or Motion's default spring for x, y, scale and rotate)
  carries the spring as written, where it starts and ends, and the curve Motion
  ran: how far it overshoots and when, how many times it swings, when it
  settles, and the value at the note's moment. "Less bouncy", "slower" and
  "faster" come with exact numbers (the damping or bounce that takes most of
  the overshoot away, the stiffness or visualDuration for the new speed), and
  a range on a spring is mapped onto its curve, with the spring converted to
  keyframes for changing only that part. `get_animation` explains it the same way.
- Picking again while writing a note (a second click on the page) kept the
  note open but emptied it. What was typed now stays.

## 0.5.4

- Enter on a picked element whose animation was still in its delay opened it
  there, so ←/→ seemed to do nothing and Shift+←/→ gave a range in negative
  milliseconds. It now opens at the animation's start, as clicking its capsule
  does, and the arrows step its own clock.
- A note being written keeps the keyboard focus when going to another moment
  replays a click in the app.
- A click on a row of the ⌘ layer list picks that layer even when the pointer
  jumps straight onto it, and the click never reaches the page under the list.

## 0.5.3

- Ranges without a mouse: after a ⌘-click, Enter or ↓ opens the element's
  animation on its own clock (in the note while it's still empty, or with the
  focus out of it), ↑/↓ go through its other animations, and the hint names the
  one open ("Open: fadeUp · 600ms (1 of 2)"). Then ←/→ steps it and Shift+←/→
  grows a range, as before. Esc closes it.
- G (⌥G while in the note) turns **Whole group** on or off on a picked
  container, and the hint says so.
- The element row's animations and the Whole group chip are buttons over the
  canvas: named for screen readers ("Open fadeUp, 600ms", "Whole group, 5
  animations"), reachable with Tab and pressed with Enter, and found by role in
  automation. Pointer clicks work as before.
- Picking: a thin animated stroke inside the element under the pointer (an
  underline's `<path>` drawn with `stroke-dashoffset`, fill none, its svg out of
  hit testing and below the word) is in the ⌘ list, marked with its animation.
  A few pixels off the stroke it's the pick; over the middle of the word the
  word stays the pick.
- Notes say what started each animation: ":hover on a.card", a press
  (`:active`), a click, a focus, a key, with the moment. One hover that started
  several effects on the element and its `::before`/`::after` (border color,
  shadow, glow) is one "Hover state" entry listing each effect, so "feels off
  here" is about the whole hover, not one property.
- With nothing running at the note's moment (a press is over before a pause can
  keep it), the note lists what ran last on the element and inside it, newest
  first, with what started each: "pressed at 00:14.02 → transform transition
  150ms". A moment inside the press gets the press's transition.
- Media: a note on motion that is a `<video>` (a background clip) describes it:
  source, current time and duration at the moment, loop, playbackRate, and how
  to make it calmer or faster.
- While the app is live its keys are its own (space types into a field the app
  focused). ⌥P always plays and pauses, also with the focus in an app field;
  the play button works with the app's field focused too.

## 0.5.2

- Group notes: a container whose children each run their own animation (an
  equalizer's bars) offers **Whole group** on its row. One note then covers
  every child: each one's animation, where it is defined, its point or range on
  its own clock and its own exact edit. Children that share one `@keyframes`
  (or the same keyframes) get a one-edit shortcut. `get_note`, `get_moment`,
  `get_animation` and `list_notes` show the group.
- A note is about the animation that moves. Instant animations (0ms, or between
  equal values, like a library setting a value) are never its subject; they
  fold into one "Also running" line with their count. The same animation
  started again (on scroll) is one entry with its run times, not one per run.
  A loop that ends where it starts (most equalizers and pulses) is motion, not
  an instant animation.
- The exact edit says what it is for: changing only the note's point or range.
  For broad requests ("faster", "slower", "start earlier", "hold longer") the
  note adds an `Intent:` line with what to change instead. Loops get an exact
  edit too (it applies to every iteration), also for a range across the end of
  an iteration. A range's exact edit says to keep the marked stops as they are
  (they hold today's values at the edges), so the motion outside the range
  stays put; a range across the end of an iteration lists the keyframes it
  passes there.
- Picking: the list under ⌘ shows everything stacked at the pointer, also what
  takes no pointer events (a drawn underline under an overlay image, the stroke
  under an inline word), and marks what's animating. The pick prefers what
  moves: the stroke, not the image over it or the quote around it; a word that
  pops in later, not its paragraph. Move onto the list and click any row (a
  quick click too, also when the note opens right under it).
- On an open animation, Shift+←/→ grows a range from the point (10ms a press,
  stopping on keyframes; ⌥ to the next keyframe) and the hint reads it; ⌥+←/→
  moves the point keyframe to keyframe (was Shift).
- Source lines on Next 15 with Turbopack: an element a library rendered (Motion,
  bundled into the app's chunk) gets the line where the app used it, not
  "maps into library code", also when the library has a chunk of its own.
- Timelines keep their own code, in every mode (Vite, frameworks behind
  `retake <project>` / `retake -- <cmd>`, Next's `proxy.ts` / `middleware.ts`).
  Every edit, yours or your agent's, belongs to the timeline you're in; with
  separate code on, stepping into a timeline puts its code on disk first, so
  Timeline 1 still rebuilds the old animation after the agent changed it in
  Timeline 2. The newest code goes back on disk when Retake stops (and after a
  crash, at the next start). The first code change with two timelines asks
  **Separate code** or **Share code** (kept per project; also a lane's
  right-click menu, `--code-timelines` / `--no-code-timelines`,
  `retake({ codeTimelines })`, `RETAKE_CODE_TIMELINES` for Next's proxy).
  `--code-branches` still works and turns it on.
- The server owns which code each timeline has (`.retake/code-timelines.json`;
  `GET /__retake/code`, `POST /__retake/code/checkout`, `GET /__retake/code/diff`).
  A lane whose code changed shows `±` (hover: the files); the top row says whose
  code is on disk; a switch says which files changed.
- Agents: `acknowledge` puts the note's timeline's code on disk and moves the
  dock there, and holds it while the agent works (switching away asks first).
  `get_note` says whose code is on disk; `resolve` says when an edit landed on
  another timeline. New tools: `checkout_timeline`, `get_code_diff`. Notes
  carry `codeVersion` and `resolvedVersion`.
- Safe with git: HEAD, the index and refs are never touched; a checkout waits
  while git is busy; a branch switch pauses swapping until you resume. Framework
  output (`next-env.d.ts`, `.svelte-kit`, `.nuxt`, `*.gen.ts`...) and
  `.retake/ignore` paths are never swapped. While files switch, the dev server's
  hot updates are held so a half-written tree never reloads the app.
- `retake code status | list | checkout <timeline> | restore [version] |
  export <timeline>` works from a terminal, with or without a dev server;
  `export` makes a git branch of a timeline's code without touching your working
  tree.
- Front server: a kept page is served again whenever the code it was rendered
  with is back on disk.

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
