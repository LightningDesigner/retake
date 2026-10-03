"use client"
// Starts a page's plain-DOM modules once React has hydrated the markup they
// work on. They change the DOM directly (React never renders those parts
// again), so the dock rewinds them the same way it did on the Vite site.
import { useEffect } from "react"
import { docked } from "./docked.ts"
import { play } from "./play.ts"
import type { PageName } from "./site.ts"
import { threads } from "./threads.ts"

const started = new Set<PageName>()

export function Mount({ page }: { page: PageName }) {
  useEffect(() => {
    // Once per page load (React runs effects twice in development).
    if (started.has(page)) return
    started.add(page)
    docked()
    if (page === "playground") play()
    else threads()
  }, [page])
  return null
}
