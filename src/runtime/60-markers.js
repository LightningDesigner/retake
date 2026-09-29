// Markers without touching the app: conditions from a markers file, checked as
// time moves. Each fires when its condition turns true (text appears, or enough
// elements match a selector). Replays re-fire at the same moments; addMarker
// skips duplicates.

const MARKER_RULES = Array.isArray(W.__waybackMarkers) ? W.__waybackMarkers : []
const markerWas = new Map()
let markerCheckedAt = -Infinity

function markerHolds(rule) {
  if (rule.selector) {
    let n = 0
    try {
      n = document.querySelectorAll(rule.selector).length
    } catch {}
    if (n < (rule.count || 1)) return false
  }
  if (rule.text && !(document.body && document.body.textContent.includes(rule.text))) return false
  return !!(rule.selector || rule.text)
}

function checkMarkers() {
  if (!MARKER_RULES.length || clock.now - markerCheckedAt < 100) return
  markerCheckedAt = clock.now
  for (const rule of MARKER_RULES) {
    const now = markerHolds(rule)
    // Once per timeline unless the rule says `"repeat": true`.
    const seen = !rule.repeat && rec.markers.some((m) => m.label === rule.name && m.t <= clock.now)
    if (now && !markerWas.get(rule) && !seen) addMarker(rule.name, "rule")
    markerWas.set(rule, now)
  }
}
