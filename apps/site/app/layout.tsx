import type { Metadata } from "next"
import { Geist, Geist_Mono, Newsreader } from "next/font/google"
import type { ReactNode } from "react"
import { SITE_URL } from "../src/site.ts"
import "../src/style.css"

// Newsreader (a serif, with optical sizes) for headings and the pitch, Geist
// for text, Geist Mono for commands. Self-hosted by next/font at build time.
const serif = Newsreader({ subsets: ["latin"], axes: ["opsz"], style: ["normal", "italic"], variable: "--font-serif", display: "swap" })
const sans = Geist({ subsets: ["latin"], variable: "--font-sans", display: "swap" })
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" })

// The base for the link-preview image's URL. The icon is app/icon.svg.
export const metadata: Metadata = { metadataBase: new URL(SITE_URL) }

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  )
}
