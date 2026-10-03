// The island's markup, on the playground (src/island.ts makes it click
// through its states: ready, recording, playing, upload done).
export function Island() {
  return (
    <>
      <button className="island" id="island" aria-label="Dynamic island. Click to change its state." data-state="0">
        <span className="view v0"><i className="led green"></i>Ready</span>
        <span className="view v1"><i className="led red"></i>Recording<b className="mono" id="island-clock">0:00</b></span>
        <span className="view v2"><i className="led amber"></i>Now playing<span className="wave" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span></span>
        <span className="view v3"><span className="take-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span><span className="take-text"><b>Upload done</b><small>3 photos, 4.2 MB</small></span></span>
      </button>
      <div className="steps-dots" aria-hidden="true"><i className="on"></i><i></i><i></i><i></i></div>
    </>
  )
}
