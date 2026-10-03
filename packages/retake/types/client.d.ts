// Types for the runtime API, `window.__retake`, in the dock's app frame
// (CONTRACT.md, "Runtime API"). Add them to a project with
// `/// <reference types="retake-dev/client" />` or `"types": ["retake-dev/client"]`.
//
// In a page Retake isn't running in (any iframe the dock didn't make), it's
// `{ inert: true }`; with no Retake at all it's undefined.

export interface RetakeMarker {
  t: number
  /** "type" is one burst of typing (gaps under 800ms). */
  end?: number
  kind: "click" | "submit" | "route" | "focus" | "type"
  label: string
  selector?: string
}

export interface RetakeClip {
  id: string | number
  start: number
  end: number | null
  kind: "transition" | "css-animation" | "waapi"
  label: string
  selector: string
  component?: string
  property?: string
  path: Array<string | number>
  iterations?: "infinite" | number
  pseudoElement?: string
}

/** 10 Hz samples: `v` 0..1 is the share of the viewport that changed (baselined); `t` is the window start. */
export type RetakeActivity = Array<{ t: number; v: number }> & { step?: number; t0?: number; values?: number[] }

export interface RetakeTimeline {
  now: number
  end: number
  viewport: { w: number; h: number }
  /** User actions only. */
  markers: RetakeMarker[]
  clips: RetakeClip[]
  activity: RetakeActivity
}

export interface RetakeRuntime {
  readonly inert?: false
  version: string
  /** The virtual clock, in ms. */
  now(): number
  timeline(): RetakeTimeline
  /** Clips on that element and its descendants, looping ones included. */
  clipsFor(target: Element | string): RetakeClip[]
  /** The latest clip running at `t` (on `selector`, or inside it); `offset` is ms into it. */
  clipAt(t: number, selector?: string): { clip: RetakeClip; offset: number } | null
  /** True only while playing at the live edge. */
  isInteractive(): boolean
  isPaused(): boolean
  /** Called on every play/pause change. Returns an unsubscribe. */
  onPlayState(fn: (state: { playing: boolean; now: number }) => void): () => void
  /** Play from here: replays the recorded future, then carries on live. */
  play(): void
  pause(): void
  /** Starts the timeline, or resumes recording from its end. */
  record(): void
  /** Go to moment `t` (ends a preview). False before anything was recorded. */
  seek(t: number, play?: boolean): boolean | void
  setToolActive(on: boolean): void
}

declare global {
  interface Window {
    __retake?: RetakeRuntime | { readonly inert: true }
  }
}
