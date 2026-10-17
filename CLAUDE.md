# strudel-live

An Ableton Live extension that renders [Strudel](https://strudel.cc) code into
audio clips. See README.md for usage and the scripts.

## Layout

- `src/` runs in Live's Extension Host (Node, bundled to CJS by `build.ts`).
  - `extension.ts`: context menu actions, placing rendered clips in Live.
  - `server.ts`: local HTTP server that serves the editor dialog and receives
    renders.
  - `wav.ts`: 32-bit float WAV writer/reader with the `strd` chunk.
  - `clipStore.ts`: each clip's Strudel data in the storage directory, found
    by the ID that starts its file name.
  - `protocol.ts`: the host/UI contract (`SessionInput`, API paths,
    `BEATS_PER_CYCLE`), shared with `ui/`. Change both sides through it.
  - `renderBody.ts`: the render upload format, shared with `ui/`.
  - `starter.ts`: the code a new clip starts with.
  - `theme.ts`: Live's themes (`.ask` files) and fonts, bundled at build time
    into `dist/live` from the Live in `EXTENSION_HOST_PATH` and turned into CSS
    for the dialog (`--live-*` properties).
- `ui/` is the editor dialog (Vite, runs in Live's web view).
  - `main.ts`: DOM wiring and editor setup.
  - `stems.ts`: splits a pattern's events by label, one stem each.
  - `scenes.ts`: the `scenes()` function exposed to Strudel code.
  - `render.ts`: renders patterns offline with an `OfflineAudioContext`; one
    cycle = one 4/4 bar.
  - `bridge.ts`: Live's dialog bridge (`closeWithResult`).
- `test/unit/` (Vitest) and `test/e2e/` (Playwright against the real editor
  server, with Live's dialog bridge stubbed out).
- `release.ts` (`npm run release`) publishes a GitHub release with the
  `.ablx`, locally since it needs Live (see README's Releasing).
- `ci/ableton-sdk-stub/` stands in for the proprietary SDK in CI
  (`.github/workflows/ci.yml`). If `src/` imports more from the SDK, extend
  the stub or CI's typecheck fails.
- `patches/` holds patch-package patches for Strudel packages; they are applied
  on `npm install`.

## Design decisions

- A clip's Strudel code is stored in a custom `strd` RIFF chunk inside its WAV,
  so the clip carries its own code and it travels with the Set. This survives
  `resources.importIntoProject` (verified in Live 12.4). An installed extension
  can't read the project's files, though (see Gotchas), so editing reads a copy
  from the storage directory (`clipStore.ts`), keyed by the UUID that starts
  the WAV's file name (`strudel-<id>….wav`). That copy is per machine: editing
  a clip rendered elsewhere needs a way to read its chunk (#52). Keep writing
  both. The SDK has no per-clip or per-project storage.
- An audio clip's file can't be swapped, so editing replaces the clip with a
  new one in the same place. This stops a playing Session clip; that's
  accepted, since the tool is for producing rather than live performance.
- Each labelled block (`kick: …`) renders to its own stem: a clip on a track
  named after the label. A group's stems share a `group` id in their `strd`
  chunk and sit in the same Session row or at the same Arrangement position.
  `ui/stems.ts` wraps Strudel's `.p()` to tag events with their label.
- `scenes({ verse: { kick, hat } })` (`ui/scenes.ts`) lays one piece of code out
  as Session scenes: rows match scenes by position, and each clip's `strd`
  stores its scene index and all scene names, so editing any clip finds the
  group's block of rows.

## Gotchas

- **Live's Extension Host lacks web-style globals** that plain Node has (`URL`,
  `URLSearchParams`, `TextEncoder`/`TextDecoder`, `fetch`, `Blob`, …). In `src/`
  always import from `node:*` (`import { URL } from "node:url"`). Code shared
  with `ui/` (like `renderBody.ts`) must take such objects as parameters. ESLint
  flags these globals in `src/`, and `test/unit/server.test.ts` stubs them away;
  if Live turns out to lack more, add them to both lists (`MISSING_IN_LIVE` in
  `eslint.config.js` and the test).
- **Installed extensions may only touch their own files.** Live runs them
  under Node's permission model: read access to the extension's directory and
  its `storageDirectory` and `tempDirectory`, write access to the last two.
  Anything else (Live's own resources, the project's audio files) throws
  `ERR_ACCESS_DENIED`, even `fs.existsSync`. Bundle what's needed at build time
  instead (as `build.ts` does with Live's themes). `start.ts` (`npm start`)
  applies the same restrictions, so this shows up in development; if Live's
  flags change, update it to match (see them with `ps` while Live runs).
- **`npm start` fails with "Failed to connect to Live within 10s"** unless
  Developer Mode is on in Live's settings. Check that first. Conversely, with
  Developer Mode on Live doesn't run installed `.ablx` extensions at all.
- Live-hosted Extension Host logs, with the extension's console output, go to
  `~/Library/Preferences/Ableton/Live x.x.x/ExtensionHost.txt` on macOS.
- The Ableton SDK and CLI are proprietary and installed from `vendor/`
  (gitignored). Never commit them. `vendor/` also holds the rest of the SDK
  zip: the guides (`vendor/docs/`, HTML), the API reference (`vendor/api/`)
  and examples (`vendor/examples/`). Check them for how Live behaves before
  guessing.

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
- Non-trivial work goes on a branch and through a PR, merged once CI passes;
  small fixes may be committed straight to `main`. Force-pushing to (or
  deleting) `main` is blocked.
- PRs are merged with merge commits and their branches deleted. Before deleting
  a branch, retarget any PRs stacked on it (`gh pr list --base <branch>`):
  deleting a base branch closes them.
- Commit and push as you go, in focused commits.
- Track known limitations, follow-ups and checks still to do in Live as GitHub
  issues rather than only mentioning them; check open issues first. Give each
  manual check its own issue (or add it to an existing issue about the same
  feature) with the `check in Live` label, rather than one tracking issue.
  Close issues when a PR resolves them.
- `.idea/` is tracked on purpose (WebStorm project files); don't gitignore it.
- Use caret ranges in `package.json`, never exact pins; `package-lock.json`
  pins versions. This includes patched packages.
- License is AGPL-3.0-or-later, matching Strudel.
