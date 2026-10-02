"use client"
// A steady stream of Math.random() calls, a lazily loaded piece that takes
// one more when it mounts, and a chunk asked for later that takes another: if
// a chunk arrives at another virtual moment on replay, every later number
// differs (F48).
import { useEffect } from "react"
import dynamic from "next/dynamic"
import { L } from "./fx"
const Lazy = dynamic(() => import("./lazy"), { ssr: false })
export default function Randoms() {
  useEffect(() => {
    const id = setInterval(() => L("random", Math.random()), 30)
    // A chunk asked for once the page runs: it arrives whenever the network has it.
    const late = setTimeout(() => import("./late").then((m) => m.default()), 600)
    return () => (clearInterval(id), clearTimeout(late))
  }, [])
  return <Lazy />
}
