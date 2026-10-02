// Install rows follow the chosen package manager; a thumb slides to the pick.
const PM = {
  npm: { install: "npm i -D retake-dev", run: "npx retake" },
  pnpm: { install: "pnpm add -D retake-dev", run: "pnpm retake" },
  yarn: { install: "yarn add -D retake-dev", run: "yarn retake" },
  bun: { install: "bun add -d retake-dev", run: "bunx retake" },
}

export function pm() {
  const tabs = [...document.querySelectorAll("[data-pm]")]
  const thumb = document.querySelector(".pm .thumb")
  function moveThumb(tab) {
    thumb.style.width = tab.offsetWidth + "px"
    thumb.style.transform = `translateX(${tab.offsetLeft}px)`
  }
  function pick(name) {
    const p = PM[name]
    if (!p) return
    tabs.forEach((t) => t.setAttribute("aria-selected", String(t.dataset.pm === name)))
    moveThumb(tabs.find((t) => t.dataset.pm === name))
    document.querySelectorAll("[data-install]").forEach((el) => (el.textContent = p.install))
    document.querySelectorAll("[data-run]").forEach((el) => (el.textContent = p.run))
  }
  tabs.forEach((t) => t.addEventListener("click", () => pick(t.dataset.pm)))
  // Placed without sliding at first, and again once the font has loaded.
  const place = () => {
    thumb.style.transition = "none"
    moveThumb(tabs.find((t) => t.getAttribute("aria-selected") === "true"))
    thumb.offsetWidth
    thumb.style.transition = ""
  }
  place()
  document.fonts.ready.then(place)
}
