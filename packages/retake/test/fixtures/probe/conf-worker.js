// Like canvas-confetti with useWorker: draws on an OffscreenCanvas using
// Math.random, performance.now and rAF, and reports what it drew.
let ctx = null, n = 0
onmessage = (e) => {
  if (!e.data.canvas) return
  ctx = e.data.canvas.getContext("2d")
  const frame = () => {
    let sum = 0
    for (let i = 0; i < 5; i++) {
      const x = Math.floor(Math.random() * 100), y = Math.floor(Math.random() * 50)
      ctx.fillRect(x, y, 4, 4)
      sum += x * 7 + y
    }
    sum += Math.floor(performance.now())
    postMessage({ n, sum })
    if (++n < 12) requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}
