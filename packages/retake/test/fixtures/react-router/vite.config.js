import { reactRouter } from "@react-router/dev/vite"
import { defineConfig } from "vite"
// The port Retake gives it (PORT), so the tests stay in their own range.
export default defineConfig({ plugins: [reactRouter()], server: { port: Number(process.env.PORT) || 5173, strictPort: true } })
