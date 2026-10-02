// An in-memory stand-in for the /__retake/ session API (CONTRACT.md), so dock
// specs don't depend on the dev server having it. `store` survives reloads.
export async function fakeServer(page, { store = { session: null, recordings: {} }, events = [] } = {}) {
  page.__retakeFake = true
  const log = []
  await page.route("**/__retake/session", async (route) => {
    const req = route.request()
    log.push({ method: req.method(), path: "session", body: req.postData(), token: req.headers()["x-retake-token"] })
    if (req.method() === "PUT") {
      store.session = JSON.parse(req.postData())
      return route.fulfill({ status: 200, contentType: "application/json", body: "{}" })
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(store.session || {}) })
  })
  await page.route("**/__retake/recording/*", async (route) => {
    const req = route.request()
    const id = req.url().split("/").pop()
    log.push({ method: req.method(), path: "recording/" + id })
    if (req.method() === "PUT") {
      store.recordings[id] = req.postData()
      return route.fulfill({ status: 200, contentType: "application/json", body: "{}" })
    }
    if (!store.recordings[id]) return route.fulfill({ status: 404, body: "" })
    return route.fulfill({ status: 200, contentType: "application/json", body: store.recordings[id] })
  })
  await page.route("**/__retake/events", (route) =>
    route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
      body: events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e.data)}\n\n`).join("") + "retry: 60000\n\n",
    }),
  )
  return { store, log, puts: (p) => log.filter((l) => l.method === "PUT" && l.path === p) }
}
