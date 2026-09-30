// :hover in replays. Synthetic pointer events don't set :hover, so hover
// styles (and the transitions they start) never showed in a rebuild or a
// preview. Every :hover rule gets a twin that matches [data-rt-hover], and
// while a replay or preview shows the past, that attribute follows the
// recorded pointer (on the hovered element and its ancestors, like :hover).
// At the live edge it's cleared and the real :hover takes over.

const HOVER_ATTR = "data-rt-hover"
const mirrored = new WeakMap() // sheet -> rule count after mirroring
let hoverChain = []

function mirrorRules(list, owner) {
  // Walk backwards so inserting a twin right after its rule doesn't shift the rest.
  for (let i = list.length - 1; i >= 0; i--) {
    const r = list[i]
    if (r.cssRules && r.cssRules.length) mirrorRules(r.cssRules, r)
    if (r.selectorText && r.selectorText.includes(":hover") && !r.selectorText.includes(HOVER_ATTR)) {
      const twin = r.cssText.replace(r.selectorText, r.selectorText.replace(/:hover\b/g, `[${HOVER_ATTR}]`))
      try {
        owner.insertRule(twin, i + 1)
      } catch {}
    }
  }
}

function mirrorHover() {
  for (const sheet of document.styleSheets) {
    let rules
    try {
      rules = sheet.cssRules
    } catch {
      continue // cross-origin
    }
    if (mirrored.get(sheet) === rules.length) continue
    mirrorRules(rules, sheet)
    mirrored.set(sheet, sheet.cssRules.length)
  }
}

function setHover(el) {
  const chain = []
  for (let n = el && el.nodeType === 1 ? el : null; n; n = n.parentElement) chain.push(n)
  if (chain.length) mirrorHover()
  let changed = false
  for (const n of hoverChain) if (!chain.includes(n)) n.removeAttribute(HOVER_ATTR), (changed = true)
  for (const n of chain) if (!n.hasAttribute(HOVER_ATTR)) n.setAttribute(HOVER_ATTR, ""), (changed = true)
  hoverChain = chain
  // A hover change can start transitions: the next frame must look (see appRan).
  if (changed) appRan = true
}

function clearHover() {
  if (!hoverChain.length) return
  for (const n of hoverChain) n.removeAttribute(HOVER_ATTR)
  hoverChain = []
  appRan = true
}

// A replayed pointer event: where the pointer is now.
function replayHover(ev, target) {
  if (ev.type === "pointerover" || ev.type === "mouseover") setHover(target)
  else if ((ev.type === "pointerout" || ev.type === "mouseout") && !ev.related) setHover(null)
}

// For a preview at t: the element the pointer was over then.
function hoverAt(t) {
  let path = null
  for (const ev of rec.events) {
    if (ev.t > t) break
    if (ev.type === "pointerover" || ev.type === "mouseover") path = ev.path
    else if ((ev.type === "pointerout" || ev.type === "mouseout") && !ev.related) path = null
  }
  return path ? resolvePath(path) : null
}
