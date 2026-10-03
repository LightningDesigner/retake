// retake-dev's npm downloads over the last year, for the header. Fetched on
// the server and kept for an hour. 0 when npm doesn't answer (or there are
// none yet): the header then leaves the count out.
const URL = "https://api.npmjs.org/downloads/point/last-year/retake-dev"

export async function downloads(): Promise<number> {
  try {
    const res = await fetch(URL, { next: { revalidate: 3600 }, signal: AbortSignal.timeout(5000) })
    if (!res.ok) return 0
    const data: { downloads?: unknown } = await res.json()
    return typeof data.downloads === "number" && data.downloads > 0 ? data.downloads : 0
  } catch {
    return 0
  }
}
