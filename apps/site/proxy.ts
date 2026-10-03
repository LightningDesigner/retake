// The deployed site ships the dock, so the page is the live demo. In
// production this does what Retake's front server does in dev (see
// packages/retake/src/server/front.js), for the site's two pages:
//   a top-level load of / or /try   gets the dock (app/retake-dock), whose
//                                   frame loads the same URL
//   the dock's frame (Sec-Fetch-Dest: iframe)
//                                   gets the page with the time runtime as its
//                                   first script (app/retake-runtime)
//   anything else, ?retake=0, or a browser with no Sec-Fetch-* headers
//                                   gets the plain page
// In dev (`pnpm dev`) the front server in front of `next dev` does all this,
// so the proxy stands aside.
import { NextResponse, type NextRequest } from "next/server"
import { PAGES } from "./src/site.ts"

const INTERNAL = "x-retake-internal"
const PAGE_BY_PATH: Record<string, string | undefined> = Object.fromEntries(Object.entries(PAGES).map(([name, p]) => [p.path, name]))
// Both answers at a page's URL depend on who asked for it.
const VARY = "Sec-Fetch-Dest, Sec-Fetch-Mode"

// The runtime and each page's HTML, fetched from this deployment once per
// instance (they're static: they only change with a new build).
const fetched = new Map<string, Promise<string>>()
function fetchText(req: NextRequest, path: string): Promise<string> {
  if (!fetched.has(path)) {
    const headers: Record<string, string> = { [INTERNAL]: "1" }
    // Preview deployments behind Vercel's protection: the visitor's own pass.
    const cookie = req.headers.get("cookie")
    if (cookie) headers.cookie = cookie
    if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) headers["x-vercel-protection-bypass"] = process.env.VERCEL_AUTOMATION_BYPASS_SECRET
    const p = fetch(new URL(path, req.url), { headers, cache: "no-store" }).then(async (res) => {
      if (!res.ok) throw new Error(`${path}: ${res.status}`)
      return res.text()
    })
    fetched.set(path, p)
    p.catch(() => fetched.delete(path))
  }
  return fetched.get(path)!
}

// After <head> (and the <meta charset> right after it), as the front server
// puts it: before any of Next's own scripts.
function inject(html: string, tag: string) {
  const head = /<head(?=[\s>])[^>]*>/i.exec(html)
  if (!head) return tag + html
  let at = head.index + head[0].length
  const meta = /^\s*<meta\b[^>]*\bcharset\s*=[^>]*>/i.exec(html.slice(at))
  if (meta) at += meta[0].length
  return html.slice(0, at) + tag + html.slice(at)
}

export async function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname
  const internal = req.headers.get(INTERNAL) === "1"
  // The dock and runtime routes are only for the rewrites and fetches below.
  if (path.startsWith("/retake-dock/") || path === "/retake-runtime") return internal ? NextResponse.next() : new NextResponse("Not found", { status: 404 })
  if (process.env.NODE_ENV !== "production" || internal) return NextResponse.next()
  const page = PAGE_BY_PATH[path]
  const mode = req.headers.get("sec-fetch-mode")
  const dest = req.headers.get("sec-fetch-dest")
  if (!page || req.method !== "GET" || req.nextUrl.searchParams.get("retake") === "0" || mode !== "navigate") return NextResponse.next()
  if (dest === "document") {
    const res = NextResponse.rewrite(new URL(`/retake-dock/${page}`, req.url), { request: { headers: withInternal(req.headers) } })
    res.headers.set("vary", VARY)
    res.headers.set("cache-control", "private, no-cache")
    return res
  }
  if (dest !== "iframe") return NextResponse.next()
  try {
    const [tag, html] = await Promise.all([fetchText(req, "/retake-runtime"), fetchText(req, path)])
    return new NextResponse(inject(html, tag), {
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "private, no-cache", vary: VARY },
    })
  } catch (err) {
    // Without the runtime the frame still shows the page; the dock says it can't record.
    console.error("[retake] the frame's page:", err instanceof Error ? err.message : err)
    return NextResponse.next()
  }
}

function withInternal(headers: Headers) {
  const h = new Headers(headers)
  h.set(INTERNAL, "1")
  return h
}

export const config = { matcher: ["/", "/try", "/retake-dock/:page*", "/retake-runtime"] }
