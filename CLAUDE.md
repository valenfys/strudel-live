# strudel-live

An Ableton Live extension that renders [Strudel](https://strudel.cc) code into
audio clips. See README.md for usage and the scripts.

## Layout

- `src/` runs in Live's Extension Host (Node, bundled to CJS by `build.ts`).
  - `extension.ts`: context menu actions, placing rendered clips in Live.
  - `server.ts`: local HTTP server that serves the editor dialog and receives
    renders.
  - `wav.ts`: 32-bit float WAV writer/reader with the `strd` chunk.
  - `renderBody.ts`: the render upload format, shared with `ui/`.
- `ui/` is the editor dialog (Vite, runs in Live's web view). It renders
  patterns offline with an `OfflineAudioContext`; one cycle = one 4/4 bar.
- `test/unit/` (Vitest) and `test/e2e/` (Playwright against the real editor
  server, with Live's dialog bridge stubbed out).
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
  with `ui/` (like `renderBody.ts`) must take such objects as parameters. Tests
  under plain Node won't catch this unless they stub the globals away, as
  `test/unit/server.test.ts` does; extend its list if Live lacks more.
- **`npm start` fails with "Failed to connect to Live within 10s"** unless
  Developer Mode is on in Live's settings. Check that first.
- The Ableton SDK and CLI are proprietary and installed from `vendor/`
  (gitignored). Never commit them.

## Verifying changes

- `npm run typecheck`, `npm test`, and `npm run test:e2e` (needs
  `npx playwright install chromium` once).
- Anything involving Live itself (context menus, clip placement, import) can
  only be checked by hand with `npm start`; say so rather than claiming it works.

## Conventions

- Branch names follow Conventional Branch: `feature/…`, `bugfix/…`,
  `chore/…`, `hotfix/…`, `release/…`. Non-trivial work goes on a branch and
  through a PR; small fixes may go to `main`.
- Commit and push as you go, in focused commits.
- `.idea/` is tracked on purpose (WebStorm project files); don't gitignore it.
- Use caret ranges in `package.json`, never exact pins; `package-lock.json`
  pins versions. This includes patched packages.
- License is AGPL-3.0-or-later, matching Strudel.
