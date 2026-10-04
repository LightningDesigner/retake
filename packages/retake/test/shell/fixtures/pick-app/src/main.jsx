import { useState } from "react"
import { createRoot } from "react-dom/client"
import s from "./Hero.module.css"

// A rough hand-drawn underline under one word (an svg with a path).
function Underline() {
  return (
    <svg className="underline" viewBox="0 0 200 22" preserveAspectRatio="none" aria-hidden="true">
      <path d="M2 14 C 40 4, 90 20, 130 10 S 190 8, 198 12" />
    </svg>
  )
}

function Header() {
  return (
    <header className="sticky top-0 z-50 flex items-center gap-4 px-6 bg-black/80">
      <a href="#features" className="nav-link">Features</a>
      <a href="#pricing" className="nav-link">Pricing</a>
    </header>
  )
}

function Hero({ shown }) {
  return (
    <section id="hero" className="hero">
      <div className="glow absolute inset-0 pointer-events-none" />
      <h1 className={s.title}>
        Ship <span className="accent">fast<Underline /></span> with less
      </h1>
      <p id="lede" className={`lede transition-all ${shown ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"}`}>A subtitle that fades and slides in.</p>
      <a className={s.cta} href="#start">Get started</a>
      <div><span className="badge">New</span></div>
    </section>
  )
}

function Card({ title, children }) {
  return (
    <article className="card">
      <h3 className="card-title">{title}</h3>
      <p className="card-body">{children}</p>
      <a className="link-overlay" href="#card" aria-label={title} />
    </article>
  )
}

function Features() {
  return (
    <section className="features">
      <Card title="Fast">Builds in a blink.</Card>
      <Card title="Small">Tiny bundles.</Card>
      <Card title="Typed">Types everywhere.</Card>
    </section>
  )
}

// A headline under a decorative halo: an aria-hidden overlay that does take
// pointer events (no pointer-events: none), over the words.
function Launch() {
  return (
    <section className="launch relative">
      <h2 className="headline">
        <span className="word">Launch</span> <span className="word">faster</span>
      </h2>
      <div className="halo absolute inset-0" aria-hidden="true" />
    </section>
  )
}

function Status({ go }) {
  return (
    <div className="row">
      <h4 className="still-title">Static heading</h4>
      <span className={`pill ${go ? "go" : ""}`}>moving</span>
    </div>
  )
}

class FancyCard extends HTMLElement {
  connectedCallback() {
    if (this.shadowRoot) return
    const root = this.attachShadow({ mode: "open" })
    root.innerHTML = `<style>button{padding:10px 16px;margin:24px}</style><button class="inner">Shadow button</button>`
  }
}
customElements.get("fancy-card") || customElements.define("fancy-card", FancyCard)

// ?story: a marketing story section, as a real one was built: a drawn
// underline (an svg with pointer-events: none) under a word, with a faint map
// image laid over it; a quote that floats, with an emphasised word and an
// underlined word of their own; a word that pops in later (opacity 0 until then);
// a heading over a map image with a thin underline drawn under one word (span >
// svg > g > path, the stroke only, the svg out of hit testing and below the word).
const MAP = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="#3a4a6a"/></svg>')
function Story() {
  return (
    <section className="story">
      <div className="world">
        <span className="rough">everywhere<svg className="rough-svg" viewBox="0 0 200 20" preserveAspectRatio="none" aria-hidden="true"><g><path className="rough-path" d="M2 12 C 50 4, 120 18, 198 8" /></g></svg></span>
        <img className="world-map" src={MAP} alt="" />
      </div>
      <blockquote className="quote">
        <p>Notes that <strong className="em">land</strong> on the <span className="rough-underline">right<svg className="ru-svg" viewBox="0 0 100 12" preserveAspectRatio="none" aria-hidden="true"><path className="ru-path" d="M1 8 C 30 2, 60 11, 99 5" /></svg></span> element.</p>
      </blockquote>
      <p className="lead-in">Plain words, then <em className="pop">pop</em></p>
      <div className="sherpa-world-map">
        <img className="sherpa-world-map-image" src={MAP} alt="" />
        <div className="sherpa-world-map-heading">
          <h3 className="font-heading">Stories that travel <span className="sherpa-rough-underline">far<svg viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true"><g><path d="M1 6 C 30 2, 60 9, 99 4" /></g></svg></span></h3>
        </div>
      </div>
    </section>
  )
}

function App() {
  const [shown, setShown] = useState(false)
  const [go, setGo] = useState(false)
  const [menu, setMenu] = useState(false)
  return (
    <>
      <Header />
      {location.search.includes("story") && <Story />}
      <main>
        <div className="relative">
          <Hero shown={shown} />
          {/* A closed menu sheet: invisible (opacity 0), but still on top. */}
          <div className="menu-sheet" style={{ opacity: menu ? 1 : 0 }} data-open={menu} />
        </div>
        <div className="row">
          <button id="show" onClick={() => setShown(true)}>Show</button>
          <button id="go" onClick={() => setGo(true)}>Go</button>
          <button id="menu" onClick={() => setMenu((m) => !m)}>Menu</button>
        </div>
        <Status go={go} />
        <Features />
        <Launch />
        <fancy-card></fancy-card>
        <iframe className="embed" title="embed" srcDoc="<button id='inner' style='margin:20px' onclick='parent.__innerClicks=(parent.__innerClicks||0)+1'>Inside an iframe</button>" />
        <div className="spacer" />
        <footer id="pricing" className="py-4 px-6"><p className="fine w-1/2">Footer text</p></footer>
      </main>
    </>
  )
}

createRoot(document.getElementById("root")).render(<App />)

// ?rsc: what a Next page looks like to the dock: a heading a server component
// wrote (its React 19 stack is a server frame), passed as children into a
// client component (whose stack is a served, source-mapped file).
if (location.search.includes("rsc")) {
  const wrap = document.createElement("div")
  wrap.className = "client-wrap"
  const h2 = document.createElement("h2")
  h2.className = "from-server"
  h2.textContent = "Written in app/page.jsx"
  wrap.appendChild(h2)
  document.body.appendChild(wrap)
  const room = document.createElement("div")
  room.style.height = "600px"
  document.body.appendChild(room)
  const stack = (...frames) => ({ stack: ["Error: react-stack-top-frame", ...frames].join("\n") })
  const Reveal = function Reveal() {}
  const Page = { name: "Page", env: "Server" }
  const client = { type: Reveal, _debugOwner: null, _debugStack: stack(`    at Reveal (${location.origin}/src/main.jsx:6:12)`), return: null }
  wrap.__reactFiber$fixture = { type: "div", _debugOwner: client, _debugStack: stack(`    at Reveal (${location.origin}/src/main.jsx:6:12)`), return: client }
  h2.__reactFiber$fixture = { type: "h2", _debugOwner: Page, _debugStack: stack("    at Page (about://React/Server/file:///project/.next/server/chunks/ssr/app_page_jsx_1a2b3c._.js:12:7)"), return: wrap.__reactFiber$fixture }
}

// ?next: an element in a Next App Router page, as React's fibers show it: the
// component that wrote it, then Next's own layout machinery up to the page.
if (location.search.includes("next")) {
  const card = document.createElement("div")
  card.className = "next-card"
  card.textContent = "In a Next page"
  document.body.prepend(card) // on top: clear of the dock
  const fn = (name) => Object.defineProperty(function () {}, "name", { value: name })
  const chain = ["PromoCard", "SegmentViewNode", "InnerLayoutRouter", "RenderFromTemplateContext", "ScrollAndFocusHandler", "OuterLayoutRouter", "HTTPAccessFallbackBoundary", "LoadingBoundary", "ClientPageRoot", "HomePage"]
  let owner = null
  for (const name of chain.slice().reverse()) owner = { type: fn(name), _debugOwner: owner, return: owner }
  card.__reactFiber$fixture = { type: "div", _debugOwner: owner, return: owner }
}

// ?turbo: a Next 15 (Turbopack) client page, as React's fibers show it: the
// <span> a motion library rendered (its stack is the library's code, bundled
// into the same chunk as the app's, /_next/static/chunks/_7506e531._.js, with
// an index source map), inside the component the app wrote (<motion.span> in
// app/hero.jsx).
if (location.search.includes("turbo")) {
  const span = document.createElement("span")
  span.className = "turbo-underline"
  span.textContent = "Drawn by a library"
  document.body.prepend(span)
  const chunk = `${location.origin}/_next/static/chunks/_7506e531._.js`
  const lib = `${location.origin}/_next/static/chunks/node_modules_next_dist_compiled_react-dom_1e674e59._.js`
  const stack = (...frames) => ({ stack: ["Error: react-stack-top-frame", ...frames].join("\n") })
  const fn = (name) => Object.defineProperty(function () {}, "name", { value: name })
  const hero = { type: fn("Hero"), _debugOwner: null, return: null, _debugStack: stack(`    at Page (${chunk}:20:5)`) }
  const motion = { type: { render: fn("MotionComponent") }, _debugOwner: hero, return: hero, _debugStack: stack(`    at exports.jsxDEV (${chunk}:3:9)`, `    at Hero (${chunk}:15:12)`, `    at Object.react_stack_bottom_frame (${lib}:13072:24)`) }
  span.__reactFiber$fixture = { type: "span", _debugOwner: motion, return: motion, _debugStack: stack(`    at exports.createElement (${lib}:1576:67)`, `    at useRender (${chunk}:6:12)`, `    at MotionComponent (${chunk}:9:12)`, `    at Object.react_stack_bottom_frame (${lib}:13072:24)`) }
  // The same, as a real Next 15.5 app has it: the library in a chunk of its
  // own (node_modules_….js), and below React's frames one from a script inline
  // in the page (Retake's runtime): F136.
  const split = document.createElement("span")
  split.className = "turbo-split"
  split.textContent = "Drawn by a library, own chunk"
  document.body.prepend(split)
  const libChunk = `${location.origin}/_next/static/chunks/node_modules_17760e31._.js`
  const below = [`    at Object.react_stack_bottom_frame (${lib}:13072:24)`, `    at renderWithHooks (${lib}:4097:28)`, `    at MessagePort.<anonymous> (${location.origin}/:269:17)`]
  const motion2 = { type: { render: fn("MotionComponent") }, _debugOwner: hero, return: hero, _debugStack: stack(`    at exports.jsxDEV (${libChunk}:203:88)`, `    at Hero (${chunk}:15:12)`, ...below) }
  const dom = { type: { render: fn("MotionDOMComponent") }, _debugOwner: motion2, return: motion2, _debugStack: stack(`    at exports.jsxs (${lib}:1953:74)`, `    at MotionDOMComponent (${libChunk}:6230:199)`, ...below) }
  split.__reactFiber$fixture = { type: "span", _debugOwner: dom, return: dom, _debugStack: stack(`    at exports.createElement (${lib}:1576:67)`, `    at useRender (${libChunk}:5518:191)`, `    at MotionDOMComponent (${libChunk}:6237:215)`, ...below) }
}
