// Where a CSS animation or transition comes from: the rule that sets it on
// the element (or its ::before/::after), and the @keyframes it runs, as
// file:line in the project's own source. Vite injects each CSS file as a
// <style data-vite-dev-id="/abs/file.css"> with an inline source map
// (css.devSourcemap, which the plugin turns on), so rules map back to the
// original .css/.scss/module file. Tailwind utilities come back as the
// utility class plus where Tailwind is configured.

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
const B64I = Object.fromEntries([...B64].map((c, i) => [c, i]))

// Source map "mappings" → per generated line, segments [col, src, line, col].
function decodeMappings(str) {
  const lines = []
  let src = 0
  let sLine = 0
  let sCol = 0
  for (const lineStr of str.split(";")) {
    const segs = []
    let col = 0
    for (const seg of lineStr.split(",")) {
      if (!seg) continue
      const vals = []
      let v = 0
      let shift = 0
      for (const ch of seg) {
        const d = B64I[ch]
        v += (d & 31) << shift
        if (d & 32) shift += 5
        else {
          vals.push(v & 1 ? -(v >> 1) : v >> 1)
          v = 0
          shift = 0
        }
      }
      col += vals[0]
      if (vals.length >= 4) {
        src += vals[1]
        sLine += vals[2]
        sCol += vals[3]
        segs.push([col, src, sLine, sCol])
      }
    }
    lines.push(segs)
  }
  return lines
}

const mapCache = new WeakMap() // style element -> { map, lines } | null
function sourceMapOf(styleEl) {
  if (mapCache.has(styleEl)) return mapCache.get(styleEl)
  let out = null
  try {
    const m = /\/\*# sourceMappingURL=data:application\/json;(?:charset=[^;]+;)?base64,([A-Za-z0-9+/=]+)\s*\*\//.exec(styleEl.textContent || "")
    if (m) {
      const map = JSON.parse(new TextDecoder().decode(fromB64(m[1])))
      out = { map, lines: decodeMappings(map.mappings || "") }
    }
  } catch {}
  mapCache.set(styleEl, out)
  return out
}

function walkRules(list, visit) {
  for (const r of list) {
    visit(r)
    if (r.cssRules) walkRules(r.cssRules, visit)
  }
}

// The element part and the pseudo-element part of a selector list entry.
function splitPseudo(sel) {
  const m = /::?(before|after)\s*$/i.exec(sel)
  return m ? { base: sel.slice(0, m.index) || "*", pseudo: "::" + m[1].toLowerCase() } : { base: sel, pseudo: null }
}

// The full selector of a (possibly nested) style rule.
function fullSelector(rule) {
  let sel = rule.selectorText
  for (let p = rule.parentRule; p; p = p.parentRule) {
    if (p.selectorText) sel = sel.includes("&") ? sel.replace(/&/g, p.selectorText) : `${p.selectorText} ${sel}`
  }
  return sel
}

// Last rule (in document order) that matches the element/pseudo and sets the property.
function findRule(el, pseudo, test) {
  let found = null
  for (const sheet of document.styleSheets) {
    let rules
    try {
      rules = sheet.cssRules
    } catch {
      continue
    }
    walkRules(rules, (r) => {
      if (!r.selectorText || !r.style || !test(r.style)) return
      const sel = fullSelector(r)
      for (const part of sel.split(",")) {
        const { base, pseudo: p } = splitPseudo(part.trim())
        if ((p || null) !== (pseudo || null)) continue
        try {
          if (el.matches(base.replace(/\[data-rt-hover\]/g, ":hover"))) {
            found = { rule: r, sheet, selector: part.trim() }
            return
          }
        } catch {}
      }
    })
  }
  return found
}

function findKeyframes(name) {
  let found = null
  for (const sheet of document.styleSheets) {
    let rules
    try {
      rules = sheet.cssRules
    } catch {
      continue
    }
    walkRules(rules, (r) => {
      if (typeof CSSKeyframesRule !== "undefined" && r instanceof CSSKeyframesRule && r.name === name) found = { rule: r, sheet, selector: `@keyframes ${name}` }
    })
  }
  return found
}

// file:line of a rule in its <style>, mapped to the original source if a map exists.
function locate(hit) {
  const owner = hit.sheet.ownerNode
  const devId = owner && owner.getAttribute && owner.getAttribute("data-vite-dev-id")
  const href = hit.sheet.href
  const text = (owner && owner.textContent) || ""
  // Where the rule's header sits in the served CSS (first match).
  const head = hit.rule instanceof CSSKeyframesRule ? `@keyframes ${hit.rule.name}` : hit.rule.selectorText
  let idx = text.indexOf(head)
  if (idx < 0) idx = text.indexOf(head.split(",")[0].trim())
  const out = { file: devId || href || null, line: null, selector: hit.selector }
  if (idx < 0) return out
  const before = text.slice(0, idx)
  const genLine = before.split("\n").length - 1
  const genCol = idx - before.lastIndexOf("\n") - 1
  out.line = genLine + 1
  const sm = owner && sourceMapOf(owner)
  if (sm && sm.lines[genLine]) {
    let seg = null
    for (const s of sm.lines[genLine]) if (s[0] <= genCol) seg = s
    if (!seg) seg = sm.lines[genLine][0]
    if (seg) {
      const srcName = sm.map.sources[seg[1]]
      out.line = seg[2] + 1
      if (srcName) {
        try {
          out.file = srcName.startsWith("/") ? srcName : new URL(srcName, "file://" + (devId || "/")).pathname
        } catch {
          out.file = srcName
        }
      }
    }
  }
  return out
}

// A rule in a <link rel=stylesheet> (Next, Nuxt, SvelteKit...): its text and
// source map fetched once per sheet (index maps with sections too, as
// Turbopack writes them), then the same lookup as locate().
const linkedCache = new Map() // href -> Promise<{ text, lines, sources, offsets } | null>
function linkedSheet(href) {
  if (linkedCache.has(href)) return linkedCache.get(href)
  // As a stylesheet: Vite answers a bare fetch of a .css URL with a JS module
  // that wraps the CSS in a string (every rule on one line).
  const p = real
    .fetch(href, { headers: { accept: "text/css,*/*;q=0.1" } })
    .then((r) => (r.ok ? r.text() : null))
    .then(async (text) => {
      if (text == null) return null
      const out = { text, sections: [] }
      const m = /\/\*# sourceMappingURL=([^\s*]+)\s*\*\//.exec(text)
      if (!m) return out
      let map = null
      try {
        if (m[1].startsWith("data:")) map = JSON.parse(new TextDecoder().decode(fromB64(m[1].split(",").pop())))
        else {
          const r = await real.fetch(new URL(m[1], href).href)
          map = r.ok ? await r.json() : null
        }
      } catch {}
      if (!map) return out
      const parts = Array.isArray(map.sections) ? map.sections.map((s) => ({ line: (s.offset && s.offset.line) || 0, map: s.map })) : [{ line: 0, map }]
      for (const part of parts) if (part.map && part.map.mappings != null) out.sections.push({ line: part.line, sources: part.map.sources || [], lines: decodeMappings(part.map.mappings) })
      return out
    })
    .catch(() => null)
  linkedCache.set(href, p)
  return p
}
async function locateLinked(hit, out) {
  const sheet = await linkedSheet(hit.sheet.href)
  if (!sheet) return out
  const head = hit.rule instanceof CSSKeyframesRule ? `@keyframes ${hit.rule.name}` : hit.rule.selectorText
  let idx = sheet.text.indexOf(head)
  if (idx < 0) idx = sheet.text.indexOf(head.split(",")[0].trim())
  if (idx < 0) return out
  const before = sheet.text.slice(0, idx)
  const genLine = before.split("\n").length - 1
  const genCol = idx - before.lastIndexOf("\n") - 1
  // Turbopack names each part: /* [project]/app/globals.css [app-client] (css) */
  const named = [...before.matchAll(/\/\* \[project\]\/([^\s*]+)[^*]*\*\//g)].pop()
  if (named) out.file = named[1]
  // No source map and not a bundle: the served file is the source (plain CSS from a dev server).
  else if (!sheet.sections.length) out.line = genLine + 1
  let sec = null
  for (const s of sheet.sections) if (s.line <= genLine) sec = s
  const segs = sec && sec.lines[genLine - sec.line]
  if (!segs || !segs.length) return out
  let seg = null
  for (const sg of segs) if (sg[0] <= genCol) seg = sg
  if (!seg) seg = segs[0]
  out.line = seg[2] + 1
  const srcName = sec.sources[seg[1]]
  if (srcName) {
    try {
      out.file = srcName.startsWith("file://") ? decodeURIComponent(new URL(srcName).pathname) : srcName.replace(/^turbopack:\/\/\/?(\[project\]\/)?/, "").replace(/^webpack:\/\/[^/]*\//, "")
    } catch {
      out.file = srcName
    }
  }
  return out
}

// A Tailwind utility (e.g. .animate-pulse) from Tailwind's generated CSS?
function tailwindUtility(hit) {
  const sel = hit.selector.replace(/\\/g, "")
  const m = /^\.([\w:/[\]().%-]+?)(?::[\w-]+)*(?:::?(?:before|after))?$/.exec(sel)
  if (!m) return null
  const text = (hit.sheet.ownerNode && hit.sheet.ownerNode.textContent) || ""
  if (!/tailwindcss|--tw-/.test(text)) return null
  return m[1]
}

let tailwindConfig
function tailwindConfigFile() {
  if (tailwindConfig !== undefined) return Promise.resolve(tailwindConfig)
  return real
    .fetch("/__retake/tailwind")
    .then((r) => (r.ok ? r.json() : {}))
    .then((j) => (tailwindConfig = j.config || null))
    .catch(() => (tailwindConfig = null))
}

// What the caller has in hand: an Animation, a clip (from timeline()/clipsFor()), or a clip id.
function resolveAnimationTarget(x) {
  if (typeof x === "string") x = (rec.clips || []).find((c) => c.id === x) || x
  if (x && typeof Animation !== "undefined" && x instanceof Animation) {
    const kind = clipKind(x)
    const fx = /** @type {KeyframeEffect | null} */ (x.effect)
    const css = /** @type {any} */ (x) // a CSSAnimation or a CSSTransition
    return { el: fx && fx.target, pseudo: (fx && fx.pseudoElement) || null, kind, name: kind === "css-animation" ? css.animationName : null, prop: kind === "transition" ? css.transitionProperty : null }
  }
  if (x && x.path) {
    const el = resolvePath(x.path)
    return { el, pseudo: x.pseudoElement || null, kind: x.kind, name: x.kind === "css-animation" ? x.label : null, prop: x.kind === "transition" ? x.property : null }
  }
  return null
}

async function cssSourceFor(x) {
  const t = resolveAnimationTarget(x)
  if (!t || !t.el || t.el.nodeType !== 1) return null
  let hit = null
  if (t.kind === "css-animation" && t.name) {
    hit = findRule(t.el, t.pseudo, (st) => (st.animationName || "").split(",").map((s) => s.trim()).includes(t.name))
  } else if (t.kind === "transition" && t.prop) {
    hit = findRule(t.el, t.pseudo, (st) => {
      const props = (st.transitionProperty || "").split(",").map((s) => s.trim())
      return props.includes(t.prop) || props.includes("all") || (!!st.transition && !st.transitionProperty)
    })
  }
  if (!hit) return null
  const out = locate(hit)
  if (out.line == null && hit.sheet.href) await locateLinked(hit, out)
  if (t.kind === "css-animation" && t.name) {
    const kf = findKeyframes(t.name)
    if (kf) {
      const k = locate(kf)
      if (k.line == null && kf.sheet.href) await locateLinked(kf, k)
      out.keyframes = { name: t.name, ...k }
    }
  }
  const utility = tailwindUtility(hit)
  if (utility) {
    out.utility = utility
    out.config = await tailwindConfigFile()
  }
  return out
}
