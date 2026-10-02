// A handle for tests and debugging. `state` is the live dock state object.
window.__retakeDock = {
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
  goTo: (t, opts) => goTo(t, opts),
  building: () => (D.building ? { id: D.building.id, target: D.building.target, via: D.building.via, play: !!D.building.play, fork: !!D.building.fork, visible: !!D.building.visible, ready: !!D.building.pt } : null),
}
