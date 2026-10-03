// A compiled bundle's line → the original file:line, through the bundle's
// source map. For notes whose source is a served chunk (Next/Turbopack and
// webpack chunks, Vite's optimized deps, a production-style bundle) rather
// than the app's own file. No dependencies: a VLQ decoder, and index maps
// (`sections`, as Turbopack writes them) read section by section.
// The dock has the same logic in src/shell/30-notes.js (it can't import).

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

/** "mappings" → per generated line, segments [genCol, sourceIndex, origLine, origCol] (0-based). */
export function decodeMappings(mappings) {
  const lines = []
  let src = 0, oLine = 0, oCol = 0
  for (const text of String(mappings || "").split(";")) {
    const segs = []
    let gCol = 0
    for (const seg of text.split(",")) {
      if (!seg) continue
      const v = []
      for (let i = 0, shift = 0, acc = 0; i < seg.length; i++) {
        const d = B64.indexOf(seg[i])
        if (d < 0) break
        acc += (d & 31) << shift
        if (d & 32) shift += 5
        else {
          v.push(acc & 1 ? -(acc >> 1) : acc >> 1)
          acc = shift = 0
        }
      }
      gCol += v[0] || 0
      if (v.length >= 4) {
        src += v[1]
        oLine += v[2]
        oCol += v[3]
        segs.push([gCol, src, oLine, oCol])
      }
    }
    lines.push(segs)
  }
  return lines
}

const decoded = new WeakMap()
/**
 * Where generated line/column (1-based; col may be null) came from.
 * @returns {{ source: string, line: number, sources: string[] } | null}
 */
export function originalPosition(map, line, col) {
  if (!map || !(line > 0)) return null
  if (Array.isArray(map.sections)) {
    const L = line - 1
    const C = col > 0 ? col - 1 : null
    /** @type {any} */
    let hit = null
    for (const s of map.sections) {
      const o = s.offset || { line: 0, column: 0 }
      if (o.line < L || (o.line === L && (C == null || o.column <= C))) hit = s
      else break
    }
    if (!hit || !hit.map) return null
    const o = hit.offset || { line: 0, column: 0 }
    const c = C == null ? null : (L === o.line ? C - o.column : C) + 1
    const pos = originalPosition(hit.map, L - o.line + 1, c)
    return pos && { ...pos, sources: map.sections.flatMap((x) => (x.map && x.map.sources) || []) }
  }
  let lines = decoded.get(map)
  if (!lines) decoded.set(map, (lines = decodeMappings(map.mappings)))
  const segs = lines[line - 1]
  if (!segs || !segs.length) return null
  let best = segs[0]
  if (col > 0) for (const s of segs) if (s[0] <= col - 1) best = s
  const sources = (map.sources || []).map((s) => (map.sourceRoot && s && !/^[a-z]+:/i.test(s) && !s.startsWith("/") ? map.sourceRoot.replace(/\/?$/, "/") + s : s))
  const source = sources[best[1]]
  return source ? { source, line: best[2] + 1, sources } : null
}

/** Library code (not where the app's own element was written). */
export const isLibrary = (file) => /(^|\/)node_modules\/|\/\.vite\/deps\/|react-dom|jsx-dev-runtime|jsx-runtime|\[turbopack\]|turbopack\/|webpack\/(bootstrap|runtime)/.test(String(file || ""))

/**
 * A served bundle rather than a source file: Next's /_next/static chunks,
 * webpack/Turbopack chunk names, Vite's deps, hashed build assets.
 */
export function isCompiled(file) {
  const f = String(file || "").replace(/[?#].*$/, "")
  return (
    /\/_next\/static\/|\/\.vite\/deps\/|\/node_modules\/\.vite\//.test(f) ||
    /\._\.js$|[-_.](?=[0-9a-z]*\d)[0-9a-z]{6,}\.(m?js|cjs)$/i.test(f.split("/").pop() || "") ||
    /\/assets\/[^/]+-[\w-]{8}\.js$/.test(f)
  )
}

/**
 * A map's source name as a path: `webpack://app/./src/a.tsx` → `src/a.tsx`,
 * `turbopack:///[project]/app/page.tsx` → `app/page.tsx`, `file:///x/y` → `/x/y`,
 * then relative to `root` when it's inside it. Without a root, an absolute path
 * is made relative to the project the map's own node_modules sources sit in.
 * @param {string} name
 * @param {{ root?: string | null, sources?: string[] }} [options]
 */
export function cleanSource(name, { root = null, sources = [] } = {}) {
  let p = String(name || "").replace(/[?#].*$/, "")
  p = p.replace(/^webpack:\/\/[^/]*\//, "").replace(/^turbopack:\/\/\/?(\[project\]\/)?/, "").replace(/^\[project\]\//, "")
  if (p.startsWith("file://")) {
    try {
      p = decodeURIComponent(new URL(p).pathname)
    } catch {
      p = p.slice(7)
    }
  }
  p = p.replace(/^\.\//, "")
  if (p.startsWith("/")) {
    const roots = []
    if (root) roots.push(String(root).replace(/\/$/, ""), "/private" + String(root).replace(/\/$/, ""))
    for (const s of sources) {
      const m = /^(?:file:\/\/)?(\/.*?)\/node_modules\//.exec(String(s || ""))
      if (m) roots.push(m[1])
    }
    for (const r of roots) if (r && p.startsWith(r + "/")) return p.slice(r.length + 1)
  }
  return p
}

/** The map's URL for a bundle: a SourceMap header, its last sourceMappingURL comment, else `<url>.map`. */
export function mapUrlOf(code, url, headers) {
  const h = headers && (headers.get("sourcemap") || headers.get("x-sourcemap"))
  if (h) return new URL(h, url).href
  const all = [...String(code).matchAll(/\/\/[#@] sourceMappingURL=(\S+)/g)]
  if (all.length) {
    const ref = all[all.length - 1][1]
    return ref.startsWith("data:") ? ref : new URL(ref, url).href
  }
  return null
}

function parseDataUrl(ref) {
  const comma = ref.indexOf(",")
  const body = ref.slice(comma + 1)
  return /;base64/.test(ref.slice(0, comma)) ? Buffer.from(body, "base64").toString("utf8") : decodeURIComponent(body)
}

/**
 * Loads `url`'s source map. Resolves to the parsed map, or null.
 * @param {string} url
 * @param {{ fetch?: typeof fetch, timeoutMs?: number }} [options]
 */
export async function loadSourceMap(url, { fetch: get = fetch, timeoutMs = 5000 } = {}) {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const res = await get(url, { signal: ac.signal })
    if (!res.ok) return null
    const code = await res.text()
    let ref = mapUrlOf(code, url, res.headers)
    const tries = ref ? [ref] : [url.replace(/[?#].*$/, "") + ".map"]
    for (const r of tries) {
      try {
        if (r.startsWith("data:")) return JSON.parse(parseDataUrl(r))
        const m = await get(r, { signal: ac.signal })
        if (m.ok) return JSON.parse(await m.text())
      } catch {}
    }
    return null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * A compiled source { file, line, col? } → { file, line, from } in the app's
 * own code, or { library } when the line is library code, or null.
 * @param {{ file: string, line?: number | null, col?: number | null, url?: string }} src
 * @param {{ base: string, root?: string | null, fetch?: typeof fetch }} options
 */
export async function resolveSource(src, { base, root = null, fetch: get = fetch }) {
  if (!src || !src.file || !((src.line ?? 0) > 0)) return null
  let url
  try {
    url = src.url && /^https?:/.test(src.url) ? new URL(new URL(src.url).pathname + new URL(src.url).search, base.replace(/\/?$/, "/")).href : new URL(src.file, base.replace(/\/?$/, "/")).href
  } catch {
    return null
  }
  const map = await loadSourceMap(url, { fetch: get })
  if (!map) return null
  const pos = originalPosition(map, src.line, src.col || null)
  if (!pos) return null
  const file = cleanSource(pos.source, { root, sources: pos.sources })
  if (isLibrary(file)) return { library: file, line: pos.line }
  return { file, line: pos.line, from: `${src.file}:${src.line}` }
}
