// Scripts and stylesheets the app adds once its clock runs (chunk loaders:
// Turbopack, webpack, next/script, third-party tags) load in real time. Live,
// a lazy chunk landed at 233ms; in a rebuild (from the cache) at 83ms, so the
// code in it ran at another moment and every Math.random() after it came out
// different (F48). With RT.holdScripts (the front server's frames), when each
// one finished loading is recorded ({ type: "script", url, n, ok }; n counts
// the earlier loads of that URL on this page), and a replay holds the element
// back (preloading it) until the recording reaches that moment, then puts it
// in and waits for it to load (scriptBusy, see settle() in 00-core.js). One
// the recording doesn't have goes in at once, as before.
// Native import() can't be held (Vite's lazy routes, Astro islands).

let scriptBusy = 0
const scriptSeen = new WeakSet() // elements already counted (a preview moving one back isn't a load)
const scriptCount = new Map() // url -> loads so far on this page
const scriptHeld = new Map() // "url#n" -> puts the held element in
const scriptGiven = new Set() // "url#n" the replay reached before the app added it

const SCRIPT_TYPES = /^(|module|text\/javascript|application\/javascript|text\/ecmascript|application\/ecmascript)$/
function loadUrl(node) {
  if (!node || node.nodeType !== 1) return null
  if (node.tagName === "SCRIPT") return node.src && SCRIPT_TYPES.test((node.type || "").trim().toLowerCase()) ? node.src : null
  if (node.tagName === "LINK") return /(^|\s)stylesheet(\s|$)/i.test(node.rel || "") && !node.disabled ? node.href || null : null
  return null
}
const loadsSomething = (n) => !!n && (n.tagName === "SCRIPT" || n.tagName === "LINK") && !!loadUrl(n)

// Is that load in the recording still ahead of this replay?
function scriptAhead(url, n) {
  for (let i = cursor.event; i < rec.events.length; i++) {
    const e = rec.events[i]
    if (e.type === "script" && e.url === url && e.n === n) return true
  }
  return false
}

// Put it in now, and have time wait for it (3s at most: one that never loads
// mustn't stall every frame after it).
function insertWaited(node, insert, preload) {
  scriptBusy++
  let done = false
  const end = () => {
    if (done) return
    done = true
    scriptBusy--
  }
  node.addEventListener("load", end, { once: true })
  node.addEventListener("error", end, { once: true })
  real.setTimeout(end, 3000)
  if (preload) preload.remove()
  return insert()
}

// The app adding a script or stylesheet (`insert` does it for real).
function trackLoad(node, insert) {
  if (!clock.booted || previewing || scriptSeen.has(node) || !rec) return insert()
  const url = loadUrl(node)
  if (!url) return insert()
  scriptSeen.add(node)
  const n = scriptCount.get(url) || 0
  scriptCount.set(url, n + 1)
  const key = url + "#" + n
  if (!hasFuture() && !clock.seeking) {
    // Live: when it's in is recorded.
    const done = (ok) => recordEvent(ok ? { type: "script", url, n } : { type: "script", url, n, ok: false })
    node.addEventListener("load", () => done(true), { once: true })
    node.addEventListener("error", () => done(false), { once: true })
    return insert()
  }
  if (scriptGiven.delete(key)) return insertWaited(node, insert)
  if (!scriptAhead(url, n)) return insert()
  // Held until its moment; fetched meanwhile, so it's in the cache by then.
  let preload = null
  try {
    preload = document.createElement("link")
    preload.rel = "preload"
    preload.as = node.tagName === "SCRIPT" ? "script" : "style"
    if (node.crossOrigin != null) preload.crossOrigin = node.crossOrigin
    preload.href = url
    scriptOrig.appendChild.call(document.head || document.documentElement, preload)
  } catch {}
  scriptHeld.set(key, () => insertWaited(node, insert, preload))
  return node
}

// The recording reached a load.
function deliverScript(ev) {
  const key = ev.url + "#" + ev.n
  const go = scriptHeld.get(key)
  if (!go) return scriptGiven.add(key)
  scriptHeld.delete(key)
  go()
}
// At the live edge nothing more is coming from the recording (it was cut, or
// forked): whatever is still held goes in.
function releaseHeldScripts() {
  if (!scriptHeld.size || hasFuture()) return
  const all = [...scriptHeld.values()]
  scriptHeld.clear()
  for (const go of all) go()
}

const scriptOrig = { appendChild: Node.prototype.appendChild, insertBefore: Node.prototype.insertBefore }
if (RT.holdScripts) {
  const NP = Node.prototype
  NP.appendChild = function (node) {
    if (!loadsSomething(node)) return scriptOrig.appendChild.call(this, node)
    return trackLoad(node, () => scriptOrig.appendChild.call(this, node))
  }
  NP.insertBefore = function (node, ref) {
    if (!loadsSomething(node)) return scriptOrig.insertBefore.call(this, node, ref)
    return trackLoad(node, () => scriptOrig.insertBefore.call(this, node, ref))
  }
  // append/prepend/before/after take several nodes: with a script among them,
  // each goes in on its own, in the same order.
  const EP = Element.prototype
  for (const m of ["append", "prepend", "before", "after"]) {
    const orig = EP[m]
    if (typeof orig !== "function") continue
    const reversed = m === "prepend" || m === "after"
    EP[m] = function (...nodes) {
      if (!nodes.some(loadsSomething)) return orig.apply(this, nodes)
      for (const n of reversed ? nodes.reverse() : nodes) {
        if (loadsSomething(n)) trackLoad(n, () => orig.call(this, n))
        else orig.call(this, n)
      }
    }
  }
}
