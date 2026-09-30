# Runtime ↔ Dock ↔ Server contract
Owners: S1 = src/runtime, src/plugin.js, src/code-versions.js, src/server, bin. S2 = src/shell. S3 = apps/site.

## Interaction model
- Play/Pause is the ONLY way to start or stop playback/recording (the play button, space, ⌥P → PT.record()/PT.play() and PT.pause()). Nothing else resumes the clock: not clicks, keys, scrolling, Control-click branching, or switching timelines.
- Playing at the live edge: the app is interactive and everything is recorded.
- Paused (anywhere) or in the past: the app is view-only, like a paused video. Clicks, keys and pointer input are blocked and don't move time; the dock's comment/select tools still work.
- Paused, the user CAN scroll the app (wheel, trackpad, scrollbar, keyboard scrolling). That scrolling is view-only: not recorded, not seen by the app, and time doesn't move. The recorded scroll position comes back when playback resumes or on a seek. The dock's shield must let scrolling through.
- Control-click on the track creates a new timeline from the active one at that moment, PAUSED there. Recording into it starts only when the user presses Play.
- Selecting (switching to) a timeline loads it at the current moment, PAUSED. Never auto-play.
- Play from the past replays the recording; at its end it carries on live, recording.
- Recording is on from page load. The dock has "Start fresh", which clears the session.

## Runtime API (window.__wayback in the app frame)
timeline() → { now, end, viewport: {w,h},
  markers:  [{ t, end?, kind: "click"|"submit"|"route"|"focus"|"type", label, selector? }],   // user actions only; "type" = one burst (<800ms gaps), label "typed 42 chars"
  clips:    [{ id, start, end|null, kind: "transition"|"css-animation"|"waapi", label, selector, component?, property?, path, iterations? ("infinite"|n), pseudoElement? }],
  activity: [{ t, v }] }                               // 10 Hz, v 0..1 = share of the viewport that changed, baselined (rolling 5s median); t = window start
clipsFor(elementOrSelector) → clips                   // on that element and its descendants, incl. looping ones
clipAt(t, selector?) → { clip, offset } | null      // offset = ms into that clip
isInteractive() → boolean                             // true only while playing at the live edge
isPaused() → boolean
onPlayState(fn) → unsubscribe                         // fn({ playing, now }) on every play/pause change
play() / pause() / record()                           // the only ways to start/stop the clock
setToolActive(bool)                                   // dock tells runtime a comment/select tool is on

## Server HTTP (Vite middleware, under /__wayback/)
Mutating requests need header x-wayback-token = window.__WAYBACK_TOKEN (injected into the shell HTML).
GET/PUT  /__wayback/session           { branches:[{id,parentId,forkAt,name,codeVersion}], activeId, markers, notes }
GET/PUT  /__wayback/recording/:branchId
GET      /__wayback/notes
PATCH    /__wayback/notes/:id          { status?, reply? }
GET      /__wayback/events             SSE: note-updated, code-version, active-changed
Disk: <project>/.retake/ (session.json, recordings/, versions/)

## Note
{ id, branchId, t, clip:{id,offset,duration}|null, selector, component, source:{file,line}|null,
  classes, rect, text, status:"pending"|"acknowledged"|"resolved"|"dismissed",
  replies:[{from:"user"|"agent", text, at}] }

## Fallback
S2 must work if endpoints 404 or timeline() is missing: in-memory state + a labelled mock in src/shell/mock/.
