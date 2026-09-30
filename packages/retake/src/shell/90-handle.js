// A handle for tests and debugging. `state` is the live dock state object.
window.__waybackDock = {
  state: D,
  notes: () => D.notes,
  prompt: (n) => prompt(n),
  branches: () => D.branches.map((b) => ({ ...b, json: undefined, active: b.id === D.activeId })),
  scope: () => D.scopeEl,
  deleteTimeline: (id) => deleteTimeline(id),
  switchTo: (id, t) => switchTo(id, t),
  newTimelineAt: (t) => newTimelineAt(t),
  fitAll: () => fitAll(),
  checkpoint: () => (D.cp ? { at: D.cp.at, branchId: D.cp.branchId, ready: checkpointReady(D.cp) } : null),
}
