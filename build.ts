import * as esbuild from "esbuild";
import * as fs from "node:fs";
import * as path from "node:path";
import { bundleLiveAssets, findLiveResources } from "./src/theme.js";

const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
const production = process.argv.includes("--production");
// For packaging: an .ablx without Live's themes would quietly fall back to the editor's built-in colours.
const requireLive = process.argv.includes("--require-live");

await esbuild.build({
  entryPoints: ["src/extension.ts"],
  outfile: manifest.entry,
  bundle: true,
  format: "cjs",
  platform: "node",
  sourcesContent: false,
  logLevel: "info",
  minify: production,
  sourcemap: !production,
});

// Live's themes and fonts, bundled from the Live on this machine: the
// installed extension isn't allowed to read them from Live (see src/theme.ts).
try {
  process.loadEnvFile();
} catch {
  // No .env (as in CI): EXTENSION_HOST_PATH may still be set in the environment.
}
const liveAssets = path.join(path.dirname(manifest.entry), "live");
fs.rmSync(liveAssets, { recursive: true, force: true });
const host = process.env.EXTENSION_HOST_PATH;
const resources = host && findLiveResources(host);
if (resources) {
  const { themes, fonts } = bundleLiveAssets(resources, liveAssets);
  console.log(`Bundled ${themes} themes and ${fonts} fonts from ${resources} into ${liveAssets}`);
} else if (requireLive) {
  console.error("Live's themes weren't found: set EXTENSION_HOST_PATH (see README) to bundle them.");
  process.exit(1);
} else {
  console.warn("Live's themes weren't found (EXTENSION_HOST_PATH); the editor will use its built-in colours.");
}
