// The docs' building blocks, rendered on the server: the page frame (title,
// "On this page", previous and next), headings with anchors, code blocks with
// a copy button, and callouts.
import Link from "next/link"
import type { ReactNode } from "react"
import { CopyButton } from "./client.tsx"
import { PAGES, docPage } from "./nav.ts"

export interface TocItem {
  id: string
  label: string
}

export function DocArticle({ slug, lede, toc, children }: { slug: string; lede: ReactNode; toc: TocItem[]; children: ReactNode }) {
  const p = docPage(slug)
  const i = PAGES.indexOf(p)
  const prev = PAGES[i - 1]
  const next = PAGES[i + 1]
  return (
    <div className="d-page">
      <article className="d-article">
        <header className="d-head">
          <h1>{p.title}</h1>
          <p className="d-lede">{lede}</p>
        </header>
        {children}
        <nav className="d-pager" aria-label="Previous and next page">
          {prev ? (
            <Link className="d-pager-link" href={prev.path}>
              <span className="mono">Previous</span>
              {prev.label}
            </Link>
          ) : <span />}
          {next ? (
            <Link className="d-pager-link next" href={next.path}>
              <span className="mono">Next</span>
              {next.label}
            </Link>
          ) : <span />}
        </nav>
      </article>
      {toc.length > 1 && (
        <aside className="d-toc" aria-label="On this page">
          <div className="d-toc-title mono">On this page</div>
          <ul>
            {toc.map((t) => (
              <li key={t.id}><a href={`#${t.id}`}>{t.label}</a></li>
            ))}
          </ul>
        </aside>
      )}
    </div>
  )
}

export function H2({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2 id={id} className="d-h2">
      <a href={`#${id}`}>{children}</a>
    </h2>
  )
}

export function H3({ id, children }: { id?: string; children: ReactNode }) {
  return id ? (
    <h3 id={id} className="d-h3">
      <a href={`#${id}`}>{children}</a>
    </h3>
  ) : <h3 className="d-h3">{children}</h3>
}

// A shell line's comment ("# like this") in a muted colour; everything else as it is.
function highlight(code: string, lang: string) {
  if (lang !== "sh" && lang !== "toml") return code
  return code.split("\n").flatMap((line, i) => {
    const at = line.search(/(^|\s)#/)
    const parts: ReactNode[] = i ? ["\n"] : []
    if (at < 0) parts.push(line)
    else parts.push(line.slice(0, at), <span key={i} className="d-c">{line.slice(at)}</span>)
    return parts
  })
}

// A code block. `title` names it (a file name, "Terminal"); `copy` is what the
// button copies (default: the code itself).
export function Code({ children, lang = "sh", title, copy }: { children: string; lang?: string; title?: string; copy?: string }) {
  const code = children.replace(/^\n+|\s+$/g, "")
  return (
    <div className="d-code">
      <div className="d-code-head">
        <span className="d-code-title mono">{title || lang}</span>
        <CopyButton text={copy ?? code} label={title ? `Copy ${title}` : "Copy the code"} />
      </div>
      <pre className="mono"><code>{highlight(code, lang)}</code></pre>
    </div>
  )
}

export function Note({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "warn" }) {
  return <div className={`d-note ${tone}`}>{children}</div>
}

// A table. On a phone each row becomes a block, its cells labelled by their
// column (data-label); never wider than the page.
export function Table({ head, rows, className }: { head: string[]; rows: ReactNode[][]; className?: string }) {
  return (
    <div className={`d-table${className ? ` ${className}` : ""}`}>
      <table>
        <thead>
          <tr>{head.map((h) => <th key={h} scope="col">{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>{r.map((c, j) => <td key={j} data-label={head[j]}>{c}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// Inline code wraps only between words: a short token like `retake-dev` or a URL
// never splits at its hyphen, and a box split over two lines keeps its edges.
const words = (text: string) =>
  text.split(/(\s+)/).map((w, i) => (w.trim() && w.length <= 28 && /[-/:]/.test(w) ? <span className="d-nw" key={i}>{w}</span> : w))
export const C = ({ children }: { children: ReactNode }) => {
  const parts = Array.isArray(children) ? children : [children]
  const text = parts.every((p) => typeof p === "string") ? parts.join("") : null
  return <code className="d-ic mono">{text === null ? children : words(text)}</code>
}
export const K = ({ children }: { children: ReactNode }) => <kbd>{children}</kbd>
