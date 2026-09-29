// Code versions per timeline (with `--code-branches`): when the prototype's
// source changes, the timeline you're on takes the new code and the moment is
// rebuilt on it. Each timeline remembers its code; stepping into one checks its
// code back out, so timelines can differ in code as well as in what happened.

const CODE_BRANCHES = !!(window.__waybackConfig && window.__waybackConfig.codeBranches)

async function checkoutCode(version) {
  await fetch(`/__wayback/checkout?v=${encodeURIComponent(version)}`)
}

if (CODE_BRANCHES) {
  setInterval(async () => {
    if (switching || !PT || building) return
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
    if (version === cur.version || switching || !PT) return
    // Not recording yet: just show the new code.
    if (!PT.state().started) {
      cur.version = version
      return freshFrame()
    }
    // The code changed: the timeline you're on takes it (no new timeline;
    // those only come from the +). Rebuild this moment on the new code.
    const st = PT.state()
    const t = st.previewing ? st.previewAt : st.now
    cur.version = version
    PT.load(JSON.stringify(PT.history()), t)
  }, 500)
}
