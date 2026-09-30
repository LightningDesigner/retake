# Runtime ↔ Dock ↔ Server contract
Owners: S1 = src/runtime, src/plugin.js, src/code-versions.js, src/server, bin. S2 = src/shell. S3 = apps/site.

## Interaction model
- At the live edge: the app is interactive and everything is recorded.
- Rewound / paused in the past: the app is view-only (app input blocked), like a paused video, except the dock's comment/select tools.
- + creates a new timeline at the current moment; the app becomes live from there, recording into the new timeline.
- Play from the past replays the recording; at the end it becomes live again.
- Recording is always on from page load. The dock has "Start fresh", which clears the session.

## Runtime API (window.__wayback in the app frame)
timeline() → { now, end, viewport: {w,h},
  markers: [{ t, kind: "click"|"key"|"input"|"submit"|"route"|"fetch"|"reload", label, selector? }],
  clips:   [{ id, start, end|null, kind: "transition"|"css-animation"|"waapi", label, selector, component?, property? }] }
clipAt(t, selector?) → { clip, offset } | null      // offset = ms into that clip
isInteractive() → boolean
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
