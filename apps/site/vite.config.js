import { defineConfig } from "vite"
import { retake } from "retake-dev"
import { demoApi } from "./server/demo-api.js"

// Retake is dev-only (`apply: "serve"`), so `vite build` ships none of it.
// The demo API (a fake streaming chat reply) is dev-only too.
export default defineConfig({
  plugins: [retake({ banner: true }), demoApi()],
  server: { port: 3300, strictPort: true },
  preview: { port: 3301 },
})
