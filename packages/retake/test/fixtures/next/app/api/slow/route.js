// A slow request (a recording cut while it's in flight), counted per id.
const hits = (globalThis.__slowHits = globalThis.__slowHits || {})
export async function GET(req) {
  const id = new URL(req.url).searchParams.get("id") || ""
  if (new URL(req.url).searchParams.has("count")) return Response.json({ hits: hits[id] || 0 })
  hits[id] = (hits[id] || 0) + 1
  await new Promise((r) => setTimeout(r, 3000))
  return Response.json({ id, slow: true })
}
