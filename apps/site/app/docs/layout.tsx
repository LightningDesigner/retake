// The docs: the site's header, the sidebar (a select on phones) and the page.
// Every page is a static server component; only the copy buttons, the
// package-manager tabs and the sidebar run on the client.
import type { Metadata } from "next"
import type { ReactNode } from "react"
import { Sidebar } from "../../src/docs/client.tsx"
import { GROUPS } from "../../src/docs/nav.ts"
import { Header } from "../../src/nav.tsx"
import "../../src/docs/docs.css"

export const metadata: Metadata = {
  title: { template: "%s · Retake docs", default: "Retake docs" },
}

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Header current="docs" />
      <div className="docs">
        <Sidebar groups={GROUPS} />
        <main className="d-main" id="content">{children}</main>
      </div>
    </>
  )
}
