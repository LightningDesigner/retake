"use client"
// The docs' few interactive parts: the copy buttons (src/copy.tsx), the
// package-manager tabs, and the sidebar (a list on wide screens, a select on phones).
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { CopyButton } from "../copy.tsx"
import { docked } from "../docked.ts"
import type { DocPage } from "./nav.ts"

export { CopyButton }

const PM_KEY = "retake-docs-pm"
const PMS = ["npm", "pnpm", "yarn", "bun"] as const
type Pm = (typeof PMS)[number]

// One command per package manager; the pick is shared by every set on the
// page and remembered for the next visit.
export function PmTabs({ commands, label }: { commands: Record<Pm, string>; label: string }) {
  const [pm, setPm] = useState<Pm>("npm")
  useEffect(() => {
    try {
      const saved = localStorage.getItem(PM_KEY)
      if (saved && (PMS as readonly string[]).includes(saved)) setPm(saved as Pm)
    } catch {}
    const on = (e: Event) => setPm((e as CustomEvent<Pm>).detail)
    window.addEventListener("retake-docs-pm", on)
    return () => window.removeEventListener("retake-docs-pm", on)
  }, [])
  const pick = (next: Pm) => {
    setPm(next)
    try {
      localStorage.setItem(PM_KEY, next)
    } catch {}
    window.dispatchEvent(new CustomEvent("retake-docs-pm", { detail: next }))
  }
  return (
    <div className="d-code d-tabs">
      <div className="d-code-head">
        <div className="d-tablist" role="tablist" aria-label={label}>
          {PMS.map((p) => (
            <button key={p} type="button" role="tab" aria-selected={pm === p} className="mono" onClick={() => pick(p)}>
              {p}
            </button>
          ))}
        </div>
        <CopyButton text={commands[pm]} label={`Copy the ${pm} command`} />
      </div>
      <pre className="mono" role="tabpanel"><code>{commands[pm]}</code></pre>
    </div>
  )
}

// The sidebar: a list beside the page on wide screens; on phones a select
// above it, which goes to the page picked. The page on show is marked.
export function Sidebar({ groups }: { groups: Array<{ name: string; pages: DocPage[] }> }) {
  const path = usePathname().replace(/\/$/, "") || "/"
  const router = useRouter()
  useEffect(() => {
    docked()
  }, [])
  return (
    <div className="d-side">
      <label className="d-pick">
        <span className="sr">Docs page</span>
        <select value={path} onChange={(e) => router.push(e.target.value)}>
          {groups.map((g) => (
            <optgroup key={g.name} label={g.name}>
              {g.pages.map((p) => <option key={p.path} value={p.path}>{p.label}</option>)}
            </optgroup>
          ))}
        </select>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
      </label>
      <nav className="d-side-nav" aria-label="Docs">
        {groups.map((g) => (
          <div className="d-group" key={g.name}>
            <div className="d-group-name">{g.name}</div>
            <ul>
              {g.pages.map((p) => (
                <li key={p.path}>
                  <Link href={p.path} aria-current={p.path === path ? "page" : undefined}>{p.label}</Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
    </div>
  )
}
