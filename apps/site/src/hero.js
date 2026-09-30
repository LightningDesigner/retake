// Copy buttons.
document.querySelectorAll("[data-copy]").forEach((b) =>
  b.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(b.dataset.copy); b.textContent = "Copied"; setTimeout(() => (b.textContent = "Copy"), 1200) } catch {}
  }),
)

// Hero: timelines streaming left to right. A playhead runs, rewinds (the
// threads retract behind it), then a new branch splits off from where it
// stopped. On repeat.
;(() => {
  const c = document.getElementById("threads")
  const ctx = c.getContext("2d")
  const tEl = document.getElementById("t")
  const dirEl = document.getElementById("dir")
  let W, H, dpr
  const COLORS = ["#52a8ff", "#ffb224", "#ff4d8d", "#7ee7b8", "#c9a6ff"]
  let branches, head, phase, phaseT, rewindTo, clockMs, rewinds

  function resize() {
    dpr = Math.min(devicePixelRatio || 1, 2)
    W = c.clientWidth; H = c.clientHeight
    c.width = W * dpr; c.height = H * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }
  function reset() {
    branches = []
    // Background threads: faint, many.
    for (let i = 0; i < 38; i++) {
      branches.push({ y0: (i + 0.5) * (H / 38), y1: null, from: -50, ghost: true, amp: 6 + Math.random() * 18, f: 0.002 + Math.random() * 0.004, ph: Math.random() * 6 })
    }
    const main = { y0: H * 0.5, from: -50, color: COLORS[0], amp: 14, f: 0.004, ph: 0, main: true }
    branches.push(main)
    // A couple of timelines that already split off earlier, dotted past their ends.
    branches.push({ parent: main, off: -H * 0.2, fork: W * 0.03, from: W * 0.03, end: W * 0.46, color: COLORS[2] })
    branches.push({ parent: main, off: H * 0.22, fork: W * 0.01, from: W * 0.01, end: W * 0.3, color: COLORS[3] })
    head = W * 0.08; phase = "play"; phaseT = 0; clockMs = 0; rewinds = 0
  }
  // A branch follows its parent exactly up to the fork, then eases away.
  function yAt(b, x) {
    let y = b.parent ? yAt(b.parent, x) : b.y0 + Math.sin(x * b.f + b.ph + performance.now() * 0.0004) * b.amp
    if (b.fork != null && x > b.fork) {
      const k = Math.min(1, (x - b.fork) / 180)
      y += b.off * k * k * (3 - 2 * k)
    }
    return y
  }
  function draw() {
    ctx.clearRect(0, 0, W, H)
    // Grid.
    ctx.strokeStyle = "rgba(255,255,255,.035)"; ctx.lineWidth = 1
    for (let x = 0; x < W; x += 64) { ctx.beginPath(); ctx.moveTo(x + .5, 0); ctx.lineTo(x + .5, H); ctx.stroke() }
    for (const b of branches) {
      const end = b.ghost ? W + 50 : Math.min(head, b.end ?? Infinity)
      if (end <= b.from) continue
      ctx.beginPath()
      for (let x = b.from; x <= end; x += 6) { const y = b.ghost ? b.y0 + Math.sin(x * b.f + b.ph + performance.now() * 0.0003) * b.amp : yAt(b, x); x === b.from ? ctx.moveTo(x, y) : ctx.lineTo(x, y) }
      if (b.ghost) { ctx.strokeStyle = "rgba(120,160,255,.085)"; ctx.lineWidth = 1; ctx.shadowBlur = 0 }
      else { ctx.strokeStyle = b.color; ctx.lineWidth = b.main ? 3 : 2.4; ctx.shadowColor = b.color; ctx.shadowBlur = 22 }
      ctx.stroke()
      ctx.shadowBlur = 0
      // Abandoned futures: dotted, dim.
      if (!b.ghost && b.end != null && b.end > head) {
        ctx.setLineDash([2, 6]); ctx.beginPath()
        for (let x = head; x <= b.end; x += 6) { const y = yAt(b, x); x === head ? ctx.moveTo(x, y) : ctx.lineTo(x, y) }
        ctx.strokeStyle = b.color + "55"; ctx.lineWidth = 1.2; ctx.stroke(); ctx.setLineDash([])
      }
    }
    // Sparks thrown off the playhead.
    for (const p of sparks) {
      ctx.globalAlpha = Math.max(0, p.life)
      ctx.fillStyle = p.c
      ctx.fillRect(p.x, p.y, p.s, p.s)
    }
    ctx.globalAlpha = 1
    // Playhead.
    const rewinding = phase === "rewind"
    if (rewinding) {
      for (let i = 0; i < 26; i++) {
        const y = (i / 26) * H + ((performance.now() * 0.05 + i * 37) % 40)
        const len = 60 + ((i * 53) % 220)
        const gr = ctx.createLinearGradient(head, 0, head + len, 0)
        gr.addColorStop(0, "rgba(255,178,36,.5)"); gr.addColorStop(1, "transparent")
        ctx.fillStyle = gr; ctx.fillRect(head, y, len, 1)
      }
    }
    const hc = rewinding ? "#ffb224" : "#ffffff"
    const g = ctx.createLinearGradient(0, 0, 0, H)
    g.addColorStop(0, "transparent"); g.addColorStop(.5, hc); g.addColorStop(1, "transparent")
    ctx.fillStyle = g; ctx.fillRect(head - 1, 0, 2, H)
    if (rewinding) { ctx.fillStyle = "rgba(255,178,36,.07)"; ctx.fillRect(head, 0, 90, H) }
    for (const b of branches) if (!b.ghost && head >= b.from && head <= (b.end ?? Infinity)) {
      ctx.beginPath(); ctx.arc(head, yAt(b, head), 3.5, 0, 7); ctx.fillStyle = "#fff"; ctx.shadowColor = hc; ctx.shadowBlur = 12; ctx.fill(); ctx.shadowBlur = 0
    }
  }
  const sparks = []
  function emit() {
    for (const b of branches) if (!b.ghost && head >= b.from && head <= (b.end ?? Infinity)) {
      const back = phase === "rewind"
      sparks.push({ x: head, y: yAt(b, head), vx: (back ? 1 : -1) * (0.05 + Math.random() * 0.25), vy: (Math.random() - 0.5) * 0.12,
        life: 1, s: Math.random() < 0.2 ? 2 : 1.2, c: back ? "#ffb224" : b.color })
    }
  }
  let prev = performance.now()
  function tick(now) {
    const dt = Math.min(now - prev, 50); prev = now
    if (phase !== "pause") emit()
    for (const p of sparks) { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt / 900 }
    while (sparks.length && sparks[0].life <= 0) sparks.shift()
    phaseT += dt
    if (phase === "play") {
      head += dt * 0.22; clockMs += dt
      if (head > W * (0.62 + 0.08 * (rewinds % 3)) || head > W - 40) { phase = "pause"; phaseT = 0 }
    } else if (phase === "pause") {
      if (phaseT > 500) { phase = "rewind"; phaseT = 0; rewindTo = head - W * (0.18 + Math.random() * 0.14) ; for (const b of branches) if (!b.ghost && b.end == null) b.end = head }
    } else if (phase === "rewind") {
      head -= dt * 0.55; clockMs = Math.max(0, clockMs - dt * 3.4)
      if (head <= rewindTo) { head = rewindTo; phase = "branch"; phaseT = 0 }
    } else if (phase === "branch") {
      if (phaseT > 350) {
        const live = branches.filter((b) => !b.ghost)
        const parent = live[live.length - 1]
        const dir = Math.random() < 0.5 ? -1 : 1
        const here = yAt(parent, head)
        const y1 = Math.max(H * 0.18, Math.min(H * 0.82, here + dir * (50 + Math.random() * 70)))
        branches.push({ parent, off: y1 - here, fork: head, from: head, color: COLORS[live.length % COLORS.length] })
        rewinds++
        phase = "play"; phaseT = 0
        if (live.length > 6) { reset() }
      }
    }
    const s = clockMs / 1000
    tEl.textContent = `${String(Math.floor(s / 60)).padStart(2, "0")}:${(s % 60).toFixed(2).padStart(5, "0")}`
    dirEl.textContent = phase === "rewind" ? "GOING BACK" : phase === "branch" ? "BRANCHING" : phase === "pause" ? "PAUSED" : "PLAYING"
    dirEl.className = phase === "rewind" ? "rw" : ""
    draw()
    requestAnimationFrame(tick)
  }
  resize(); reset()
  addEventListener("resize", () => { resize(); reset() })
  requestAnimationFrame(tick)
})()
