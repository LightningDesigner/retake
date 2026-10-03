// The pages that carry the dock (/ and /playground): each one's path, title and
// description, for its metadata and the dock's in the deployed build
// (app/retake-dock), so link previews read as the page. The docs have their own
// list (src/docs/nav.ts) and no dock.
import type { Metadata } from "next"

// Where the site is deployed: the absolute base for link-preview images. Vercel
// sets VERCEL_PROJECT_PRODUCTION_URL to the production domain at build time.
export const SITE_URL = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : "https://retake-omega.vercel.app"

export interface Page {
  path: string
  title: string
  description: string
}

export const PAGES = {
  index: {
    path: "/",
    title: "Retake",
    description: "Rewind your app while you build it. Retake records your app in development; drag the timeline back and the app is really there. Vite, Next.js, React Router, Remix, Astro, SvelteKit, Nuxt.",
  },
  playground: {
    path: "/playground",
    title: "Retake playground",
    description: "Three small demos with Retake docked under them. Play with one, then drag the timeline back.",
  },
} satisfies Record<string, Page>

export type PageName = keyof typeof PAGES

export const isPage = (name: string): name is PageName => Object.hasOwn(PAGES, name)

// The link-preview card (app/opengraph-image.tsx). Named on every page: a
// page's own openGraph and twitter metadata replace the root's, image included.
export const OG_IMAGE = { url: "/opengraph-image", width: 1200, height: 630, alt: "Retake: rewind your app while you build it" }

// A page's metadata: title, description and the link-preview card.
export const pageMetadata = (p: Page): Metadata => ({
  title: p.title,
  description: p.description,
  openGraph: { title: p.title, description: p.description, url: p.path, siteName: "Retake", type: "website", images: [OG_IMAGE] },
  twitter: { card: "summary_large_image", title: p.title, description: p.description, images: [OG_IMAGE.url] },
})
