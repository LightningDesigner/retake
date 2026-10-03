# Contributing

Thanks for taking a look. Bug reports with a small repro are the most useful thing you can send.

## Setup

```bash
pnpm install
pnpm test          # everything: engine + dock specs (Playwright, Chromium)
pnpm dev:site      # the landing page with the dock, on :3300
```

Node 22 or newer for working on the repo (the package itself runs on Node 18+).

## Layout

- `packages/retake/src/runtime/`: runs inside your app's frame (virtual clock, recorder, replay). Files are joined in filename order.
- `packages/retake/src/shell/`: the dock in the top window. Also joined in filename order.
- `packages/retake/src/server/`: the front server, the CLI helpers, the session API and the MCP server.
- `packages/retake/test/`: Playwright specs and fixture apps.

Read `CONTRACT.md` before changing anything that crosses the runtime, dock or server boundary.

## Pull requests

- One change per PR, with a test that fails without it.
- `pnpm test` and `pnpm --filter ./packages/retake typecheck` pass.
- Known-broken behaviour goes in as `test.fail()` with a comment saying why.

By contributing you agree your contribution is licensed under the repo's [license](LICENSE).
