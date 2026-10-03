// The playground's three demos, for the dock at the bottom to rewind. Each
// leans on a different kind of motion: CSS transitions on size and shape (the
// island), a gesture with velocity (toasts), and a layout that re-flows as you
// type (command menu).
import { island } from "./island.ts"

export function play() {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches

  // ---- The island: click to morph through four states (see island.ts) ----------
  island()

  // ---- Toast stack: add, hover to fan out, swipe to dismiss ----------------------
  {
    const list = document.getElementById("toasts")!
    const add = document.getElementById("toast-add")!
    const KINDS = [
      { title: "Saved", text: "Your changes are saved", color: "#85cc87", icon: '<path d="M5 12.5l4.5 4.5L19 7.5"/>' },
      { title: "Invite sent", text: "Sam will get an email", color: "#bda8fc", icon: '<path d="M4 6h16v12H4z"/><path d="M4 7l8 6 8-6"/>' },
      { title: "File uploaded", text: "report.pdf, 2.4 MB", color: "#3bcfcf", icon: '<path d="M12 16V4"/><path d="M7 9l5-5 5 5"/><path d="M5 20h14"/>' },
      { title: "Link copied", text: "Paste it anywhere", color: "#efa464", icon: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>' },
    ]
    const GAP = 10
    const MAX = 3
    let n = 0
    let open = false
    // The list holds only the toasts (<li>s this makes).
    const toasts = () => [...list.children] as HTMLElement[]

    // Where each toast sits: stacked (peeking out above the front one) or fanned out.
    function layout() {
      const items = toasts().filter((t) => !t.dataset.gone)
      let y = 0
      items.reverse().forEach((t, i) => {
        t.style.zIndex = String(100 - i)
        if (open) {
          t.style.setProperty("--y", `${-y}px`)
          t.style.setProperty("--s", "1")
          t.style.setProperty("--o", "1")
          y += t.offsetHeight + GAP
        } else {
          t.style.setProperty("--y", `${-i * 12}px`)
          t.style.setProperty("--s", String(1 - i * 0.05))
          t.style.setProperty("--o", i < 3 ? "1" : "0")
        }
      })
      // Fanned out, the whole stack moves down by half its growth, so it stays centred.
      const front = items.length ? items[0].offsetHeight : 0
      list.style.setProperty("--shift", open && items.length > 1 ? `${(y - GAP - front) / 2}px` : "0px")
      list.style.setProperty("--hover-h", open ? `${y}px` : `${items.length ? items[0].offsetHeight + Math.min(items.length - 1, 2) * 12 : 0}px`)
    }

    function addToast() {
      const k = KINDS[n++ % KINDS.length]
      const t = document.createElement("li")
      t.className = "toast"
      t.innerHTML = `<span class="ic" style="background:${k.color}"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${k.icon}</svg></span><span><b>${k.title}</b><small>${k.text}</small></span>`
      // In from below.
      t.style.setProperty("--y", "60px")
      t.style.setProperty("--o", "0")
      list.append(t)
      swipeable(t)
      t.offsetHeight
      const live = toasts().filter((x) => !x.dataset.gone)
      if (live.length > MAX) dismiss(live[0], 0)
      layout()
    }

    function dismiss(t: HTMLElement, dir: number) {
      t.dataset.gone = "1"
      t.classList.remove("dragging")
      if (dir) t.style.setProperty("--dx", `${dir * 360}px`)
      else t.style.setProperty("--y", `${parseFloat(t.style.getPropertyValue("--y") || "0") - 20}px`)
      t.style.setProperty("--o", "0")
      setTimeout(() => t.remove(), reduced ? 0 : 400)
      layout()
    }

    function swipeable(t: HTMLElement) {
      let start: { x: number; t: number; dx: number } | null = null
      t.addEventListener("pointerdown", (e) => {
        if (t.dataset.gone) return
        t.setPointerCapture(e.pointerId)
        start = { x: e.clientX, t: performance.now(), dx: 0 }
        t.classList.add("dragging")
      })
      t.addEventListener("pointermove", (e) => {
        if (!start) return
        start.dx = e.clientX - start.x
        t.style.setProperty("--dx", `${start.dx}px`)
        t.style.setProperty("--o", String(Math.max(0.2, 1 - Math.abs(start.dx) / 260)))
      })
      const end = () => {
        if (!start) return
        const v = Math.abs(start.dx) / Math.max(1, performance.now() - start.t)
        const dx = start.dx
        start = null
        t.classList.remove("dragging")
        if (Math.abs(dx) > 90 || (v > 0.45 && Math.abs(dx) > 24)) dismiss(t, Math.sign(dx))
        else {
          t.style.setProperty("--dx", "0px")
          t.style.setProperty("--o", "1")
        }
      }
      t.addEventListener("pointerup", end)
      t.addEventListener("pointercancel", end)
    }

    add.addEventListener("click", addToast)
    list.addEventListener("pointerenter", () => ((open = true), layout()))
    list.addEventListener("pointerleave", () => ((open = false), layout()))
  }

  // ---- Command menu: filter as you type; rows slide to their new places ------------
  {
    const input = document.getElementById("cmdk") as HTMLInputElement
    const box = document.getElementById("cmdk-list")!
    const hl = box.querySelector<HTMLElement>(".hl")!
    const empty = document.querySelector<HTMLElement>("#palette .empty")!
    const ran = document.getElementById("ran")!
    const ROW = 40
    const COMMANDS = [
      { label: "New file", key: "⌘N", color: "#bda8fc" },
      { label: "Search", key: "⌘K", color: "#3bcfcf" },
      { label: "Invite people", key: "⌘I", color: "#f197c2" },
      { label: "Settings", key: "⌘,", color: "#85cc87" },
      { label: "Sign out", key: "⇧⌘Q", color: "#efa464" },
    ]
    const items = COMMANDS.map((c, i) => {
      const el = document.createElement("button")
      el.className = "item"
      el.setAttribute("role", "option")
      el.id = `cmd-${i}`
      el.innerHTML = `<span class="ico" style="background:${c.color}22;color:${c.color}"><svg viewBox="0 0 10 10" width="8" height="8"><circle cx="5" cy="5" r="4" fill="currentColor"/></svg></span>${c.label}${c.key ? `<kbd>${c.key}</kbd>` : ""}`
      el.tabIndex = -1
      box.append(el)
      return { ...c, el }
    })
    let shown = items
    let active = 0
    let ranTimer: ReturnType<typeof setTimeout> | undefined

    function paint() {
      items.forEach((it) => {
        const at = shown.indexOf(it)
        it.el.classList.toggle("out", at < 0)
        if (at >= 0) it.el.style.transform = `translateY(${at * ROW}px)`
        it.el.classList.toggle("active", at === active)
        it.el.setAttribute("aria-selected", String(at === active))
      })
      hl.style.opacity = shown.length ? "1" : "0"
      hl.style.transform = `translateY(${Math.max(0, active) * ROW}px)`
      empty.hidden = shown.length > 0
      box.style.height = `${Math.max(1, shown.length) * ROW + 12}px`
      if (shown[active]) input.setAttribute("aria-activedescendant", shown[active].el.id)
    }
    function run(it: (typeof items)[number] | undefined) {
      if (!it) return
      ran.textContent = `Ran “${it.label}”`
      ran.classList.add("show")
      it.el.animate([{ transform: it.el.style.transform + " scale(.97)" }, { transform: it.el.style.transform }], { duration: 220, easing: "ease-out" })
      clearTimeout(ranTimer)
      ranTimer = setTimeout(() => ran.classList.remove("show"), 1600)
    }
    input.addEventListener("input", () => {
      const q = input.value.trim().toLowerCase()
      shown = items.filter((it) => it.label.toLowerCase().includes(q))
      active = 0
      paint()
    })
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault()
        if (!shown.length) return
        active = (active + (e.key === "ArrowDown" ? 1 : -1) + shown.length) % shown.length
        paint()
      } else if (e.key === "Enter") {
        e.preventDefault()
        run(shown[active])
      }
    })
    items.forEach((it) => {
      it.el.addEventListener("pointerenter", () => {
        const at = shown.indexOf(it)
        if (at >= 0 && at !== active) ((active = at), paint())
      })
      it.el.addEventListener("click", () => run(it))
    })
    // Placed without sliding the first time.
    items.forEach((it) => (it.el.style.transition = "none"))
    hl.style.transition = "none"
    paint()
    box.offsetHeight
    items.forEach((it) => (it.el.style.transition = ""))
    hl.style.transition = ""
  }
}
