// The link-preview card for every page (1200×630, rendered once at build time):
// the name, the line, and a timeline with its playhead pulled back.
import { ImageResponse } from "next/og"

export const alt = "Retake: rewind your app while you build it"
export const size = { width: 1200, height: 630 }
export const contentType = "image/png"

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", padding: "0 96px", background: "#121214", color: "#ececee" }}>
        <div style={{ fontSize: 148, fontWeight: 700, letterSpacing: "-0.06em", lineHeight: 1, color: "#fff" }}>Retake</div>
        <div style={{ fontSize: 40, color: "#8f8f8f", marginTop: 28, letterSpacing: "-0.01em" }}>Rewind your app while you build it.</div>
        <div style={{ position: "relative", display: "flex", marginTop: 88, width: 1008, height: 10, borderRadius: 5, background: "rgba(255,255,255,.1)" }}>
          <div style={{ width: 620, height: 10, borderRadius: 5, background: "#bda8fc" }} />
          <div style={{ position: "absolute", left: 420, top: -27, width: 6, height: 64, borderRadius: 3, background: "#ffffff" }} />
        </div>
        <div style={{ fontSize: 26, color: "#8f8f8f", marginTop: 40 }}>Vite · Next.js · React Router · Remix · Astro · SvelteKit · Nuxt</div>
      </div>
    ),
    size,
  )
}
