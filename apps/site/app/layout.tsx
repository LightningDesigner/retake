import type { Metadata } from "next"
import type { ReactNode } from "react"
import { SITE_URL } from "../src/site.ts"
import "../src/style.css"

// The base for the link-preview image's URL. The icon is app/icon.svg.
export const metadata: Metadata = { metadataBase: new URL(SITE_URL) }

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500&display=swap" rel="stylesheet" />
      </head>
      <body>{children}</body>
    </html>
  )
}
