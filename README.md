# strudel-live

An Ableton Live extension built with `@ableton-extensions/sdk` that renders
[Strudel](https://strudel.cc) code into audio clips. The code is stored inside
each clip's WAV file (in a custom `strd` RIFF chunk), so it is the clip's
source of truth and travels with the Live set.

![The Strudel editor dialog open over Live's Session View](docs/editor.png)

## Get Started

Learn about building extensions: https://ableton.github.io/extensions-sdk/

## Setup

- The path to Ableton Live's Extension Host module is stored in `.env` as
  `EXTENSION_HOST_PATH`. The generator filled this in for you; edit it if your
  install moves. The build also uses it to bundle Live's themes and fonts into
  the extension (`dist/live`); without it the editor uses built-in colours.
- Turn on **Developer Mode** in Live's settings, or `npm start` will fail with
  "Failed to connect to Live within 10s". Turn it off again to try an installed
  `.ablx`: in Developer Mode, Live doesn't run installed extensions.

## Usage

- Right-click an empty clip slot on an audio track → **New Strudel clip…** The
  editor starts with example code laid out as three scenes (see
  [Scenes](#scenes)), which adds two scenes below the slot and a track per part.
- Right-click a Strudel audio clip → **Edit Strudel…** to change its code and
  re-render it. The clip is replaced in place, keeping its color (a playing
  Session clip stops). For now this only works on the machine the clip was
  rendered on: Live doesn't let extensions read the clip's file, where its code
  is kept, so the extension keeps its own copy.

### Stems

Each labelled block in the code renders to its own clip, on a track named after
the label, so the parts can be mixed and processed separately in Live:

```js
kick: s("bd*4");
bass: note("<c2 ab1>(3,8)").s("sawtooth");
```

- Each stem's clip is named after its label, on every render. A clip from
  code without labels keeps the name you give it.
- The stems sit side by side: in the same Session row, or at the same
  Arrangement position. Editing any of them re-renders all of them in place.
- A new label goes on a free track with that name, or a new track. A label
  removed from the code has its clip deleted (the track stays).
- Muted blocks (`_kick:`) render silent clips. Anonymous `$:` blocks become
  "Strudel 1", "Strudel 2"… in order, so name blocks that should keep their
  track.
- Code without labels renders a single clip, as before.

### Scenes

In Session View, one piece of code can fill several scenes. Define each part
once, then list which parts play in each scene:

```js
let kick = s("bd*4");
let hat = s("hh*8").gain(0.6);
let rollinghat = s("hh*16").gain(0.4);
let bass = note("<c2 ab1>(3,8)").s("sawtooth");

scenes({
  intro: { hat },
  verse: { kick, hat, bass },
  drop: { kick, hat: rollinghat, bass }, // rollinghat goes on the hat track
});
```

- Each scene is a row, named after it, and each part is a track, named after
  its key (so `{ kick }` puts `kick` on a `kick` track). Clips are named after
  the variable they were written with, so `hat: rollinghat` puts a
  `rollinghat` clip on the `hat` track. A part left out of a
  scene has no clip there, so launching that scene stops its track.
- Rows match scenes by position: renaming a scene in code renames the Live
  scene, and reordering scenes moves their clips. Scenes added to the code are
  inserted below the group, moving the rest of the set down. A scene removed
  from the code has its clips deleted, but the Live scene stays.
- Every scene is rendered as its own loop of the editor's Bars length.
- Pick which scene **Preview** plays with the Scene menu, shown once the code
  has been evaluated.
- For now, code uses either labels or `scenes()`, not both, and scenes only
  work in Session View.

## How it works

- `src/extension.ts` registers the context menu actions and places rendered
  clips in Live.
- `src/server.ts` serves the editor UI on `127.0.0.1` and receives rendered
  audio from it.
- `ui/` is the editor dialog. It runs Strudel and renders patterns offline with
  an `OfflineAudioContext` at the song tempo (one cycle = one 4/4 bar), one
  render per labelled block.
- `src/wav.ts` writes 32-bit float WAVs with the `strd` chunk and reads it back.

## Scripts

```sh
npm start                  # build + run in Live's Extension Host, restricted as when installed
npm run build              # production build of the extension and UI
npm run build:dev          # dev build (sourcemaps, not minified)
npm run package            # build for production + create a .ablx archive (needs EXTENSION_HOST_PATH)
npm test                   # unit tests (Vitest)
npm run check              # typecheck + lint + format check + unit tests
npm run test:e2e           # build the UI + run the editor's browser tests (Playwright)
npm run release            # package the .ablx and publish it as a GitHub release
```

The browser tests drive the editor dialog in headless Chromium against the
real editor server, standing in for Live's dialog bridge. Install the browser
once with `npx playwright install chromium`. Anything that needs Live itself
still has to be checked by hand with `npm start`.

## Releasing

Releases are published from a Mac with Live installed, not from CI: the
`.ablx` bundles Live's themes and fonts from the Live in `EXTENSION_HOST_PATH`.

```sh
npm version 0.2.0 -m "Set the version to %s"  # bumps package.json and manifest.json, commits and tags v0.2.0
git push --follow-tags                         # then wait for CI to pass on main
npm run release                                # packages Strudel-Live-0.2.0.ablx and publishes the release
```

`npm run release` checks that `main` is clean, pushed and green in CI and that
the version isn't released yet, then packages the `.ablx`, pushes the tag (or
creates it, if you bumped the version by hand) and creates the GitHub release
with the `.ablx` attached and notes generated from the merged PRs. Pass
`-- --draft` to review the release before publishing it, or `-- --prerelease`.

## License

This project is licensed under [AGPL-3.0-or-later](LICENSE), the same license
as [Strudel](https://codeberg.org/uzu/strudel), which it bundles.

The Ableton Extensions SDK and CLI are proprietary and are not included in
this repository. They are installed from `vendor/`, which you populate with
your own copy of the SDK.
