import { Suspense } from "react"
async function Late() {
  await new Promise((r) => setTimeout(r, 300))
  return <p id="late">streamed</p>
}
export default function Stream() {
  return (
    <main>
      <h1>stream</h1>
      <Suspense fallback={<p id="wait">waiting</p>}>
        <Late />
      </Suspense>
    </main>
  )
}
