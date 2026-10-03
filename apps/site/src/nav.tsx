// The header on every page: the name (and the npm download count), the two
// tabs (Overview, Playground) in the middle, and the command to run with a copy
// button. Docs and GitHub are quiet links in the footer (the docs' header
// adds GitHub). Links to the site's pages use target="_top": in Retake a page runs
// in the dock's frame, and the next page should load as a page of its own
// (with its own dock), not inside this one's frame.
import { CopyButton } from "./copy.tsx"
import { downloads } from "./downloads.ts"

export const GITHUB = "https://github.com/LightningDesigner/retake"
export const NPM = "https://www.npmjs.com/package/retake-dev"
export const INSTALL = "npx retake-dev ."

export type Tab = "overview" | "playground" | "docs"

const TABS: Array<{ id: Tab; label: string; href: string }> = [
  { id: "overview", label: "Overview", href: "/" },
  { id: "playground", label: "Playground", href: "/playground" },
]

export const Mark = () => <span className="mark" aria-hidden="true"><i></i></span>

export async function Header({ current }: { current: Tab }) {
  const count = await downloads()
  return (
    <header className={current === "docs" ? "top wide" : "top"}>
      <div className="top-brand">
        <a className="brand" href="/" target="_top"><Mark />Retake</a>
        {count > 0 && <a className="count" href={NPM} target="_blank" rel="noreferrer">{count.toLocaleString("en-US")} downloads</a>}
      </div>
      <nav className="tabs" aria-label="Site">
        {TABS.map((t) => (
          <a key={t.id} href={t.href} target="_top" aria-current={t.id === current ? "page" : undefined}>{t.label}</a>
        ))}
      </nav>
      <div className="top-end">
        {current === "docs" && <a className="quiet" href={GITHUB} target="_blank" rel="noreferrer">GitHub</a>}
        <div className="install">
          <code className="mono"><span className="p" aria-hidden="true">$</span>{INSTALL}</code>
          <CopyButton text={INSTALL} label="Copy the command" />
        </div>
      </div>
    </header>
  )
}

// The footer's line of quiet links, on the overview and the playground.
export function FootLinks() {
  return (
    <p className="foot-line">
      <a href="/docs" target="_top">Docs</a>
      <a href={GITHUB} target="_blank" rel="noreferrer">GitHub</a>
      <a href={NPM} target="_blank" rel="noreferrer">npm</a>
      <a href={`${GITHUB}/blob/main/LICENSE`} target="_blank" rel="noreferrer">PolyForm Shield 1.0.0</a>
    </p>
  )
}
