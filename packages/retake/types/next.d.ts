// Types for `retake-dev/next`: Retake from a Next.js app's middleware
// (src/next.js). Dev only: outside `next dev` every request goes straight on.

/**
 * A middleware (Next 16's `proxy.ts`, Next 15's `middleware.ts`): in `next dev`
 * a top-level page load gets the dock, the dock's frame gets the page with the
 * time runtime first in `<head>`, and `/__retake/*` is the session API (kept
 * in `.retake/`, read by `retake mcp`). Everything else goes on as it was.
 *
 * ```ts
 * // proxy.ts (Next 16)
 * export { default } from "retake-dev/next"
 * ```
 *
 * ```ts
 * // middleware.ts (Next 15: the Node.js runtime)
 * import retake from "retake-dev/next"
 * export default retake
 * export const config = { runtime: "nodejs" }
 * ```
 *
 * Next reads `config` from your file as written (it can't be re-exported).
 * With a matcher of your own, add these entries to it:
 *
 * ```ts
 * "/__retake/:path*",
 * { source: "/((?!_next/static|_next/image).*)", has: [{ type: "header", key: "sec-fetch-mode", value: "navigate" }] },
 * ```
 */
declare const retake: (req: Request, event?: unknown) => Promise<Response | undefined>
export default retake

/**
 * Wraps a middleware of your own: in `next dev` Retake answers page loads and
 * `/__retake/*` first; every other request (and every request outside
 * `next dev`) goes to yours. The dock's frame is fetched through your
 * middleware too, so its redirects, rewrites and headers apply to the page.
 *
 * ```ts
 * import { withRetake } from "retake-dev/next"
 * export default withRetake(async (req) => { ... })
 * ```
 */
export function withRetake<M extends (req: any, event?: any) => any>(middleware?: M): (req: Request, event?: unknown) => Promise<Awaited<ReturnType<M>> | Response | undefined>

/**
 * Retake's answer to a request, or `undefined` to let it through (always
 * `undefined` outside `next dev`). For a middleware that decides itself.
 */
export function retakeResponse(req: Request): Promise<Response | undefined>
