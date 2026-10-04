"use client"
import { useEffect, useRef, useState } from "react"

// Five bars on CSS keyframes, staggered, plus one on the Web Animations API.
// Replay starts them all again.
export default function Bars() {
  const [run, setRun] = useState(0)
  const waapi = useRef(null)
  useEffect(() => {
    waapi.current.animate([{ transform: "scaleY(0.1)" }, { transform: "scaleY(1)" }], { duration: 600, delay: 400, easing: "ease-out", fill: "both" })
  }, [run])
  return (
    <main>
      <button id="replay" onClick={() => setRun((n) => n + 1)}>
        Replay
      </button>
      <div className="bars" key={run}>
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="bar" style={{ "--i": i }} />
        ))}
        <div className="bar waapi" ref={waapi} />
      </div>
    </main>
  )
}
