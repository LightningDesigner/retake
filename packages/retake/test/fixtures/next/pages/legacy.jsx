import { useState } from "react"
export async function getServerSideProps() {
  return { props: { from: "server" } }
}
export default function Legacy({ from }) {
  const [n, setN] = useState(0)
  return (
    <main>
      <h1 id="legacy">legacy {from}</h1>
      <button id="inc" onClick={() => setN(n + 1)}>
        count {n}
      </button>
    </main>
  )
}
