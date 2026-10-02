// What the fixture app observed, with virtual timestamps (like the probe's log).
export function L(k, v) {
  if (typeof window === "undefined") return
  const fx = (window.__fx = window.__fx || { log: [] })
  fx.log.push({ vt: Math.round(performance.now()), k, v })
}
