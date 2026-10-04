# Runtime ↔ Dock ↔ Server contract
Owners: S1 = src/runtime, src/core.js, src/plugin.js, src/code-versions.js, src/server, bin. S2 = src/shell. S3 = apps/site.

## Interaction model
- Play/Pause is the ONLY way to start or stop playback/recording (the play button, space, ⌥P → PT.record()/PT.play() and PT.pause()). Nothing else resumes the clock: not clicks, keys, scrolling, Control-click branching, or switching timelines.
- Playing at the live edge: the app is interactive and everything is recorded.
- Paused (anywhere) or in the past: the app is view-only, like a paused video. Clicks, keys and pointer input are blocked and don't move time; the dock's comment/select tools still work.
- Paused, the user CAN scroll the app (wheel, trackpad, scrollbar, keyboard scrolling), including while a past moment is on show or being built. That scrolling is view-only: not recorded, not seen by the app, and time doesn't move. Going back to another moment keeps the view where the user put it; whatever they haven't scrolled shows its recorded position at that moment. Moving forward through recorded time replays its scrolling. Play puts every recorded position back. The dock's shield must let scrolling through.
- Going back never makes you wait. Letting go of the playhead (or a key step, a note, a bookmark) shows the moment at once as a live preview, builds the real moment in a hidden frame behind it, and swaps it in when ready with nothing on screen moving. The readout says Paused. It says Building N% only while the user waits for the real moment: Play or + before it's ready, a moment the preview can't show (an earlier page, or past a reload going forward), a timeline switch, or an API/MCP seek.
- Paused, the app doesn't hear window resizes or other frames' `storage` events; Play delivers one `resize` if the size changed.
- A page that has just loaded live (the first page, or one the app reloaded itself into, e.g. a Vite full reload) starts where the browser put its scroll before the clock ran (scroll restoration): that's recorded at the page's first moment, so a rebuild of the page lands there too.
- A frame built behind the one on show never runs by itself: keys it gets (its replay focused a field), ⌥P included, are the dock's.
- Control-click on the track creates a new timeline from the active one at that moment, PAUSED there. Recording into it starts only when the user presses Play.
- Selecting (switching to) a timeline loads it at the current moment, PAUSED. Never auto-play.
- Play from the past replays the recording; at its end it carries on live, recording.
- Recording is on from page load. The dock has "Start fresh", which clears the session.
- Note pins (and an open note) show on the app only while paused; live or playing, only the count on the notes icon shows.
- The dock is expanded on a first visit (nothing stored). It folds into a round "Show timeline" button (divider dragged down past half its minimum height or to the bottom edge, or ⌥T); recording carries on, and the button (click, Enter, Space) brings the dock back at its default height. Stored as `retake:collapsed` in localStorage. The button starts bottom-right and can be dragged anywhere (past 5px a press is a drag, not a click); on release it snaps to the nearer side edge, and `retake:fab` stores `{ side: "left"|"right", y: 0…1 }` (how far down the free height), so it stays on screen through resizes and reloads.
- Default timeline names are "Timeline N" (N = the branch id); a stored "Main" (id 1) or "Take N" (id N) reads, and is saved back, as "Timeline N". The MCP tools report the same names. A new timeline shows "Timeline N started" in the hint.
- Code timelines: each timeline keeps its own code. An edit (the user's, an agent's) belongs to the timeline checked out, which is the one the dock is in. With code timelines on, stepping into a timeline puts its code on disk first (the frame on show pauses; the readout says Building while it settles), so its moments rebuild on the code they were recorded with; an edit on the timeline you're in rebuilds the moment on show. Off, or not chosen yet ("ask", the default), every timeline shares the files and edits are still kept per timeline; the first code change with two timelines asks inline ("Separate code" / "Share code", stored in `.retake/settings.json`). The newest code goes back on disk when Retake stops.
- The app's frame fills the window under the dock. The frame on show has `window.__retakeDockHeight` (px the dock covers at the bottom, 0 when folded) and gets a `retake:dock` event (`detail: { height }`) when it changes, so a page can leave room. ⌥T is not the dock's while typing in a dock field.

## Runtime API (window.__retake in the app frame)
timeline() → { now, end, viewport: {w,h},
  markers:  [{ t, end?, kind: "click"|"submit"|"route"|"focus"|"type", label, selector? }],   // user actions only; "type" = one burst (<800ms gaps), label "typed 42 chars"
  clips:    [{ id, start, end|null, kind: "transition"|"css-animation"|"waapi"|"js", label, selector, component?, property?, path, iterations? ("infinite"|n), dur?, delay?, from?, to? (first/last keyframe values), kfs? (how many keyframes, when more than two), pseudoElement?,
              stack?: [{ url, line, col }], first?, holds?: [[from, to]] }],   // js: inline style written frame after frame (GSAP, Motion's x, react-spring), from/to = first/last inline values, first = the values its first write set, holds = still stretches (≤ 1s) inside it; stack: where element.animate() was called
  activity: [{ t, v }] }                               // 10 Hz, v 0..1 = share of the viewport that changed, baselined (rolling 5s median); t = window start
clipsFor(elementOrSelector) → clips                   // on that element and its descendants, incl. looping ones
clipAt(t, selector?) → { clip, offset } | null      // offset = ms into that clip
isInteractive() → boolean                             // true only while playing at the live edge
isPaused() → boolean
onPlayState(fn) → unsubscribe                         // fn({ playing, now }) on every play/pause change
play() / pause() / record()                           // the only ways to start/stop the clock
setToolActive(bool)                                   // dock tells runtime a comment/select tool is on

## Dock ↔ runtime (S1↔S2)
The dock drives the frame on show (and the one being built) through these; API and MCP callers use `seek`.
preview(t, scope?) / endPreview()                     // show an earlier moment of this page at once (DOM, form fields' values and checked state, animations incl. SVG's own (SMIL), :hover, media, scroll; animations that only started after t are off; input recorded at exactly t comes just after it, as in a rebuild); deferred if a seek is running
seek(t, play?)                                        // ends a preview; forward on this page seeks in place, anything else rebuilds (visibly)
buildAt(t)                                            // rebuild t in a frame behind, leaving the preview as it is
retarget(t) → boolean                                 // a built/building frame goes on to a later t on the same page (before boot, mid-seek or landed)
sameMoment(a, b) → boolean                            // same page, < 50ms apart, no frame boundary in (lo, hi], no input in [lo, hi)
viewScroll() → [{ key, path, top, left }] / applyView(list)   // what the user scrolled to look, handed to the frame swapped in
holdDev(on)                                           // the dev server's own sockets (HMR) hold their messages while the dock switches a timeline's code; off delivers them
setBackground(on) / cancelSeek() / adopt(json, t)     // idle-slice replay, stop a seek, a checkpoint taking a newer recording
state() → { …, previewing, previewAt, route, docStart, segEnd, from, storageOk, idb, buildId }
  // route: while previewing, the app's route at previewAt (the address bar shows it; the app's own location doesn't change), else null
  // docStart/segEnd: where this document's page starts / the next one does (null: none); from: where the last seek started;
  // storageOk: this frame can run its app as it is (false: another frame changed IndexedDB, rebuild instead); idb: the app uses IndexedDB
window.__retakeShell (dock, called by the runtime):
  rebuild({ rec, target, url, viewport, rate, sig, play? })   // the dock keeps, retargets or replaces its one build; it plays it after the swap
  take() / attach(pt) / key(e) / rebuilding / storageOwner / fastReplay (false: replay settles with a full task round trip)
  shows(win) → boolean                                // is this window the frame on show? (a hidden one hands ⌥P to the dock, and holds
                                                      //  requests the recording has no answer for until it's on show at the live edge, F52)
  isAppFrame(el) → boolean                            // did the dock make this iframe (on show, building, checkpoint)? The injected runtime asks before it runs

## Server HTTP (Vite middleware or front server, under /__retake/)
Mutating requests need header x-retake-token = window.__RETAKE_TOKEN (injected into the shell HTML).
A PUT body may be `Content-Encoding: gzip` (the dock gzips bodies over 1 MB when the browser has CompressionStream: a Next.js middleware reads 10 MB at most).
GET/PUT  /__retake/session           { branches:[{id,parentId,forkAt,name,codeVersion}], activeId, markers, notes }
                                     // codeVersion is the server's (the timeline's head): what a PUT sends is ignored
GET/PUT  /__retake/recording/:branchId
GET      /__retake/notes
PATCH    /__retake/notes/:id          { status?, reply? }
GET      /__retake/events             SSE: note-updated, code-version (the whole code state + reason: edit|checkout|follow|enabled|session|…),
                                     active-changed ({ activeId, by?: "agent"|"cli", note? } when the server moved the dock)
GET      /__retake/code               code timelines: { enabled: true|false|"ask", checkedOut, checkedOutName, disk, newest, suspended,
                                     lease: { note, branchId, name, at }|null, leaseLost, offEdits, timelines: { [id]: { fork, head, changed, files } }, deleted }
POST     /__retake/code/checkout      { branchId, reason?: "dock"|"fork"|"note"|"mcp"|"cli", force?, note?, url?, parentId? }
                                     → { ok, version, files:[{ path, change: "write"|"delete" }], swapped, left?, deps? } or 409 { error, lease?|suspended?|gitBusy? }
                                     (off/"ask": no files move, the timeline just becomes the one edits land on; reason note/mcp/cli also moves the dock)
GET      /__retake/code/diff?branch=&against=fork|<id>   { files:[{ path, status }], patch (unified, ≤ 64 KB) }
POST     /__retake/code/enabled       { on }   POST /__retake/code/resume (after a git branch switch)   POST /__retake/code/restore { version? }
GET      /__retake/version, POST /__retake/checkout?v=   older docks' routes (one more release)
GET      /__retake/health             front server only: 200 once the dev server behind it has answered, 503 before
Disk: <project>/.retake/ (session.json, recordings/, server.json { url, base, token, pid }; front.log with --verbose; code timelines:
code-timelines.json (the server's: each timeline's fork/head, checkedOut, newest, lease), settings.json { codeTimelines }, versions/ + blobs/,
journal.json during a checkout, code.lock, ignore (more paths to leave out, .gitignore syntax))

## Front server (src/server/front.js; `retake .` on a framework, `retake -- <cmd>`, `retake http://…`)
Retake on its own port, proxying to the app's dev server. Requests, in this order:
- a Host that isn't localhost, `*.localhost`, an IP address, `--host` or `allowedHosts` → 403, WebSocket upgrades too (DNS rebinding, F64)
- `/__retake/health`, `/__retake/*` (the code routes too, with a project folder: `retake <project>`, `-- <cmd>`'s folder, a URL's `--root`); `Service-Worker: script` → 404
- GET, `Sec-Fetch-Mode: navigate`, `Sec-Fetch-Dest: document`, `Sec-Fetch-Site` ≠ cross-site, no `retake=0` → the dock, `shellHtml({ marker: "header" })`
  (cross-site, e.g. an OAuth callback → the plain page). No Sec-Fetch-* at all and Accept text/html → the dock with `marker: "url"`,
  unless its Referer is a page of ours with `__wb=app` (the frame navigating without the marker: its page, URL marker)
- `Sec-Fetch-Mode: navigate` + `Sec-Fetch-Dest: iframe|frame` (any method), or `?__wb=app` → the page with the runtime injected
  (every text/html response with a body, error pages too; `__wb` is stripped before the dev server sees it)
- anything else streams through untouched; WebSocket upgrades are piped
Headers: the browser's Host is kept, X-Forwarded-Host/Proto/Port added; a Location on the dev server's origin is rewritten to Retake's,
and a URL-marked frame's same-origin redirects keep `__wb=app` (F66). An answer the dev server drops mid-body is dropped for the
browser too (an EventSource reconnects; F65).
Frame documents: Accept-Encoding identity, no conditional headers; decoded if still compressed; no content-length/etag; no-store;
charset=utf-8 added. CSP: the page's nonce, else a 'sha256-…' for the tag, dropped only for multi-policy headers; X-Frame-Options
SAMEORIGIN and frame-ancestors 'self' are kept (the dock is same-origin), DENY/'none'/lists without 'self' are loosened to allow it.
The same routing runs inside Vite when the plugin finds no index.html (a Vite-based framework renders its own pages), minus the proxy.

Every request the front server forwards carries `X-Retake-Front: 1`, so an app with retake-dev/next in its middleware stands aside.

Header marker: the dock (`__retakeConfig.marker === "header"`) puts no `__wb` on its frames' URLs and the runtime doesn't rewrite
navigations. The server can't tell the dock's frame from an iframe the app embeds, so the injected script (`runtimeTag`) removes
itself, then runs the runtime only if `parent.__retakeShell.isAppFrame(frameElement)` (URL marker: or `__wb=app` in the URL);
anywhere else `window.__retake = { inert: true }` and the runtime returns at once.
`RT` (the runtime's config, `runtimeSource(rt)`): { marker: "url"|"header", bootAt: "dcl"|"load", exemptUrls: [regexp sources],
holdScripts, next: Next major|null, docId, docStored }. The Vite plugin passes nothing (marker "url", clock at
DOMContentLoaded, nothing held or exempted by URL). The site's deployed Next build (apps/site/proxy.js, no Retake server behind it)
passes { marker: "header", bootAt: "load", holdScripts: true } and its docks are `shellHtml({ marker: "header", server: false })` (no token, no docs).
`shellHtml({ server: false })` sets `__retakeConfig.server = false`: the dock never requests `/__retake/` (no session, recordings, notes or events) and keeps everything in memory. `markSvg()` (core.js, exported by the package) is `src/mark.svg`, the folded button's icon (`<!--MARK-->` in shell.html), for the site's favicon too. The front server (and the plugin's no-index.html path) uses `frontRuntime(framework)`
(server/detect.js): clock at `load`, then once nothing has loaded for 150 ms (F47, F61), scripts added later held to their recorded moment (F48), the framework's dev URLs exempt (F54) (and, by header, Next's HMR refetch `next-hmr-refresh: 1`, F77),
`next` for Next 16's debug channel (F49). Fronting a bare URL or `-- <cmd>`, Next is recognised by its first page's X-Powered-By;
with no project to read its version from, `next: "auto"` and the runtime reads `window.next.version` (F59).

Kept pages (F56, front server only): every frame document is stored as it came in `.retake/docs/<id>.{json,body}` (200 kept) and
the runtime gets its id (`RT.docId`; the recording keeps it per segment as `doc`). Before loading a build or checkpoint frame the
dock (`__retakeConfig.docs`) sets a one-shot cookie `__retake_doc=<id>` (path = the page's path, 10 s); the front server serves that
copy (`x-retake-doc: stored`, `RT.docStored`), clears the cookie, and strips it from every request it forwards. Each copy is tagged
with the code version on disk (`meta.version`, `x-retake-doc-version`) and served only while that code is on disk again (so stepping
back into a timeline serves what its code rendered); a copy without a tag isn't served once the project's source changed after it
was kept (the front server watches `watch`, default the project `dir`): the page is rendered again, and the cookie still cleared (F67).
A code checkout holds the dev server's WebSocket messages for the sockets open when it starts (they're dropped with their frames;
a failed checkout delivers them), waits for them to go quiet (300 ms, up to 8 s) and fetches the frame's page once before answering. A copy cut off mid-body isn't kept. Such a page's Next HMR
socket gets an `id` of its own (`<__next_r>-retake-…`): Next keeps one socket per id (F58); its live requests carry that id in
`x-nextjs-html-request-id`, where Next sends their debug data (F71). The runtime leaves
`__retake*` cookies out of its cookie snapshots.

## Next.js middleware (src/next.js, src/next-dev.js; `retake-dev/next`)
The app's own `next dev` docks itself: Next 16's `proxy.ts` (`export { default } from "retake-dev/next"`) or Next 15's `middleware.ts`
(`runtime: "nodejs"`), or `withRetake(theirs)`. Outside `NODE_ENV === "development"` it returns nothing for every request and never loads
next-dev.js (imported at run time, unbundled, as `retake-dev/next-dev`). In dev, in this order:
- `x-retake-internal: 1` (its own fetch) or `x-retake-front: 1` → passed on
- `/__retake/*` → api.js's handler around the web Request (event streams too), `.retake/` in the cwd (`RETAKE_ROOT`); server.json's url is
  the first request's origin; a Host that isn't localhost/IP → 403
- `Service-Worker: script` → 404
- the front server's dock rule (GET, navigate, document, not cross-site, no `retake=0`) → `shellHtml({ token, marker: "header" })`; a Host that
  isn't localhost/IP → the plain page
- navigate + iframe/frame → the page fetched from the same URL with `x-retake-internal: 1` (the request's headers and cookies, `Accept-Encoding:
  identity`, no conditional headers, redirects not followed), HTML run through `injectHtml` with `runtimeTag` for `frontRuntime("next", cwd)` +
  marker "header"; CSP and X-Frame-Options adapted as by the front server; `Vary: Sec-Fetch-Dest, Sec-Fetch-Mode`
- anything else → passed on (the user's middleware, if wrapped)
No kept pages (F56): a rebuild gets the page rendered again. Token, session handler and code timelines (their own watcher; a
checkout waits 250 ms and fetches the frame's page once) live on `globalThis` for the server's life. `RETAKE_CODE_TIMELINES=1|0`.

## Note
{ id, branchId, t, clip:{id,offset,duration,start,end}|null, selector, component,
  source:{file,line,mapped?,compiled?,url?,col?}|null,   // compiled: only a bundle's line, no source map (url/col kept to map it later)
  classes, rect, text, status:"pending"|"acknowledged"|"resolved"|"dismissed",
  replies:[{from:"user"|"agent", text, at}],
  codeVersion?, resolvedVersion?,   // the server's: the timeline's code when the note was made / after the resolve (code timelines)
  // Animation notes (all optional; src/note-text.js writes them for agents):
  range:{from,to}|null, asked:{text,reading:"local"|"recording",from,to}|null,
  target:{ path, selector, matches, index?, hint, tag, text, role, ariaLabel, picked:{via,skipped}, source, geometry },
  anims:[{ id, relation:"on"|"pseudo ::after"|"ancestor (moves it)", primary, selector,
           kind:"css-animation"|"css-transition"|"waapi"|"js"|"scroll-driven"|"smil", lib?:"motion"|"gsap"|"anime"|"react-spring",
           name, defined:{file,line,what}|null, rule?, trigger?, timing:{delay,duration,endDelay,iterations,direction,fill,easing,playbackRate,start,activeStart,end},
           keyframes:[{offset,easing,values}], approx?,                // approx: only the first and last keyframe known
           shared?:[{id,selector}],                                   // the same @keyframes on other elements
           motionProps?:{component,props:{initial,animate,transition,...}},   // a Motion element's props, as JSON text
           motionKeyframes?:true, leadMs?,                            // js clip of Motion keyframes: keyframes/timing read off its animate + transition props
                                                                      // (values in Motion's units: x 120; one easing per segment, effect easing linear); leadMs = local time of its first write
           at?:Point, from?:Point, to?:Point, openEnd?, keyframesInside?:[offset], samples?:[{T,local,progress,values,geometry}],
           runs?:[{id,start,end}],                                    // the same animation started again on this element (≤ 60), one entry for all
           instant?:true }],                                          // 0ms or between equal values: never primary while anything else runs
  inside:[{id,selector,name}],
  group?:{ selector, label, members:[{ selector, label, anim: anims[] entry (no samples) | null }] } }   // "Whole group": every animated child, at t / over range on its own clock
  // Point = { T, local, iteration, phase:"delay"|"active"|"after", progress, eased, segment:{index,fromOffset,toOffset,easing,progress}, values, frame:{before,after}, geometry }

## Fallback
S2 must work if endpoints 404 or timeline() is missing: in-memory state + a labelled mock in src/shell/mock/.
With `__retakeConfig.server === false` it doesn't ask at all.
Leaving the page while recording (pagehide), the dock keeps the active recording in sessionStorage (`retake:live`: { branchId, rec }) when the server's copy is behind; the next load of the dock in that tab takes it (and removes it) and carries on from it if it's the same recording (same `epoch`) and further along (F78).
