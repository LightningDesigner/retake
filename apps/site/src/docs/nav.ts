// The docs' pages, in sidebar order: each one's path, its sidebar label, and
// its title and description (the page's metadata).
import type { Metadata } from "next"
import { OG_IMAGE } from "../site.ts"

export interface DocPage {
  slug: string
  path: string
  label: string
  title: string
  description: string
}

const page = (slug: string, label: string, title: string, description: string): DocPage => ({
  slug,
  path: slug ? `/docs/${slug}` : "/docs",
  label,
  title,
  description,
})

export const GROUPS: Array<{ name: string; pages: DocPage[] }> = [
  {
    name: "Start",
    pages: [
      page("", "Overview", "Overview", "What Retake is, and the thirty seconds from npx to dragging your app back in time."),
      page("install", "Install", "Install", "Run Retake with npx, install it in a project, add the Vite plugin, or put it in front of Next.js, React Router, Remix, Astro, SvelteKit or Nuxt."),
    ],
  },
  {
    name: "Use",
    pages: [
      page("features", "Features", "Features", "The timeline, scrubbing and previews, rebuilt moments, takes, notes, Start fresh and every keyboard shortcut in the dock."),
      page("output", "Output", "Output", "What a note gives your coding agent: the Copy for agent prompt and the MCP get_note text, field by field, with real examples."),
      page("mcp", "MCP", "MCP server", "Connect Retake's notes to Claude Code, Cursor, Codex or any MCP client, and the seven tools it exposes."),
      page("api", "API", "API reference", "CLI flags, Vite plugin options, the session HTTP API under /__retake/, and the window.__retake runtime API."),
    ],
  },
  {
    name: "More",
    pages: [
      page("faq", "FAQ", "FAQ", "Production builds, browsers, what isn't rewound, where data lives, the license, Safari, and signing in."),
      page("changelog", "Changelog", "Changelog", "What changed in each release of retake-dev."),
    ],
  },
]

export const PAGES: DocPage[] = GROUPS.flatMap((g) => g.pages)

export function docPage(slug: string): DocPage {
  const p = PAGES.find((x) => x.slug === slug)
  if (!p) throw new Error(`no docs page ${JSON.stringify(slug)}`)
  return p
}

// A docs page's metadata. The title goes through the docs layout's template
// ("Install · Retake docs").
export function docMetadata(slug: string): Metadata {
  const p = docPage(slug)
  const title = slug ? p.title : { absolute: "Retake docs" }
  const full = slug ? `${p.title} · Retake docs` : "Retake docs"
  return {
    title,
    description: p.description,
    alternates: { canonical: p.path },
    openGraph: { title: full, description: p.description, url: p.path, siteName: "Retake", type: "article", images: [OG_IMAGE] },
    twitter: { card: "summary_large_image", title: full, description: p.description, images: [OG_IMAGE.url] },
  }
}

export const NPM = "https://www.npmjs.com/package/retake-dev"
