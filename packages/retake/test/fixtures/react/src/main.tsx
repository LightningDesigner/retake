import { StrictMode, useEffect, useRef, useState } from "react"
import { createRoot } from "react-dom/client"
import { createBrowserRouter, RouterProvider, Link, Outlet, useLocation } from "react-router-dom"
import { motion, AnimatePresence } from "framer-motion"
import gsap from "gsap"
import { useSpring, animated } from "@react-spring/web"
import lottie from "lottie-web"
import data from "./lottie.json"

const sample = (sel: string) => {
  const el = document.querySelector(sel) as HTMLElement | null
  if (!el) return null
  const cs = getComputedStyle(el)
  return { transform: cs.transform, opacity: cs.opacity }
}
;(window as any).__sample = () => ({
  path: location.pathname,
  motion: sample("#m"), presence: !!document.querySelector("#p"),
  gsap: sample("#g"), spring: sample("#s"),
  lottie: (window as any).__lottie ? Math.round((window as any).__lottie.currentFrame * 100) / 100 : null,
})

function Layout() {
  const loc = useLocation()
  return <div>
    <nav style={{ display: "flex", gap: 12 }}>
      <Link id="nav-home" to="/">home</Link><Link id="nav-anim" to="/anim">anim</Link><Link id="nav-about" to="/about">about</Link>
    </nav>
    <div id="route">{loc.pathname}</div>
    <Outlet />
  </div>
}
function Anim() {
  const [on, setOn] = useState(false)
  const g = useRef<HTMLDivElement>(null)
  const l = useRef<HTMLDivElement>(null)
  const spring = useSpring({ x: on ? 300 : 0, config: { tension: 120, friction: 14 } })
  useEffect(() => {
    const a = lottie.loadAnimation({ container: l.current!, renderer: "svg", loop: false, autoplay: false, animationData: data })
    ;(window as any).__lottie = a
    return () => a.destroy()
  }, [])
  const go = () => {
    setOn((v) => !v)
    gsap.to(g.current, { x: on ? 0 : 300, duration: 1, ease: "power1.inOut" })
    ;(window as any).__lottie.goToAndPlay(0, true)
  }
  return <div>
    <button id="go" onClick={go}>animate</button>
    <motion.div id="m" animate={{ x: on ? 300 : 0, opacity: on ? 0.3 : 1 }} transition={{ duration: 1 }} style={{ width: 30, height: 30, background: "tomato" }} />
    <AnimatePresence>{!on && <motion.div id="p" exit={{ opacity: 0, scale: 0.5 }} transition={{ duration: 0.8 }} style={{ width: 30, height: 30, background: "purple" }} />}</AnimatePresence>
    <div id="g" ref={g} style={{ width: 30, height: 30, background: "teal" }} />
    <animated.div id="s" style={{ x: spring.x, width: 30, height: 30, background: "gold" }} />
    <div ref={l} style={{ width: 400, height: 60 }} />
  </div>
}
const router = createBrowserRouter([{ path: "/", element: <Layout />, children: [
  { index: true, element: <p>home page</p> }, { path: "anim", element: <Anim /> }, { path: "about", element: <p id="about">about page</p> }] }])
createRoot(document.getElementById("root")!).render(<StrictMode><RouterProvider router={router} /></StrictMode>)
