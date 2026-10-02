"use client"
import { useEffect } from "react"
import { L } from "./fx"
export default function Lazy() {
  useEffect(() => L("lazy", Math.random()), [])
  return <span id="lazy">lazy</span>
}
