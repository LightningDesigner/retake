// Retake on a Next.js app's own dev server, from its middleware: Next 16's
// `proxy.ts` or Next 15's `middleware.ts`.
//
//   export { default } from "retake-dev/next"
//
// Next 15's middleware.ts needs the Node.js runtime (Retake reads its files and
// keeps .retake/ on disk), and imports it (Next 15.5's Turbopack puts a
// re-exported default on the Edge runtime):
//
//   import retake from "retake-dev/next"
//   export default retake
//   export const config = { runtime: "nodejs" }
//
// With a middleware of your own:
//
//   import { withRetake } from "retake-dev/next"
//   export default withRetake(yourMiddleware)
//
// In `next dev` it does what the front server (server/front.js) does on a port
// of its own: a top-level page load gets the dock, the dock's frame gets the
// page with the runtime as its first script, /__retake/* is the session API,
// and everything else passes through. Anywhere else (next build, next start)
// it does nothing: it hands every request on and never loads the rest of
// Retake.
//
// This file stays free of Node imports, so it bundles into any middleware. The
// work is in next-dev.js, loaded at run time in dev only, from node_modules as
// it is: never bundled (it reads the runtime and the dock from its own files).

const DEV = process.env.NODE_ENV === "development"

/** @type {Promise<typeof import("./next-dev.js")> | null} */
let loading = null
let warned = false
const devHandler = () => (loading ||= import(/* webpackIgnore: true */ /* turbopackIgnore: true */ "retake-dev/next-dev"))

/**
 * Retake's answer to this request, or undefined to let it through.
 * @param {Request} req
 * @returns {Promise<Response | undefined>}
 */
export async function retakeResponse(req) {
  if (!DEV) return undefined
  if (typeof (/** @type {any} */ (globalThis).EdgeRuntime) === "string") {
    if (!warned) console.warn('[retake] the timeline needs the Node.js runtime: add `export const config = { runtime: "nodejs" }` to middleware.ts')
    warned = true
    return undefined
  }
  try {
    return (await (await devHandler()).handle(req)) || undefined
  } catch (err) {
    console.error("[retake]", err instanceof Error ? err.message : err)
    return undefined
  }
}

/**
 * Wraps a middleware of your own: Retake answers first (in dev, for page loads
 * and /__retake/*), everything else goes to yours.
 * @template {(...args: any[]) => any} M
 * @param {M} [middleware]
 * @returns {(req: Request, event?: any) => Promise<any>}
 */
export function withRetake(middleware) {
  return async function retakeMiddleware(req, event) {
    if (DEV) {
      const res = await retakeResponse(req)
      if (res) return res
    }
    return middleware ? middleware(req, event) : undefined
  }
}

export default withRetake()

// Next reads a middleware's `config` from the file itself (it can't be
// re-exported), so there's none here. Without one Next runs it for every
// request, and it hands everything but page loads and /__retake/* straight on.
// A matcher of your own needs these two entries, as written:
//   "/__retake/:path*",
//   { source: "/((?!_next/static|_next/image).*)", has: [{ type: "header", key: "sec-fetch-mode", value: "navigate" }] },
