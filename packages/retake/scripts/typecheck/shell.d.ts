// Globals the dock (src/shell/*.js) reads, for scripts/typecheck.mjs.
interface Window {
  /** The dock's setup, written into the page by core.js shellHtml(). */
  __retakeConfig: any
  /** The token mutating /__retake/ requests carry. */
  __RETAKE_TOKEN: string | undefined
  /** The dock, for the runtime in its frames (CONTRACT.md). */
  __retakeShell: any
  /** The runtime API in a frame's window. */
  __retake: any
}
interface Window {
  /** A handle for tests and debugging (90-handle.js). */
  __retakeDock: any
  /** In the frame on show: the px the dock covers at the bottom (10-dock.js tellDock). */
  __retakeDockHeight?: number
}
interface HTMLIFrameElement {
  /** What a frame being built takes over (10-dock.js makeFrame). */
  __retakeStash?: any
}
/** src/note-text.js's exports, inlined ahead of the dock's files by core.js (noteTextSource). */
declare const NT: typeof import("../../src/note-text.js")
