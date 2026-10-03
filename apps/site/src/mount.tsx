"use client"
// Starts a page's plain-DOM modules once React has hydrated the markup they
// work on. They change the DOM directly (React never renders those parts
// again), so the dock rewinds them the same way it did on the Vite site.
import { useEffect } from "react"
import { copyButtons, hero } from "./hero.ts"
import { island } from "./island.ts"
import { play } from "./play.ts"
import { pm } from "./pm.ts"
import type { PageName } from "./site.ts"

const started = new Set<PageName>()

export function Mount({ page }: { page: PageName }) {
  useEffect(() => {
    // Once per page load (React runs effects twice in development).
    if (started.has(page)) return
    started.add(page)
    // Room for the dock at the bottom when Retake is running the page (outside
    // the dock's frame the runtime is only `{ inert: true }`).
    const rt = window.__retake
    if (rt && !rt.inert) document.documentElement.classList.add("docked")
    if (page === "try") island()
    else {
      copyButtons()
      hero()
      pm()
      play()
    }
  }, [page])
  return null
}
