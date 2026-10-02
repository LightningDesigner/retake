"use client"
// Typed out by timers from hydration on: where it is at a moment tells when
// hydration ran on the virtual clock (F47).
import { useEffect, useState } from "react"
import { L } from "./fx"
const TEXT = "Retake keeps every moment of your app"
export default function Headline() {
  const [n, setN] = useState(0)
  useEffect(() => {
    let i = 0
    const id = setInterval(() => {
      i++
      setN(i)
      L("headline", i)
      if (i >= TEXT.length) clearInterval(id)
    }, 40)
    return () => clearInterval(id)
  }, [])
  return <p id="headline">{TEXT.slice(0, n)}</p>
}
