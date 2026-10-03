// The dock for each page of the deployed site (the proxy rewrites a top-level
// load of / or /try here). Built once, at build time. Its frame loads the
// page's own URL, which the proxy serves with the runtime (marker "header").
// There's no Retake server behind it: /__retake/* is a 404, so the dock keeps
// timelines and notes in memory for the visit.
import { retakeDev } from "../../../src/retake.ts"
import { isPage, PAGES, SITE_URL } from "../../../src/site.ts"

export const dynamic = "force-static"
export const dynamicParams = false
export const generateStaticParams = () => Object.keys(PAGES).map((page) => ({ page }))

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;")

export async function GET(_req: Request, { params }: { params: Promise<{ page: string }> }) {
  const name = (await params).page
  // Never another name: dynamicParams is false.
  if (!isPage(name)) return new Response("Not found", { status: 404 })
  const p = PAGES[name]
  // The page's title, description and card, for link previews.
  const head = [
    `<title>${esc(p.title)}</title>`,
    `<meta name="description" content="${esc(p.description)}" />`,
    `<meta property="og:title" content="${esc(p.title)}" />`,
    `<meta property="og:description" content="${esc(p.description)}" />`,
    `<meta property="og:image" content="${esc(SITE_URL)}/opengraph-image" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<link rel="icon" href="/icon.svg" type="image/svg+xml" />`,
  ].join("\n    ")
  const { shellHtml } = await retakeDev()
  const html = shellHtml({ marker: "header" }).replace(/<title>[\s\S]*?<\/title>/i, () => head)
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } })
}
