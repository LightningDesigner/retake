// Code versions per timeline (with `--code-branches`): when the prototype's
// source changes, the timeline you're on takes the new code and the moment is
// rebuilt on it. Each timeline remembers its code; stepping into one checks its
// code back out, so timelines can differ in code as well as in what happened.

const CODE_BRANCHES = !!(window.__waybackConfig && window.__waybackConfig.codeBranches)

// Returns true once the files on disk are that version.
async function checkoutCode(version) {
  try {
    const r = await api("POST", `checkout?v=${encodeURIComponent(version)}`)
    return !r.missing && (!r.value || r.value.ok !== false)
  } catch (err) {
    console.warn("[retake] couldn't check out that timeline's code", err)
    return false
  }
}

if (CODE_BRANCHES) {
  setInterval(async () => {
    if (D.switching || !D.PT || D.building || net.restoring) return
    let version
    try {
      version = (await (await fetch("/__wayback/version")).json()).version
    } catch {
      return
    }
    const cur = activeBranch()
    if (!cur.version) {
      cur.version = version
      return
    }
    if (version === cur.version || D.switching || !D.PT) return
    // Not recording yet: just show the new code.
    if (!D.PT.state().started) {
      cur.version = version
      return freshFrame()
    }
    // The code changed: the timeline you're on takes it (no new timeline;
    // those only come from the +). Rebuild this moment on the new code.
    const st = D.PT.state()
    const t = st.previewing ? st.previewAt : st.now
    cur.version = version
    D.PT.load(JSON.stringify(D.PT.history()), t)
  }, 500)
}
