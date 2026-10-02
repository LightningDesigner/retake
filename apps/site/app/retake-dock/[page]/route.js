// The dock for each page of the deployed site (the proxy rewrites a top-level
// load of / or /try here). Built once, at build time. Its frame loads the
// page's own URL, which the proxy serves with the runtime (marker "header").
// There's no Retake server behind it: /__retake/* is a 404, so the dock keeps
// timelines and notes in memory for the visit.
import { retakeDev } from "../../../src/retake.js"
import { PAGES } from "../../../src/site.js"

export const dynamic = "force-static"
export const dynamicParams = false
export const generateStaticParams = () => Object.keys(PAGES).map((page) => ({ page }))

const esc = (s) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;")

export async function GET(_req, { params }) {
  const p = PAGES[(await params).page]
  // The page's title and description, for link previews.
  const head = `<title>${esc(p.title)}</title>\n    <meta name="description" content="${esc(p.description)}" />`
  const { shellHtml } = await retakeDev()
  const html = shellHtml({ marker: "header" }).replace(/<title>[\s\S]*?<\/title>/i, () => head)
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } })
}
