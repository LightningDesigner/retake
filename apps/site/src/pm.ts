// Install rows follow the chosen package manager; a thumb slides to the pick.
// The run command names the package (retake-dev): it works installed or not,
// where a bare `retake` would fetch an unrelated npm package.
const PM: Record<string, { install: string; run: string }> = {
  npm: { install: "npm i -D retake-dev", run: "npx retake-dev" },
  pnpm: { install: "pnpm add -D retake-dev", run: "pnpm dlx retake-dev" },
  yarn: { install: "yarn add -D retake-dev", run: "yarn dlx retake-dev" },
  bun: { install: "bun add -d retake-dev", run: "bunx retake-dev" },
}

export function pm() {
  const tabs = [...document.querySelectorAll<HTMLElement>("[data-pm]")]
  const thumb = document.querySelector<HTMLElement>(".pm .thumb")!
  function moveThumb(tab: HTMLElement) {
    thumb.style.width = tab.offsetWidth + "px"
    thumb.style.transform = `translateX(${tab.offsetLeft}px)`
  }
  function pick(name: string) {
    const p = PM[name]
    if (!p) return
    tabs.forEach((t) => t.setAttribute("aria-selected", String(t.dataset.pm === name)))
    moveThumb(tabs.find((t) => t.dataset.pm === name)!)
    document.querySelectorAll("[data-install]").forEach((el) => (el.textContent = p.install))
    document.querySelectorAll("[data-run]").forEach((el) => (el.textContent = p.run))
  }
  tabs.forEach((t) => t.addEventListener("click", () => pick(t.dataset.pm ?? "")))
  // Placed without sliding at first, and again once the font has loaded.
  const place = () => {
    thumb.style.transition = "none"
    moveThumb(tabs.find((t) => t.getAttribute("aria-selected") === "true")!)
    thumb.offsetWidth
    thumb.style.transition = ""
  }
  place()
  document.fonts.ready.then(place)
}
