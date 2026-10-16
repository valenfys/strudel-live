// Shared by the extension host (src/) and the editor dialog (ui/). Like
// renderBody.ts, this must not use web-style globals: Live's Extension Host
// lacks them.

/** One Strudel cycle is one 4/4 bar. */
export const BEATS_PER_CYCLE = 4;

export function cyclesPerSecond(bpm: number): number {
  return bpm / 60 / BEATS_PER_CYCLE;
}

/** GET ?session=<id> → SessionInput as JSON. */
export const SESSION_PATH = "/api/session";
/** POST ?session=<id> with a render body (see renderBody.ts) → 204. */
export const RENDER_PATH = "/api/render";

/** What the editor dialog starts from. */
export interface SessionInput {
  code: string;
  cycles: number;
  bpm: number;
  /** Where the clip is. `scenes()` only works in Session View. */
  view: "session" | "arrangement";
}

/** GET → Live's colours as CSS custom properties (`--live-control-background`, …) and its font. */
export const THEME_CSS_PATH = "/live/theme.css";
/** GET → ThemeSettings as JSON. PUT a ThemeChoice as JSON → 204. */
export const THEMES_PATH = "/api/themes";

export interface ThemeSettings {
  /** The themes in Live, by name. Empty if Live's themes weren't found. */
  themes: string[];
  /** The chosen theme, or null to follow the system appearance. */
  theme: string | null;
}

export type ThemeChoice = Pick<ThemeSettings, "theme">;
