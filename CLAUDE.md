# strudel-live

An Ableton Live extension that renders [Strudel](https://strudel.cc) code into
audio clips. See README.md for usage and the scripts.

## Layout

- `src/` runs in Live's Extension Host (Node, bundled to CJS by `build.ts`).
  - `extension.ts`: context menu actions, placing rendered clips in Live.
  - `server.ts`: local HTTP server that serves the editor dialog and receives
    renders.
  - `wav.ts`: 32-bit float WAV writer/reader with the `strd` chunk.
  - `protocol.ts`: the host/UI contract (`SessionInput`, API paths,
    `BEATS_PER_CYCLE`), shared with `ui/`. Change both sides through it.
  - `renderBody.ts`: the render upload format, shared with `ui/`.
- `ui/` is the editor dialog (Vite, runs in Live's web view).
  - `main.ts`: DOM wiring and editor setup.
  - `render.ts`: renders patterns offline with an `OfflineAudioContext`; one
    cycle = one 4/4 bar.
  - `bridge.ts`: Live's dialog bridge (`closeWithResult`).
- `test/unit/` (Vitest) and `test/e2e/` (Playwright against the real editor
  server, with Live's dialog bridge stubbed out).
- `ci/ableton-sdk-stub/` stands in for the proprietary SDK in CI
  (`.github/workflows/ci.yml`). If `src/` imports more from the SDK, extend
  the stub or CI's typecheck fails.
- `patches/` holds patch-package patches for Strudel packages; they are applied
  on `npm install`.

## Design decisions

- A clip's Strudel code is stored in a custom `strd` RIFF chunk inside its WAV,
  so the clip is its own source of truth. This survives
  `resources.importIntoProject` (verified in Live 12.4). Build on the chunk
  (e.g. add fields to its JSON) rather than proposing sidecar files: the SDK has
  no per-clip or per-project storage.
- An audio clip's file can't be swapped, so editing creates a new clip: in the
  next empty Session slot, or in place in the Arrangement.

## Gotchas

- **Live's Extension Host lacks web-style globals** that plain Node has (`URL`,
  `URLSearchParams`, `TextEncoder`/`TextDecoder`, `fetch`, `Blob`, …). In `src/`
  always import from `node:*` (`import { URL } from "node:url"`). Code shared
  with `ui/` (like `renderBody.ts`) must take such objects as parameters. ESLint
  flags these globals in `src/`, and `test/unit/server.test.ts` stubs them away;
  if Live turns out to lack more, add them to both lists (`MISSING_IN_LIVE` in
  `eslint.config.js` and the test).
- **`npm start` fails with "Failed to connect to Live within 10s"** unless
  Developer Mode is on in Live's settings. Check that first.
- The Ableton SDK and CLI are proprietary and installed from `vendor/`
  (gitignored). Never commit them.

## Verifying changes

- `npm run check` runs typecheck, lint, format check and unit tests; run it
  before calling a change done. `npm run format` fixes formatting (Prettier,
  120 columns).
- `npm run test:e2e` builds the UI and runs the browser tests (needs
  `npx playwright install chromium` once).
- CI runs all of the above plus the production build on every PR, against the
  SDK stub, so it can't check how `src/extension.ts` uses the real SDK: the
  local typecheck does.
- Anything involving Live itself (context menus, clip placement, import) can
  only be checked by hand with `npm start`; say so rather than claiming it works.

## Conventions

- Branch names follow Conventional Branch: `feature/…`, `bugfix/…`,
  `chore/…`, `hotfix/…`, `release/…`.
- `main` is protected: every change goes through a PR, and CI's `check` job
  must pass before merging.
- PRs are merged with merge commits and their branches deleted. Before deleting
  a branch, retarget any PRs stacked on it (`gh pr list --base <branch>`):
  deleting a base branch closes them.
- Commit and push as you go, in focused commits.
- `.idea/` is tracked on purpose (WebStorm project files); don't gitignore it.
- Use caret ranges in `package.json`, never exact pins; `package-lock.json`
  pins versions. This includes patched packages.
- License is AGPL-3.0-or-later, matching Strudel.
