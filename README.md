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

Other frameworks: `npx retake-dev -- next dev`, or put it in front of a dev server that's already running with `npx retake-dev http://localhost:3000`.

## Connect to your agent

Leave a note on any element and your coding agent gets the element, its React component, the source file and line, and the moment it was at. Copy it from the dock, or register the MCP server:

```bash
claude mcp add retake -- npx -y retake-dev mcp
```

Cursor, Codex and other MCP clients take the same command, `npx -y retake-dev mcp`.

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

[PolyForm Shield 1.0.0](LICENSE). Free to use and change; you can't use it to build a product that competes with Retake.
