// Room at the bottom for the dock when Retake is running the page (outside the
// dock's frame the runtime is only `{ inert: true }`). The dock says how much
// it covers: window.__retakeDockHeight, and a retake:dock event when that
// changes (0 when it's folded into its corner button). The height goes in a
// constructed stylesheet rather than the DOM, so going back in time (which
// rewinds the DOM) never puts back an old height.
export function docked() {
  const rt = window.__retake
  if (!rt || rt.inert || document.documentElement.classList.contains("docked")) return
  document.documentElement.classList.add("docked")
  let set = (h: number) => document.documentElement.style.setProperty("--dock-h", `${h}px`)
  try {
    const sheet = new CSSStyleSheet()
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]
    set = (h) => sheet.replaceSync(`:root { --dock-h: ${h}px; }`)
  } catch {}
  if (typeof window.__retakeDockHeight === "number") set(window.__retakeDockHeight)
  window.addEventListener("retake:dock", (e) => set(e.detail.height))
}
