// "Try it": a small prototype flow for Retake to rewind. It deliberately uses
// every kind of motion Retake handles: CSS transitions (card exit, plan pick,
// the 150ms heart pop), Web Animations (card enter, progress), a rAF spring
// (the check badge), a streamed fetch reply, and Math.random / Date values.
const root = document.getElementById("try")
if (root) {
  const cards = [...root.querySelectorAll(".card")]
  const bars = [...root.querySelectorAll(".progress i")]
  const $ = (id) => document.getElementById(id)
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches
  let step = 0
  let plan = null
  let busy = false

  const two = (n) => String(n).padStart(2, "0")
  const hms = (d) => `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`

  // Date-driven: the prototype's own clock.
  const clock = $("p-clock")
  const tickClock = () => (clock.textContent = hms(new Date()))
  tickClock()
  setInterval(tickClock, 1000)

  function paintProgress(animate) {
    bars.forEach((b, i) => {
      const on = i <= step
      if (on && !b.classList.contains("on") && animate && !reduced) {
        b.animate([{ width: "18px", opacity: 0.4 }, { width: "36px", opacity: 1 }], { duration: 420, easing: "cubic-bezier(.2,.8,.2,1)", fill: "forwards" })
      } else if (!on) b.getAnimations().forEach((a) => a.cancel())
      b.classList.toggle("on", on)
    })
  }

  function go(to) {
    if (busy || to === step) return
    busy = true
    const from = cards[step]
    const next = cards[to]
    // Exit: CSS transition.
    from.classList.add("leaving")
    from.addEventListener("transitionend", function done(e) {
      if (e.target !== from || e.propertyName !== "opacity") return
      from.removeEventListener("transitionend", done)
      from.hidden = true
      from.classList.remove("leaving")
      next.hidden = false
      step = to
      paintProgress(true)
      // Enter: Web Animations.
      const a = next.animate([{ opacity: 0, transform: "translateX(28px)" }, { opacity: 1, transform: "none" }], { duration: reduced ? 1 : 320, easing: "cubic-bezier(.2,.8,.2,1)" })
      a.onfinish = () => { busy = false; if (to === 2) finish() }
    })
  }

  // Step 1: pick a plan.
  root.querySelectorAll(".plan").forEach((b) =>
    b.addEventListener("click", () => {
      plan = b.dataset.plan
      root.querySelectorAll(".plan").forEach((x) => x.setAttribute("aria-checked", String(x === b)))
      cards[0].querySelector("[data-next]").disabled = false
    }),
  )
  root.querySelectorAll("[data-next]").forEach((b) => b.addEventListener("click", () => go(step + 1)))

  // Step 2: a reply streamed token by token.
  const chat = $("chat")
  const ask = $("ask")
  const like = $("like")
  ask.addEventListener("click", async () => {
    ask.disabled = true
    const bubble = document.createElement("div")
    bubble.className = "msg bot streaming"
    chat.append(bubble)
    try {
      const res = await fetch(`/api/reply?seed=${Math.floor(Math.random() * 3)}`)
      if (!res.ok || !res.body) throw new Error(String(res.status))
      const reader = res.body.getReader()
      const dec = new TextDecoder()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        bubble.textContent += dec.decode(value, { stream: true })
      }
    } catch {
      // The built site has no demo endpoint: say so instead of failing silently.
      bubble.textContent = "The reply comes from a dev-only endpoint. Run the site with pnpm dev to see it stream."
    }
    bubble.classList.remove("streaming")
    like.disabled = false
  })

  // The 150ms micro-interaction: too quick to judge live, easy to scrub.
  like.addEventListener("click", () => {
    like.setAttribute("aria-pressed", String(like.getAttribute("aria-pressed") !== "true"))
    like.classList.add("pop")
    setTimeout(() => like.classList.remove("pop"), 150)
  })

  // Step 3: random order id, Date timestamp, and a spring on rAF.
  const ok = $("ok")
  function finish() {
    $("p-plan").textContent = plan || "Starter"
    $("p-order").textContent = "RT-" + String(Math.floor(1000 + Math.random() * 9000))
    $("p-at").textContent = hms(new Date())
    spring(ok)
  }
  function spring(el) {
    if (reduced) return void (el.style.transform = "scale(1)")
    let x = 0, v = 0, last = performance.now()
    const k = 260, c = 14 // stiffness, damping (mass 1)
    const frame = (now) => {
      const dt = Math.min((now - last) / 1000, 1 / 30)
      last = now
      v += (-k * (x - 1) - c * v) * dt
      x += v * dt
      el.style.transform = `scale(${x.toFixed(4)})`
      if (Math.abs(x - 1) > 0.001 || Math.abs(v) > 0.01) requestAnimationFrame(frame)
      else el.style.transform = "scale(1)"
    }
    requestAnimationFrame(frame)
  }

  $("restart").addEventListener("click", () => {
    if (busy) return
    cards[2].hidden = true
    cards[0].hidden = false
    ok.style.transform = "scale(0)"
    chat.querySelectorAll(".bot").forEach((m) => m.remove())
    ask.disabled = false
    like.disabled = true
    like.setAttribute("aria-pressed", "false")
    plan = null
    root.querySelectorAll(".plan").forEach((x) => x.setAttribute("aria-checked", "false"))
    cards[0].querySelector("[data-next]").disabled = true
    step = 0
    paintProgress(false)
  })

  paintProgress(false)
}
