// Types for `retake-dev`: the Vite plugin and the pieces a server shares to
// dock Retake into pages it serves (src/plugin.js, src/core.js).
import type { Transform } from "node:stream"
import type { Plugin } from "vite"

/** Options for the Vite plugin. Dev only: it does nothing in builds. */
export interface RetakeOptions {
  /** `false` turns the plugin off (the pages are served as they are). Default `true`. */
  enabled?: boolean
  /**
   * Code timelines: each timeline keeps its own code. `true`: stepping into a
   * timeline puts its code on disk (your files are rewritten; the newest code
   * goes back when the dev server stops). `false`: every timeline shares the
   * files. `"ask"` (the default): the dock asks the first time it matters, and
   * the answer is kept in `.retake/settings.json`.
   */
  codeTimelines?: boolean | "ask"
  /** The old name of `codeTimelines: true`. */
  codeBranches?: boolean
  /**
   * The token mutating `/__retake/` requests must carry (header
   * `x-retake-token`). Default: a random one per server start.
   */
  token?: string
  /** Where `.retake/` (sessions, recordings, notes) goes. Default: Vite's root. */
  root?: string
  /** `false` hides the "Retake  timeline docked at …" line on startup. Default `true`. */
  banner?: boolean
}

/**
 * The Vite plugin: the dock for page loads, the time runtime in the dock's
 * frame, and the session API under `/__retake/`.
 *
 * ```ts
 * import { defineConfig } from "vite"
 * import { retake } from "retake-dev"
 * export default defineConfig({ plugins: [retake()] })
 * ```
 */
export function retake(options?: RetakeOptions): Plugin[]
export default retake

/** How the runtime is set up for the server it runs behind (`RT` in the runtime). */
export interface RuntimeConfig {
  /**
   * How the dock's frame is known: `"url"` (its URL carries `__wb=app`, the
   * Vite plugin's way) or `"header"` (the server tells by `Sec-Fetch-Dest`).
   * Default `"url"`.
   */
  marker?: "url" | "header"
  /** When the clock starts: at DOMContentLoaded (`"dcl"`, default) or at `load`. */
  bootAt?: "dcl" | "load"
  /** The dev server's own traffic (regular expression sources), never recorded or held. */
  exemptUrls?: string[]
  /** Scripts added after load are held to their recorded moment. Default `false`. */
  holdScripts?: boolean
  /**
   * The Next.js major version, for its dev debug channel; `"auto"`: the
   * runtime asks Next's client. Default `null` (not Next).
   */
  next?: number | "auto" | null
  /** This page's kept copy on the front server. Default `null`. */
  docId?: string | null
  /** Whether this page is that kept copy. Default `false`. */
  docStored?: boolean
}

/** The time runtime as JavaScript source: one IIFE, to run as the page's first script. */
export function runtimeSource(rt?: RuntimeConfig): string

/** Options for the dock page. */
export interface ShellOptions {
  /** Show the code-branch controls (needs a server running with code branches). */
  codeBranches?: boolean
  /**
   * The path the dock's frame always loads (a static build that ships the
   * app as a page of its own). Default: the page's own URL.
   */
  appPage?: string
  /** How the dock marks its frame; see {@link RuntimeConfig.marker}. Default `"url"`. */
  marker?: "url" | "header"
  /** Rebuilds ask the server for the page as it was recorded (front server only). */
  docs?: boolean
  /**
   * `false`: there's no Retake server behind the dock (a static or serverless
   * deploy). It never requests `/__retake/` (no session, no events) and keeps
   * the session in memory for the page. Default: a server is assumed, and a 404
   * from it falls back to memory.
   */
  server?: boolean
  /** The project folder: source paths in notes are written relative to it. */
  root?: string
  /** The token mutating `/__retake/` requests carry. */
  token?: string
}

/** The dock page: a complete HTML document with the app in a frame. */
export function shellHtml(options?: ShellOptions): string

/**
 * Retake's mark as an SVG string (24×24 viewBox, no width or height): a
 * playhead on a track with an arc back to it. The arc and the played part are
 * `currentColor`, the rest white, so it reads on a dark background.
 */
export function markSvg(): string

export interface RuntimeTagOptions {
  /** The runtime's setup. */
  rt?: RuntimeConfig
  /** A CSP nonce for the `<script>` tag. */
  nonce?: string | null
  /** The script to wrap. Default: the guarded runtime for `rt`. */
  script?: string
}

/**
 * The `<script data-retake>` tag a server injects into a page: it removes
 * itself, then runs the runtime only in a frame the dock made.
 */
export function runtimeTag(options?: RuntimeTagOptions): string

/**
 * A byte stream transform that inserts `tag` into an HTML document as it
 * streams: after the `<head>` opening tag (and a `<meta charset>` right after
 * it), else before the first `<body>`, `<script>`, `<link>`, `<meta>`,
 * `<style>` or `<title>`. A compressed body (`encoding`: gzip, br, deflate,
 * zstd) is decoded first and the output is plain. Throws for an encoding it
 * can't decode.
 */
export function injectHtml(tag: string, options?: { encoding?: string }): Transform
