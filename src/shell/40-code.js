// Code branches (with `--code-branches`): when the prototype's source changes,
// the timeline forks at the current moment. The old branch keeps the old code,
// the new one runs the new code from that moment on. Stepping into a branch
// checks its code back out.

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
    // On a scoped preview, build that moment for real first; the next check
    // branches from it.
    if (PT.state().previewing) return PT.seek(PT.state().previewAt)
    // The code changed under the current moment: branch here onto it.
    const t = PT.state().now
    PT.pause()
    PT.forkHere()
    const b = activeBranch()
    b.version = version
    b.name = `Timeline ${b.id} · new code`
    PT.load(JSON.stringify(PT.history()), t)
  }, 500)
}
