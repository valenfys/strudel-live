import * as fs from "node:fs";
import * as path from "node:path";

// Live's themes (.ask XML files) and fonts ship inside Live itself, so they're
// read from the running Live rather than copied into this repo: they're
// Ableton's. The Extension Host's node binary lives inside Live
// (Live.app/Contents/Helpers/ExtensionHost/node on macOS), so they're found by
// walking up from it.

/** Live's standard themes, used when the user hasn't chosen one. */
export const STANDARD_THEMES = { light: "Default Light Neutral Medium", dark: "Default Dark Neutral Medium" };

/** Where Live keeps its resources: App-Resources on macOS, Resources on Windows. */
export function findLiveResources(execPath = process.execPath): string | undefined {
  for (let dir = path.dirname(execPath); dir !== path.dirname(dir); dir = path.dirname(dir)) {
    for (const name of ["App-Resources", "Resources"]) {
      const candidate = path.join(dir, name);
      if (fs.existsSync(path.join(candidate, "Themes"))) return candidate;
    }
  }
  return undefined;
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
