import Link from "next/link"
export default function About() {
  return (
    <main>
      <h1 id="about">about</h1>
      <Link id="to-home" href="/">
        home
      </Link>
      <a id="hard" href="/slow">
        hard nav
      </a>
      <iframe id="emb" src="/embed" width="200" height="40" />
    </main>
  )
}
