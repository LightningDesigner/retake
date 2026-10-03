// Copy buttons.
export function copyButtons() {
  document.querySelectorAll<HTMLElement>("[data-copy]").forEach((b) =>
    b.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(b.dataset.copy!)
        b.classList.add("done"); b.setAttribute("aria-label", "Copied")
        setTimeout(() => { b.classList.remove("done"); b.setAttribute("aria-label", "Copy the command") }, 1400)
      } catch {}
    }),
  )
}

// A faint background thread, drifting on its own wave.
interface Ghost { ghost: true; y0: number; y1: null; from: number; amp: number; f: number; ph: number }
// A timeline: the main one (its own wave) or a branch that follows its parent
// up to the fork, then eases `off` away from it. It stops at `end`, once set.
type Thread = { ghost?: undefined; from: number; end?: number; color: string; main?: boolean } & (
  | { y0: number; amp: number; f: number; ph: number; parent?: undefined; off?: undefined; fork?: undefined }
  | { parent: Thread; off: number; fork: number }
)
type Branch = Ghost | Thread
interface Spark { x: number; y: number; vx: number; vy: number; life: number; s: number; c: string }
type Phase = "play" | "pause" | "rewind" | "branch"

// Hero: timelines streaming left to right. A playhead runs, rewinds (the
// threads retract behind it), then a new branch splits off from where it
// stopped. On repeat.
export function hero() {
  const c = document.getElementById("threads") as HTMLCanvasElement
  const ctx = c.getContext("2d")!
  const tEl = document.getElementById("t")!
  const dirEl = document.getElementById("dir")!
  const clockEl = document.querySelector(".run")!
  let W: number, H: number, dpr: number
  const COLORS = ["#52a8ff", "#ffb224", "#ff4d8d", "#7ee7b8", "#c9a6ff"]
  let branches: Branch[], head: number, phase: Phase, phaseT: number, rewindTo: number, clockMs: number, rewinds: number

  function resize() {
    dpr = Math.min(devicePixelRatio || 1, 2)
    W = c.clientWidth; H = c.clientHeight
    c.width = W * dpr; c.height = H * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }
  function reset() {
    branches = []
    // Background threads: faint, many.
    for (let i = 0; i < 22; i++) {
      branches.push({ y0: (i + 0.5) * (H / 22), y1: null, from: -50, ghost: true, amp: 6 + Math.random() * 18, f: 0.002 + Math.random() * 0.004, ph: Math.random() * 6 })
    }
    const main: Thread = { y0: H * 0.5, from: -50, color: COLORS[0], amp: 14, f: 0.004, ph: 0, main: true }
    branches.push(main)
    // A couple of timelines that already split off earlier, dotted past their ends.
    branches.push({ parent: main, off: -H * 0.2, fork: W * 0.03, from: W * 0.03, end: W * 0.46, color: COLORS[2] })
    branches.push({ parent: main, off: H * 0.22, fork: W * 0.01, from: W * 0.01, end: W * 0.3, color: COLORS[3] })
    head = W * 0.08; phase = "play"; phaseT = 0; clockMs = 0; rewinds = 0
  }
  // A branch follows its parent exactly up to the fork, then eases away.
  function yAt(b: Thread, x: number): number {
    let y = b.parent ? yAt(b.parent, x) : b.y0 + Math.sin(x * b.f + b.ph + performance.now() * 0.0004) * b.amp
    if (b.fork != null && x > b.fork) {
      const k = Math.min(1, (x - b.fork) / 180)
      y += b.off * k * k * (3 - 2 * k)
    }
    return y
  }
  function draw() {
    ctx.clearRect(0, 0, W, H)
    for (const b of branches) {
      const end = b.ghost ? W + 50 : Math.min(head, b.end ?? Infinity)
      if (end <= b.from) continue
      ctx.beginPath()
      for (let x = b.from; x <= end; x += 6) { const y = b.ghost ? b.y0 + Math.sin(x * b.f + b.ph + performance.now() * 0.0003) * b.amp : yAt(b, x); x === b.from ? ctx.moveTo(x, y) : ctx.lineTo(x, y) }
      if (b.ghost) { ctx.strokeStyle = "rgba(140,170,255,.055)"; ctx.lineWidth = 1; ctx.shadowBlur = 0 }
      else {
        // Each timeline fades in from the left edge, so nothing starts abruptly.
        const fade = ctx.createLinearGradient(0, 0, Math.max(1, W * 0.22), 0)
        fade.addColorStop(0, b.color + "00"); fade.addColorStop(1, b.color)
        ctx.strokeStyle = fade; ctx.lineWidth = b.main ? 2.6 : 2; ctx.lineCap = "round"; ctx.shadowColor = b.color; ctx.shadowBlur = 14
      }
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
      for (let i = 0; i < 14; i++) {
        const y = (i / 14) * H + ((performance.now() * 0.05 + i * 37) % 40)
        const len = 40 + ((i * 53) % 160)
        const gr = ctx.createLinearGradient(head, 0, head + len, 0)
        gr.addColorStop(0, "rgba(255,178,36,.28)"); gr.addColorStop(1, "transparent")
        ctx.fillStyle = gr; ctx.fillRect(head, y, len, 1)
      }
    }
    const hc = rewinding ? "#ffb224" : "#ffffff"
    const g = ctx.createLinearGradient(0, 0, 0, H)
    g.addColorStop(0, "transparent"); g.addColorStop(.3, hc); g.addColorStop(.8, hc + "00")
    ctx.globalAlpha = .7; ctx.fillStyle = g; ctx.fillRect(head - .75, 0, 1.5, H); ctx.globalAlpha = 1
    if (rewinding) { const rg = ctx.createLinearGradient(head, 0, head + 120, 0); rg.addColorStop(0, "rgba(255,178,36,.08)"); rg.addColorStop(1, "transparent"); ctx.fillStyle = rg; ctx.fillRect(head, 0, 120, H) }
    for (const b of branches) if (!b.ghost && head >= b.from && head <= (b.end ?? Infinity)) {
      ctx.beginPath(); ctx.arc(head, yAt(b, head), 3.5, 0, 7); ctx.fillStyle = "#fff"; ctx.shadowColor = hc; ctx.shadowBlur = 12; ctx.fill(); ctx.shadowBlur = 0
    }
  }
  const sparks: Spark[] = []
  function emit() {
    for (const b of branches) if (!b.ghost && head >= b.from && head <= (b.end ?? Infinity) && Math.random() < 0.45) {
      const back = phase === "rewind"
      sparks.push({ x: head, y: yAt(b, head), vx: (back ? 1 : -1) * (0.05 + Math.random() * 0.25), vy: (Math.random() - 0.5) * 0.12,
        life: 1, s: Math.random() < 0.2 ? 2 : 1.2, c: back ? "#ffb224" : b.color })
    }
  }
  let prev = performance.now()
  function tick(now: number) {
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
        const live = branches.filter((b): b is Thread => !b.ghost)
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
    const dir = phase === "rewind" ? "Going back" : phase === "branch" ? "New timeline" : phase === "pause" ? "Paused" : "Playing"
    if (dirEl.textContent !== dir) dirEl.textContent = dir
    clockEl.classList.toggle("rw", phase === "rewind" || phase === "pause")
    draw()
    requestAnimationFrame(tick)
  }
  resize(); reset()
  addEventListener("resize", () => { resize(); reset() })
  requestAnimationFrame(tick)
}
