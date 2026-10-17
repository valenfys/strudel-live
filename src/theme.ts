import * as fs from "node:fs";
import * as path from "node:path";

// Live's themes (.ask XML files) and fonts ship inside Live itself. The
// installed extension can't read them there: Live runs it under Node's
// permission model, with read access only to the extension's own directory and
// its storage and temp directories. So the build (scripts/build.ts) reads them from the
// Live that EXTENSION_HOST_PATH points at and bundles them next to the
// extension, in the layout of LIVE_ASSETS, for the editor server to serve.

/** Live's standard themes, used when the user hasn't chosen one. */
export const STANDARD_THEMES = { light: "Default Light Neutral Medium", dark: "Default Dark Neutral Medium" };

/** The bundled Live assets, relative to their directory (dist/live). */
export const LIVE_ASSETS = {
  /** Every theme's colours, as `{ [theme]: { [name]: colour } }`. */
  themes: "themes.json",
  /** The font files in FONT_FILES. */
  fonts: "fonts",
};

/**
 * Where Live keeps its resources (App-Resources on macOS, Resources on
 * Windows), given a path inside Live or to Live itself: the Extension Host
 * module, its node binary, or Live.app.
 */
export function findLiveResources(livePath: string): string | undefined {
  for (let dir = livePath; dir !== path.dirname(dir); dir = path.dirname(dir)) {
    for (const name of ["App-Resources", "Contents/App-Resources", "Resources"]) {
      const candidate = path.join(dir, name);
      if (fs.existsSync(path.join(candidate, "Themes"))) return candidate;
    }
  }
  return undefined;
}

/** Bundles the themes and fonts from Live's resources into `outDir`, in the layout of LIVE_ASSETS. */
export function bundleLiveAssets(resources: string, outDir: string): { themes: number; fonts: number } {
  const themesDirectory = path.join(resources, "Themes");
  const themes = Object.fromEntries(
    listThemes(themesDirectory).map((name) => [
      name,
      Object.fromEntries(parseTheme(fs.readFileSync(path.join(themesDirectory, `${name}.ask`), "utf8"))),
    ]),
  );
  fs.mkdirSync(path.join(outDir, LIVE_ASSETS.fonts), { recursive: true });
  fs.writeFileSync(path.join(outDir, LIVE_ASSETS.themes), JSON.stringify(themes));
  let fonts = 0;
  for (const file of Object.keys(FONT_FILES)) {
    const source = path.join(resources, "Fonts", file);
    if (!fs.existsSync(source)) continue;
    fs.copyFileSync(source, path.join(outDir, LIVE_ASSETS.fonts, file));
    fonts++;
  }
  return { themes: Object.keys(themes).length, fonts };
}

/** Reads bundled themes (LIVE_ASSETS.themes), by name. */
export function readBundledThemes(file: string): Map<string, Map<string, string>> {
  const themes: Record<string, Record<string, string>> = JSON.parse(fs.readFileSync(file, "utf8"));
  return new Map(Object.entries(themes).map(([name, colors]) => [name, new Map(Object.entries(colors))]));
}

/** The names of the themes in a Themes directory, sorted. */
export function listThemes(themesDirectory: string): string[] {
  return fs
    .readdirSync(themesDirectory)
    .filter((file) => file.endsWith(".ask"))
    .map((file) => file.slice(0, -".ask".length))
    .sort();
}

/**
 * A theme's colours, by name. Only the theme's own colours count: nested
 * settings (such as a VU meter's) are skipped, and so are non-colour values
 * (blend factors and the like).
 */
export function parseTheme(xml: string): Map<string, string> {
  const colors = new Map<string, string>();
  let depth = 0;
  for (const match of xml.matchAll(/<(\/?)([\w.]+)([^>]*?)(\/?)>/g)) {
    const [, closing, name, attributes, selfClosing] = match;
    if (closing) depth--;
    else if (!selfClosing) depth++;
    // Inside <Ableton><Theme>: depth 2.
    else if (depth === 2) {
      const value = /Value="(#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?)"/.exec(attributes)?.[1];
      if (value) colors.set(name, value.toLowerCase());
    }
  }
  return colors;
}

/** `ControlBackground` → `--live-control-background`. */
export function cssVariable(name: string): string {
  return `--live-${name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase()}`;
}

function declarations(colors: Map<string, string>): string {
  return [...colors].map(([name, value]) => `  ${cssVariable(name)}: ${value};`).join("\n");
}

/**
 * A stylesheet setting each colour of a theme as a CSS custom property. With
 * a light and a dark theme, it follows the system appearance.
 */
export function themeCss(theme: Map<string, string> | { light: Map<string, string>; dark: Map<string, string> }) {
  if (theme instanceof Map) {
    // So native parts (scrollbars, menus) match the theme too.
    const scheme = isDark(theme) ? "dark" : "light";
    return `:root {\n  color-scheme: ${scheme};\n${declarations(theme)}\n}\n`;
  }
  return (
    `:root {\n  color-scheme: light;\n${declarations(theme.light)}\n}\n` +
    `@media (prefers-color-scheme: dark) {\n  :root {\n    color-scheme: dark;\n` +
    declarations(theme.dark).replace(/^/gm, "  ") +
    `\n  }\n}\n`
  );
}

function isDark(colors: Map<string, string>): boolean {
  const hex = colors.get("SurfaceBackground");
  if (!hex) return true;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b < 128;
}

/** Ableton Sans, as Live's interface uses it. Served from Live's Fonts directory. */
export const FONT_FILES = { "AbletonSansSmall-Regular.ttf": 400, "AbletonSansSmall-Bold.ttf": 700 };

/** `@font-face` rules for Ableton Sans, loaded from `fontsPath`. */
export function fontCss(fontsPath: string): string {
  return Object.entries(FONT_FILES)
    .map(
      ([file, weight]) =>
        `@font-face {\n  font-family: "Ableton Sans Small";\n  font-weight: ${weight};\n  src: url("${fontsPath}${file}");\n}\n`,
    )
    .join("");
}
