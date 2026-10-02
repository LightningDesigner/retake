import { useState } from "react"
import { Link, Form, useActionData } from "react-router"
export async function loader() {
  return { at: "loaded" }
}
export async function action({ request }) {
  const f = await request.formData()
  return { echo: "server got " + f.get("n") }
}
export default function Home({ loaderData }) {
  const [n, setN] = useState(0)
  const a = useActionData()
  return (
    <main>
      <h1>home {loaderData.at}</h1>
      <button id="inc" onClick={() => setN(n + 1)}>
        count {n}
      </button>
      <Form method="post">
        <input type="hidden" name="n" value={n} />
        <button id="act">action</button>
      </Form>
      <span id="srv">{a?.echo}</span>
      <Link id="to-about" to="/about">
        about
      </Link>
    </main>
  )
}
