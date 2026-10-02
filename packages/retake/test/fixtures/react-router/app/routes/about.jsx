import { Link } from "react-router"
export async function loader() {
  return { msg: "about loader" }
}
export default function About({ loaderData }) {
  return (
    <main>
      <h1 id="about">{loaderData.msg}</h1>
      <Link id="to-home" to="/">
        home
      </Link>
    </main>
  )
}
