import Counter from "./counter"
import Headline from "./headline"
import Draft from "./draft"
import Randoms from "./randoms"
import Hmr from "./hmr-target"
// Rendered on the server at each request: a rebuild that rendered the page
// again would show another time (F56).
export const dynamic = "force-dynamic"
export default function Page() {
  return (
    <main>
      <h1>home</h1>
      <p id="served">{String(Date.now())}</p>
      <Headline />
      <Counter />
      <Draft />
      <Randoms />
      <Hmr />
    </main>
  )
}
