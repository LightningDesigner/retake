// A read-only handle for tests and debugging.
window.__waybackDock = {
  notes: () => notes,
  prompt: (n) => prompt(n),
  branches: () => branches.map((b) => ({ ...b, json: undefined, active: b.id === activeId })),
  scope: () => scopeEl,
}
