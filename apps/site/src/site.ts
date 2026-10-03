// Each page's title and description: its metadata, and the dock's in the
// deployed build (app/retake-dock), so link previews read as the page.
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
    description: "A time machine for your dev server: Vite, Next.js, React Router, Remix, Astro, SvelteKit, Nuxt. Drag back and your app is at that moment. Press + to try something else from there.",
  },
  try: {
    path: "/try",
    title: "Retake playground",
    description: "Click the island, then drag Retake's timeline back to see every frame of the morph.",
  },
} satisfies Record<string, Page>

export type PageName = keyof typeof PAGES

export const isPage = (name: string): name is PageName => Object.hasOwn(PAGES, name)

// A page's metadata: title, description and the link-preview card (the image
// itself is app/opengraph-image.tsx).
export const pageMetadata = (p: Page): Metadata => ({
  title: p.title,
  description: p.description,
  openGraph: { title: p.title, description: p.description, url: p.path, siteName: "Retake", type: "website" },
  twitter: { card: "summary_large_image", title: p.title, description: p.description },
})
