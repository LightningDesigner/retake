// Motion springs, each written a different way: physics (stiffness/damping),
// visualDuration + bounce, duration + bounce, and Motion's default spring for x
// (no transition). #go sends every box 0 → 300 (y for #visual).
import { useState } from "react"
import { createRoot } from "react-dom/client"
import { motion } from "motion/react"

const box = (background) => ({ width: 40, height: 40, margin: "10px 0", borderRadius: 8, background })

function App() {
  const [on, setOn] = useState(false)
  return (
    <div>
      <button id="go" onClick={() => setOn((v) => !v)}>go</button>
      <motion.div id="physics" animate={{ x: on ? 300 : 0 }} transition={{ type: "spring", stiffness: 300, damping: 10 }} style={box("#4f46e5")} />
      <motion.div id="visual" animate={{ y: on ? 120 : 0 }} transition={{ type: "spring", visualDuration: 0.5, bounce: 0.45 }} style={box("#059669")} />
      <motion.div id="dur" animate={{ x: on ? 300 : 0 }} transition={{ type: "spring", duration: 0.8, bounce: 0.35 }} style={box("#db2777")} />
      <motion.div id="default" animate={{ x: on ? 300 : 0 }} style={box("#f59e0b")} />
      <motion.div id="tween" animate={{ x: on ? 300 : 0 }} transition={{ duration: 0.6, ease: "easeOut" }} style={box("#64748b")} />
    </div>
  )
}

createRoot(document.getElementById("root")).render(<App />)

// Every style write on the boxes, with its (virtual) time: window.__writes.
window.__writes = []
new MutationObserver((list) => {
  for (const m of list) window.__writes.push({ t: performance.now(), id: m.target.id, transform: m.target.style.transform })
}).observe(document.getElementById("root"), { subtree: true, attributes: true, attributeFilter: ["style"] })
