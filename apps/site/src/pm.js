// Install rows follow the chosen package manager.
const PM = {
  npm: { install: "npm i -D retake-dev", run: "npx retake" },
  pnpm: { install: "pnpm add -D retake-dev", run: "pnpm retake" },
  yarn: { install: "yarn add -D retake-dev", run: "yarn retake" },
  bun: { install: "bun add -d retake-dev", run: "bunx retake" },
}
const tabs = document.querySelectorAll("[data-pm]")
function pick(name) {
  const p = PM[name]
  if (!p) return
  tabs.forEach((t) => t.setAttribute("aria-selected", String(t.dataset.pm === name)))
  document.querySelectorAll("[data-install]").forEach((el) => (el.textContent = p.install))
  document.querySelectorAll("[data-run]").forEach((el) => (el.textContent = p.run))
}
tabs.forEach((t) => t.addEventListener("click", () => pick(t.dataset.pm)))
