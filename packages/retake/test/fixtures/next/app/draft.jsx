"use client"
// A field saved to localStorage as you type (storage across frames).
import { useEffect, useState } from "react"
export default function Draft() {
  const [v, setV] = useState("")
  useEffect(() => setV(localStorage.getItem("draft") || ""), [])
  return <input id="draft" autoComplete="off" value={v} onChange={(e) => (setV(e.target.value), localStorage.setItem("draft", e.target.value))} />
}
