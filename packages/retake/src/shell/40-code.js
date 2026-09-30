// Code versions per timeline (with `--code-branches`): when the prototype's
// source changes, the timeline you're on takes the new code and the moment is
// rebuilt on it. Each timeline remembers its code; stepping into one checks its
// code back out, so timelines can differ in code as well as in what happened.

const CODE_BRANCHES = !!(window.__waybackConfig && window.__waybackConfig.codeBranches)

// Checks a version out. { ok } once the files on disk are that version;
// `left` is the snapshot the server took of the files just before (the real
// code of the timeline being left, edits of the last moments included).
async function checkoutCode(version) {
  try {
    const r = await api("POST", `checkout?v=${encodeURIComponent(version)}`)
    if (r.missing) return { ok: false }
    const v = r.value && typeof r.value === "object" ? r.value : {}
    return { ok: v.ok !== false, left: v.left || null }
  } catch (err) {
    console.warn("[retake] couldn't check out that timeline's code", err)
    return { ok: false }
  }
}

// What the server last said about the code on disk.
const code = { newest: null }
async function codeState() {
  try {
    const v = await (await fetch("/__wayback/version")).json()
    return v && v.version ? v : null
  } catch {
    return null
  }
}

// After a checkout: the timeline we left gets the code it really had. The
// server says so (`left`); an older server doesn't, so a snapshot that
// appeared during the checkout and belongs to no timeline is taken as it.
async function settleLeftVersion(leaving, r) {
  if (!leaving) return
  if (r.left) {
    leaving.version = r.left
    return
  }
  const v = await codeState()
  if (v && v.newest && v.newest !== code.newest && !D.branches.some((b) => b.version === v.newest)) leaving.version = v.newest
  if (v && v.newest) code.newest = v.newest
}

if (CODE_BRANCHES) {
  setInterval(async () => {
    if (D.switching || !D.PT || D.building || net.restoring) return
    const v = await codeState()
    if (!v || D.switching || !D.PT || D.building) return
    const version = v.version
    const cur = activeBranch()
    // Code the server put back at startup isn't an edit made on this
    // timeline: put this timeline's own code back instead of adopting it.
    if (v.restored) {
      if (cur.version && version !== cur.version) await checkoutCode(cur.version)
      else if (!cur.version) cur.version = version
      return
    }
    if (v.newest) code.newest = v.newest
    if (!cur.version) {
      cur.version = version
      return
    }
    if (version === cur.version) return
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
