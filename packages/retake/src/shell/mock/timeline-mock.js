// MOCK — not part of the dock. A stand-in for the runtime's timeline API
// (CONTRACT.md: timeline(), clipAt(), isInteractive(), setToolActive()) for
// shell specs to run against before or apart from the real one. Specs inject
// it into every frame with page.addInitScript({ path }). It fills in only what
// the runtime is missing, so with the real API present it does nothing.
//
// Clips: every click on #toggle starts a 300ms opacity and a 600ms transform
// transition on #card, as the dock fixture's CSS does. Markers come from the
// recorded events.
;(function () {
  if (!/[?&]__wb=app\b/.test(location.search)) return
  const install = () => {
    const PT = window.__wayback
    if (!PT || !PT.state || !PT.history) return false
    if (!PT.timeline) {
      PT.__mock = true
      PT.timeline = () => {
        const s = PT.state()
        const h = PT.history()
        const markers = []
        const clips = []
        for (const ev of h.events) {
          if (ev.type === "pointerdown") markers.push({ t: ev.t, kind: "click", label: "MOCK click", selector: "" })
          if (ev.type === "keydown") markers.push({ t: ev.t, kind: "key", label: ev.key })
          const press = ev.type === "click" || ev.type === "pointerdown"
          const again = clips.some((c) => Math.abs(c.start - ev.t) < 80)
          if (press && !again && String(ev.path) === String(pathOfToggle())) {
            clips.push({ id: "m" + clips.length, start: ev.t, end: ev.t + 300, kind: "transition", label: "opacity (MOCK)", selector: "#card", component: "Card", property: "opacity" })
            clips.push({ id: "m" + clips.length, start: ev.t, end: ev.t + 600, kind: "transition", label: "transform (MOCK)", selector: "#card", component: "Card", property: "transform" })
          }
        }
        return { now: s.now, end: s.end, viewport: { w: innerWidth, h: innerHeight }, markers, clips }
      }
    }
    if (!PT.clipAt)
      PT.clipAt = (t, selector) => {
        const c = PT.timeline().clips.find((c) => c.start <= t && t <= c.end && (!selector || c.selector === selector))
        return c ? { clip: c, offset: t - c.start } : null
      }
    if (!PT.setToolActive) PT.setToolActive = (on) => (PT.__toolActive = !!on)
    return true
  }
  // The recorded path of #toggle, in the runtime's child-index form.
  function pathOfToggle() {
    const el = document.getElementById("toggle")
    const out = []
    for (let n = el; n && n !== document.documentElement; n = n.parentNode) out.unshift([...n.parentNode.childNodes].indexOf(n))
    return out
  }
  if (!install()) {
    const t = setInterval(() => install() && clearInterval(t), 5)
  }
})()
