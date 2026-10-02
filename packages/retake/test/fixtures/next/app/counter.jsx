"use client"
import { useEffect, useState } from "react"
import Link from "next/link"
import { bump } from "./actions"
import { L } from "./fx"
export default function Counter() {
  const [n, setN] = useState(0)
  const [tick, setTick] = useState(0)
  const [srv, setSrv] = useState(null)
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(id)
  }, [])
  return (
    <div>
      <button id="inc" onClick={() => (setN(n + 1), L("inc", n + 1))}>
        count {n}
      </button>
      <span id="tick">tick {tick}</span>
      <button id="act" onClick={async () => setSrv(await bump(n))}>
        action
      </button>
      <span id="srv">{srv}</span>
      <button id="slow" onClick={() => fetch("/api/slow?id=" + (window.__slowId || "x")).then((r) => r.json()).then((j) => L("slow", j.id))}>
        slow
      </button>
      <Link id="to-about" href="/about">
        about
      </Link>
    </div>
  )
}
