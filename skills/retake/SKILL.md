---
name: retake
description: Add Retake (npm retake-dev) to this project so the dev server runs with a timeline you can drag back. Use when asked to install, set up or add Retake.
---

# Set up Retake in this project

Retake is a dev-only timeline for the app's dev server. Nothing ships in the production build.

1. Find the package manager from the lockfile (`pnpm-lock.yaml`, `yarn.lock`, `bun.lock`/`bun.lockb`, else npm).
2. Install it as a dev dependency:
   - npm: `npm install -D retake-dev`
   - pnpm: `pnpm add -D retake-dev`
   - yarn: `yarn add -D retake-dev`
   - bun: `bun add -d retake-dev`
3. Add a script to `package.json`, next to the existing `dev` script:
   ```json
   "dev:retake": "retake ."
   ```
   `retake .` reads the project, picks its dev command (Vite, Next.js, React Router, Remix, Astro, SvelteKit, Nuxt) and runs it with the timeline in front. If the project's dev command is unusual, use `"dev:retake": "retake -- <the dev command>"` instead.
4. Vite projects only, optional: instead of the script, add the plugin so plain `npm run dev` has the timeline:
   ```js
   import { retake } from "retake-dev"
   // in defineConfig: plugins: [retake(), ...the existing plugins]
   ```
5. Always add `.retake/` to the project's root `.gitignore` (create the file if there isn't one). It holds local recordings and notes and must never be committed or pushed. Retake also writes a `.gitignore` inside `.retake/` as a second guard.
6. Optional, so notes reach you: register the MCP server, `npx -y retake-dev mcp` (Claude Code: `claude mcp add retake -- npx -y retake-dev mcp`).

Then tell the user to run `npm run dev:retake` (or their package manager's equivalent) and open the URL it prints, usually http://localhost:3014.

Don't change the existing `dev` script, the build, or any app code.
