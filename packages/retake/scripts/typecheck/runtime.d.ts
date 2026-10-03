// Globals the runtime (src/runtime/*.js) reads or adds, for scripts/typecheck.mjs.
interface Window {
  /** The runtime API (70-boot.js); CONTRACT.md "Runtime API". */
  __retake: any
  /** The dock, in the parent window (CONTRACT.md). */
  __retakeShell: any
  /** Debug tracing switch. */
  __retakeTrace: any
  /** Next.js's client globals (37-next.js). */
  __next_r: any
  next: any
}
interface HTMLMediaElement {
  __ptWants?: any
  __ptFrom?: any
  __ptAt?: any
}
// Chrome's async stack tagging (not in lib.dom).
interface Console {
  createTask?: (name: string) => { run<T>(fn: () => T): T }
}
