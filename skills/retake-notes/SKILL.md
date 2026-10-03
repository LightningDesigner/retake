---
name: retake-notes
description: Act on Retake notes, the change requests a user pins to elements and moments of their running app in the Retake timeline. Use when asked to handle, fix or check Retake notes, when a pasted prompt starts with "Retake note", or when the retake MCP tools are available and the user mentions notes or feedback on the app.
---

# Act on Retake notes

A Retake note is a request pinned to an element **and a moment** of a recording of the running app. The moment is part of the request: the user means what was on screen at that time, and the recording knows what happened before and after it.

## Read the note

- With the `retake` MCP server: `list_notes` (open notes, with each note's range and animation), then `get_note` for one. It gives the request, the element (selector, React component, source file:line, classes, box), the animation it is about and the exact point or range on its clock, the moment, the timeline, and the conversation so far.
- From a pasted prompt ("Copy for agent"): the same fields as text. "Moment" is the time into the recording (00:10.91, as the dock shows it).
- If the MCP server isn't registered and you need more than the prompt gives, suggest `npx -y retake-dev mcp` as an MCP server (it needs the app running with Retake).

## Check the recording before asking

Requests about timing ("show this here, then hide it", "start sooner", "too slow", "it jumps") are answered by the recording more often than by the user.

- `get_moment` with the note's id: the user's actions, route changes and requests around the moment, the animations on or near the element (start, end, duration, what they animate between, how far along at the moment) and when the screen changed most.
- `get_timeline_events` with `from`/`to` (and a `selector`) for a longer or different stretch of the same timeline.
- Read the request against that: "appear at this time" means the moment of the note; "then disappear" usually means the next action or the end of the animation the recording shows. Ask the user only what the recording can't tell you, and say what you found when you do (use `reply`).
- No MCP: ask the user to replay the moment in the Retake dock, or to describe what happens before and after it.

## Notes on animations

A note on an animated element is pinned to a point or a range **on that animation's own clock**, not to the whole animation. Read its `Animation:` block:

- `local` times are ms after the animation's delay (0 = the end of the delay). `progress` = local / duration; `eased` = progress after the effect's easing. Keyframe offsets apply to the eased progress.
- `At:` (a point) or `Range:` (two edges) gives local time, progress, the keyframe segment it falls in (`segment 0 → 0.4 (ease-out)`), the computed values and the element's box there, and the values one frame either side. A range also lists the keyframes inside it and samples between the edges.
- `Scope:` says what to change and what to keep. Change only that part: keep the values at every other point and the total duration unless the note asks otherwise. Numbers the user typed are read as local time of that animation (the note says so in `Read "…" as …`).
- `How (…)` says how for its kind. In short:
  - CSS `@keyframes`: add stops at the edges as % (local / duration) with the edge values given, then change only what is between them. `animation-timing-function` in a keyframe applies to the segment after it. A hold = two stops with the same value. Recompute every % if the duration changes.
  - CSS transition: one segment; use `linear(…)` stops or a `cubic-bezier`, or replace it with a keyframes animation started by the same trigger.
  - `element.animate()`: add `{ offset, ...values, easing }` at the edges. With an effect-level easing, move it onto the keyframes first (offsets apply after it).
  - Motion: insert entries into the value arrays, `times` (local / duration) and the `ease` array (one ease per segment; a single ease applies to each segment). To move another value (y, scale) over only that part, give it its own array and times in a per-value transition, holding its value outside the range. A spring has no ms range: convert it to keyframes, or tune it.
  - GSAP: split the tween into two `.to()` calls at the edge values, or retime with the position parameter.
  - Script-driven, canvas/WebGL: edit the per-frame code at the given location, gated on the same elapsed time.
  - Scroll-driven: the axis is scroll progress; edit the keyframe % or `animation-range`.
- Most animation notes end with an `Exact edit`: the same motion rewritten with the note's point or range edges as keyframes (or `linear()` stops, for a transition) of their own, each piece keeping its part of the curve. Put it in place of the original (it moves exactly as before), then change only the marked part.
- `get_animation` with the note id (or a clip id and recording times) maps any moment onto the animation's clock and gives CSS %, Motion `times` and GSAP seconds.
- `Nothing animates on this element` means the element itself doesn't move then; `Also inside the element` lists children that do. Don't change those unless the note asks.
- After the edit, check the values at the range edges and one frame either side against the note's.

## Find the code

- `Source: file:line` is where the element was written (already mapped back from the served bundle). Start there.
- "Source: not known" (only a compiled bundle line was available): search for the component name, then for the element's id, classes or text from the selector.
- `CSS:` lines point at the rule and `@keyframes` behind an animation; animation names in `get_moment` (`fade-in`, `opacity transition`) are the keyframes or the transitioned property to look for.
- A selector like `body > main > h1:nth-of-type(2)` is a DOM path: match it to the JSX by structure, not by searching for the literal string.

## Work it

1. `acknowledge` the note when you start (optionally with a one-line plan).
2. Make the change in the source. Keep it to what the note asks.
3. `resolve` with a one or two sentence summary of what changed (it shows on the note in the dock). If you can't do it, `reply` with why, and leave it open.
4. `watch_notes` waits for the next note or reply if the user is working through several.

## Never

- Commit `.retake/` (local recordings and notes) or push it. It belongs in `.gitignore`.
- Edit files under `.retake/` by hand; use the MCP tools.
