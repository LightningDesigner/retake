# Retake

**[Retake](https://retake-omega.vercel.app)** is a time machine for your dev server. A timeline docks under your app and records from the moment the page loads. Drag it back and the app is really at that moment: the DOM, the timers, the network, the animations. Try something else from there and the old take stays one click away.

Works with Vite, Next.js, React Router, Remix, Astro, SvelteKit and Nuxt. Dev only: nothing ships in your build.

## Install

```bash
npx retake-dev .
```

Run it from your app's folder and open the URL it prints. Your files aren't touched. To keep it in the project:

```bash
npm install retake-dev -D
```

On Vite you can also add the plugin and keep `npm run dev`:

```js
import { retake } from "retake-dev"

export default defineConfig({
  plugins: [retake()],
})
```

On Next.js add one file and keep `next dev`: the timeline shows on your usual dev URL.

```ts
// proxy.ts (Next 16)
export { default } from "retake-dev/next"
```

On Next 15 it's `middleware.ts`: `import retake from "retake-dev/next"`, `export default retake` and `export const config = { runtime: "nodejs" }`.

Other frameworks: `npx retake-dev -- <your dev command>`, or put it in front of a dev server that's already running with `npx retake-dev http://localhost:3000`.

## Install with your agent

Paste this into Claude Code, Cursor or any coding agent:

```text
Add Retake to this project so its timeline shows on the normal dev URL: install retake-dev as a dev dependency with the project's package manager. Put the Next file next to the app/ folder (the root, or src/ for src/app). Next.js 16: add proxy.ts with export { default } from "retake-dev/next". Next.js 15: add middleware.ts with import retake from "retake-dev/next", export default retake, export const config = { runtime: "nodejs" }. If a proxy or middleware already exists, wrap its default export in withRetake from "retake-dev/next". Vite: add retake() from "retake-dev" to the Vite plugins. Anything else: add a "dev:retake": "retake ." script to package.json. Add .retake/ to .gitignore, and don't change anything else. Docs: https://retake-omega.vercel.app/docs/install
```

Or install the skill and run `/retake`:

```bash
npx skills add LightningDesigner/retake
```

## Connect to your agent

Leave a note on any element and your coding agent gets the element, its React component, the source file and line, and the moment it was at. Copy it from the dock, or register the MCP server:

```bash
claude mcp add retake -- npx -y retake-dev mcp
```

Cursor, Codex and other MCP clients take the same command, `npx -y retake-dev mcp`.

A note is pinned to a moment of the recording, so the agent can read what happened around it (clicks, animations on the element with their start and end, requests) with `get_moment` instead of asking you. The `retake-notes` skill shows it how to work through notes:

```bash
npx skills add LightningDesigner/retake
```

(It installs both skills: `retake` to set Retake up, `retake-notes` to act on notes.)

## Features

- **Scrub back**: drag the playhead and the app follows, frame by frame
- **Real moments**: let go and the page is rebuilt at that moment, not a screenshot
- **Takes**: Ctrl-click the timeline to branch; every take stays as a lane
- **Notes**: hold ⌘ and click an element to leave a note pinned to that moment
- **Any framework**: one front server in front of your dev server, HMR included
- **Nothing in production**: `vite build` and `next build` output have no Retake code

Full docs: [packages/retake/README.md](packages/retake/README.md).

## Repo

- `packages/retake`: the npm package (`retake-dev`)
- `apps/site`: the landing page
- `CONTRACT.md`: how the runtime, the dock and the server talk

## License

© 2026 Rushil

Licensed under [PolyForm Shield 1.0.0](LICENSE)
