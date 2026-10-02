// The island's markup, shared by the landing page's "Try it" grid and the
// playground (src/island.js makes it click through its states).
export function Island() {
  return (
    <>
      <button className="island" id="island" aria-label="Dynamic island. Click to change its state." data-state="0">
        <span className="view v0"><i className="led green"></i>Ready</span>
        <span className="view v1"><i className="led red"></i>Recording<b className="mono" id="island-clock">0:00</b></span>
        <span className="view v2"><i className="led amber"></i>Going back<span className="wave" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span></span>
        <span className="view v3"><span className="take-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 3v12"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="6" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg></span><span className="take-text"><b>Take 2 started</b><small className="mono">from 00:04.20</small></span></span>
      </button>
      <div className="steps-dots" aria-hidden="true"><i className="on"></i><i></i><i></i><i></i></div>
    </>
  )
}
