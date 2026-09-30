import { forwardRef, memo, useId, useState } from "react"
import { createRoot } from "react-dom/client"

const FancyButton = memo(
  forwardRef(function FancyButton({ dim, onClick, children }, ref) {
    return (
      <button ref={ref} id="fancy" className={`btn primary ${dim ? "dim" : ""}`} onClick={onClick}>
        {children}
      </button>
    )
  }),
)

function Field() {
  const id = useId()
  return <label id={id} className="field">A field with a useId id</label>
}

function App() {
  const [dim, setDim] = useState(false)
  return (
    <main>
      <FancyButton dim={dim} onClick={() => setDim((d) => !d)}>Fade</FancyButton>
      <Field />
    </main>
  )
}

createRoot(document.getElementById("root")).render(<App />)
