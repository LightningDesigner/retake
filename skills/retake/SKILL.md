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
3. Make the timeline show on the project's normal dev URL. Pick one, by project:
   - **Next.js** (`next` in dependencies): add one file next to the `app/` or `pages/` folder (the project root, or `src/` when the app is in `src/app`). Check the installed Next version (`node_modules/next/package.json`).
     - Next 16: `proxy.ts`
       ```ts
       export { default } from "retake-dev/next"
       ```
     - Next 15: `middleware.ts` (Retake needs the Node.js runtime)
       ```ts
       import retake from "retake-dev/next"
       export default retake
       export const config = { runtime: "nodejs" }
       ```
     - A `proxy.ts` / `middleware.ts` already exists: keep it and wrap its default export instead, e.g. `export default withRetake(existingMiddleware)` with `import { withRetake } from "retake-dev/next"` (and on Next 15 make sure its config has `runtime: "nodejs"`). If it has a `matcher`, add these two entries to it, as written:
       ```ts
       "/__retake/:path*",
       { source: "/((?!_next/static|_next/image).*)", has: [{ type: "header", key: "sec-fetch-mode", value: "navigate" }] },
       ```
     It only runs in `next dev`; the production build is untouched.
   - **Vite apps** (a `vite.config` with an `index.html`, or React Router in framework mode): add the plugin, so plain `npm run dev` has the timeline:
     ```js
     import { retake } from "retake-dev"
     // in defineConfig: plugins: [retake(), ...the existing plugins]
     ```
   - **Anything else** (Nuxt, Astro, Remix, SvelteKit...): add a script to `package.json`, next to the existing `dev` script:
     ```json
     "dev:retake": "retake ."
     ```
     `retake .` reads the project, picks its dev command and runs it with the timeline in front. If the project's dev command is unusual, use `"dev:retake": "retake -- <the dev command>"` instead.
4. Only one of the three: don't add the script as well when the project has the Next.js file or the Vite plugin.
5. Always add `.retake/` to the project's root `.gitignore` (create the file if there isn't one). It holds local recordings and notes and must never be committed or pushed. Retake also writes a `.gitignore` inside `.retake/` as a second guard.
6. The skill installer leaves its own files: `.agents/skills/retake/`, `.claude/skills/retake` and `skills-lock.json`. They were only needed for this setup. Unless the project already commits skills on purpose, add them to `.gitignore` so they aren't committed:
   ```
   .agents/skills/retake/
   .claude/skills/retake
   skills-lock.json
   ```
7. Optional, so notes reach you: register the MCP server, `npx -y retake-dev mcp` (Claude Code: `claude mcp add retake -- npx -y retake-dev mcp`).

Then tell the user: with the Next.js file or the Vite plugin, run the usual `npm run dev` (or their package manager's equivalent) and open the usual dev URL; the timeline is docked at the bottom. With the script, run `npm run dev:retake` and open the URL it prints, usually http://localhost:3014.

Don't change the existing `dev` script, the build, or any app code (an existing middleware only gets wrapped).
