# Changelog

## 0.5.0

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
