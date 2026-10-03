// The footer's canvas: a quiet picture of a timeline, on one fixed loop.
// Timeline 1 runs left to right behind a playhead, pauses, rewinds, and
// Timeline 2 splits off where it stopped and runs to the edge; then it all
// fades out and the same loop starts again. Always the same three threads (an
// older, finished one too), so nothing piles up. Drawn only while on screen;
// with reduced motion, one still frame.

// Timeline colours, as the dock draws them.
const LILAC = "189,168,252"
const TEAL = "59,207,207"
const PINK = "241,151,194"
const AMBER = "255,178,36"

// The loop, in seconds.
const PLAY_END = 7, PAUSE_END = 8, BACK_END = 9.4, HOLD_END = 10, RUN_END = 15, FADE_END = 16.5
// Where the playhead is at each stop, as a share of the width.
const START = 0.04, STOP = 0.66, BACK = 0.42

const smooth = (k: number) => k * k * (3 - 2 * k)
const clamp = (k: number) => Math.max(0, Math.min(1, k))

export function threads() {
  const el = document.getElementById("threads")
  if (!(el instanceof HTMLCanvasElement)) return
  const c = el
  const ctx = c.getContext("2d")!
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches
  let W = 0, H = 0

  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2)
    W = c.clientWidth; H = c.clientHeight
    c.width = Math.round(W * dpr); c.height = Math.round(H * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  // Timeline 1: a slow wave through the middle.
  const mainY = (x: number) => H * 0.52 + Math.sin(x * 0.006 + 0.6) * H * 0.07
  // A branch follows Timeline 1 up to its fork, then eases off by `off`.
  const branchY = (x: number, fork: number, off: number) => mainY(x) + off * smooth(clamp((x - fork) / Math.max(120, W * 0.12)))

  function stroke(from: number, to: number, y: (x: number) => number, rgb: string, alpha: number, width: number, dash?: number[]) {
    if (to <= from) return
    ctx.beginPath()
    for (let x = from; ; x += 4) {
      const xx = Math.min(x, to)
      xx === from ? ctx.moveTo(xx, y(xx)) : ctx.lineTo(xx, y(xx))
      if (xx >= to) break
    }
    ctx.setLineDash(dash ?? [])
    ctx.strokeStyle = `rgba(${rgb},${alpha})`
    ctx.lineWidth = width
    ctx.lineCap = "round"
    ctx.stroke()
    ctx.setLineDash([])
  }
  function dot(x: number, y: number, rgb: string, alpha: number, r: number) {
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = `rgba(${rgb},${alpha})`; ctx.fill()
  }

  // The picture at `t` seconds into the loop.
  function draw(t: number) {
    ctx.clearRect(0, 0, W, H)
    // Fade in at the start of the loop, out at its end.
    ctx.globalAlpha = clamp(t / 0.8) * (1 - clamp((t - RUN_END) / (FADE_END - RUN_END)))

    // A few faint guide lines, still.
    for (let i = 0; i < 5; i++) {
      const y0 = H * (0.2 + i * 0.15)
      stroke(0, W, (x) => y0 + Math.sin(x * 0.004 + i * 1.7) * H * 0.04, "255,255,255", 0.035, 1)
    }

    let head: number, back = false
    if (t < PLAY_END) head = START + (STOP - START) * (t / PLAY_END)
    else if (t < PAUSE_END) head = STOP
    else if (t < BACK_END) { head = STOP - (STOP - BACK) * smooth((t - PAUSE_END) / (BACK_END - PAUSE_END)); back = true }
    else if (t < HOLD_END) head = BACK
    else head = BACK + (1.02 - BACK) * clamp((t - HOLD_END) / (RUN_END - HOLD_END))
    const hx = head * W
    const forked = t >= HOLD_END
    const fork = BACK * W, branchOff = -H * 0.24

    // An older timeline, finished: forked early, ended with a dot.
    const oldFork = 0.1 * W, oldEnd = 0.32 * W, oldOff = H * 0.24
    const oy = (x: number) => branchY(x, oldFork, oldOff)
    stroke(oldFork, Math.min(hx, oldEnd), oy, PINK, 0.4, 1.5)
    if (hx >= oldEnd || t >= PAUSE_END) dot(oldEnd, oy(oldEnd), PINK, 0.5, 2.5)

    // Timeline 1: solid up to the playhead; once rewound, what's past it stays
    // as a dim dotted line (Timeline 2 takes over from there).
    const recorded = t >= PLAY_END ? STOP * W : hx
    stroke(0, Math.min(hx, recorded), mainY, LILAC, forked ? 0.4 : 0.6, 1.6)
    if (hx < recorded) stroke(hx, recorded, mainY, LILAC, 0.25, 1.2, [2, 5])

    // Timeline 2, once it splits off.
    if (forked) stroke(fork, hx, (x) => branchY(x, fork, branchOff), TEAL, 0.6, 1.6)

    // The playhead: a faint line (amber while going back) and a dot on the live thread.
    const rgb = back ? AMBER : "255,255,255"
    const g = ctx.createLinearGradient(0, 0, 0, H)
    g.addColorStop(0, `rgba(${rgb},0)`); g.addColorStop(0.5, `rgba(${rgb},.28)`); g.addColorStop(1, `rgba(${rgb},0)`)
    ctx.fillStyle = g; ctx.fillRect(hx - 0.5, 0, 1, H)
    if (hx <= W) dot(hx, forked ? branchY(hx, fork, branchOff) : mainY(hx), rgb, 0.85, 2.5)
    ctx.globalAlpha = 1
  }

  resize()
  if (still) {
    draw(12.5)
    new ResizeObserver(() => { resize(); draw(12.5) }).observe(c)
    return
  }
  let visible = false, frame = 0, t0 = performance.now()
  function tick(now: number) {
    draw(((now - t0) / 1000) % FADE_END)
    frame = visible ? requestAnimationFrame(tick) : 0
  }
  new IntersectionObserver(([e]) => {
    visible = e.isIntersecting
    if (visible && !frame) frame = requestAnimationFrame(tick)
  }).observe(c)
  new ResizeObserver(() => {
    if (c.clientWidth !== W || c.clientHeight !== H) resize()
  }).observe(c)
  // A still frame before the first tick, so the band is never empty.
  draw(12.5)
  t0 = performance.now() - 12.5 * 1000
}
