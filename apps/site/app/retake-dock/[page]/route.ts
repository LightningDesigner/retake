// The dock for each page of the deployed site (the proxy rewrites a top-level
// load of / or /playground here). Built once, at build time. Its frame loads the
// page's own URL, which the proxy serves with the runtime (marker "header").
// There's no Retake server behind it (server: false): the dock never asks
// /__retake/ and keeps timelines and notes in memory for the visit.
import { retakeDev } from "../../../src/retake.ts"
import { isPage, OG_IMAGE, PAGES, SITE_URL } from "../../../src/site.ts"

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
    `<meta property="og:url" content="${esc(SITE_URL + p.path)}" />`,
    `<meta property="og:image" content="${esc(SITE_URL + OG_IMAGE.url)}" />`,
    `<meta property="og:image:width" content="${OG_IMAGE.width}" />`,
    `<meta property="og:image:height" content="${OG_IMAGE.height}" />`,
    `<meta property="og:image:alt" content="${esc(OG_IMAGE.alt)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${esc(p.title)}" />`,
    `<meta name="twitter:description" content="${esc(p.description)}" />`,
    `<meta name="twitter:image" content="${esc(SITE_URL + OG_IMAGE.url)}" />`,
    `<link rel="icon" href="/icon.svg" type="image/svg+xml" />`,
  ].join("\n    ")
  const { shellHtml } = await retakeDev()
  const html = shellHtml({ marker: "header", server: false }).replace(/<title>[\s\S]*?<\/title>/i, () => head)
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } })
}
