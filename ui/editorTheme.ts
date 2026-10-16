import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import { settings, themes } from "@strudel/codemirror";
import { setTheme as setDrawTheme } from "@strudel/draw";

// The code editor's theme, built from Live's --live-* properties (see
// index.html and src/theme.ts) so it follows whichever theme is in use,
// including switches between light and dark, without being rebuilt.

/** The name the theme is registered under with @strudel/codemirror. */
export const LIVE_THEME = "live";

const live = (name: string) => `var(--live-${name})`;
const foreground = live("control-foreground");
const background = live("control-text-back");

/**
 * A syntax colour: `hue` pulled towards the theme's text colour, so it is dark
 * on light themes, light on dark ones, and takes on tinted themes' character.
 */
const tint = (hue: string, amount = 70) => `color-mix(in oklab, ${hue} ${amount}%, ${foreground})`;

/** `color` at `percent` opacity. */
const fade = (color: string, percent: number) => `color-mix(in srgb, ${color} ${percent}%, transparent)`;

// StrudelMirror makes .cm-editor transparent, so #editor (index.html) carries
// the background.
const editorTheme = EditorView.theme({
  "&": { color: foreground },
  ".cm-content": { caretColor: foreground },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: foreground },
  ".cm-gutters": { backgroundColor: background, color: live("text-disabled"), border: "none" },
  ".cm-activeLine": { backgroundColor: fade(foreground, 6) },
  ".cm-activeLineGutter": { backgroundColor: fade(foreground, 6), color: foreground },
  // Live's selection colour is light in every theme; under light text (dark
  // themes) it's toned down towards the background so the text stays readable.
  "&.cm-focused .cm-selectionBackground, & .cm-line::selection, & .cm-selectionLayer .cm-selectionBackground, .cm-content ::selection":
    {
      background: `light-dark(${live("selection-background")}, color-mix(in srgb, ${live("selection-background")} 40%, ${background})) !important`,
    },
  ".cm-selectionMatch": { backgroundColor: fade(live("search-indication"), 35) },
  ".cm-searchMatch": { backgroundColor: fade(live("search-indication"), 50) },
  ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: live("chosen-default") },
  "&.cm-focused .cm-matchingBracket": { backgroundColor: "transparent", outline: `1px solid ${live("text-disabled")}` },
  "&.cm-focused .cm-nonmatchingBracket": { backgroundColor: "transparent", outline: `1px solid ${live("alert")}` },

  // Search panel and tooltips: drawn like the dialog's other popups.
  ".cm-panels": { backgroundColor: live("surface-background"), color: foreground, font: "11px var(--dialog-font)" },
  ".cm-panels.cm-panels-top": { borderBottom: `1px solid ${live("control-contrast-frame")}` },
  ".cm-panel.cm-search": { padding: "4px 8px" },
  ".cm-panel.cm-search label": { fontSize: "inherit" },
  ".cm-panel.cm-search [name=close]": { color: foreground },
  ".cm-textfield, .cm-button": {
    boxSizing: "border-box",
    height: "15px",
    margin: "2px 4px 2px 0",
    padding: "0 6px",
    border: `1px solid ${live("control-contrast-frame")}`,
    borderRadius: "0",
    backgroundColor: live("control-background"),
    backgroundImage: "none",
    color: foreground,
    font: "inherit",
    verticalAlign: "middle",
  },
  ".cm-textfield:focus-visible, .cm-button:focus-visible": {
    outline: `1px solid ${live("control-selection-frame")}`,
    outlineOffset: "1px",
  },
  ".cm-button:active": {
    backgroundColor: live("chosen-default"),
    backgroundImage: "none",
    color: live("control-on-foreground"),
  },
  ".cm-panel input[type=checkbox]": { accentColor: live("chosen-default") },
  ".cm-tooltip": {
    border: `1px solid ${live("control-contrast-frame")}`,
    backgroundColor: live("surface-highlight"),
    color: foreground,
  },
  ".cm-tooltip-autocomplete ul li[aria-selected]": {
    backgroundColor: live("selection-background"),
    color: live("selection-foreground"),
  },
  ".cm-completionDetail, .cm-completionMatchedText": { color: "inherit" },
  ".cm-completionMatchedText": { textDecoration: "none", fontWeight: "bold" },
});

// Strudel also installs CodeMirror's default highlighting, so every tag that
// has a colour there needs one here.
const highlightStyle = HighlightStyle.define([
  {
    tag: [t.variableName, t.local(t.variableName), t.definition(t.variableName), t.className, t.typeName, t.namespace],
    color: foreground,
  },
  { tag: [t.comment, t.meta], color: live("text-disabled") },
  { tag: [t.string, t.special(t.string), t.regexp, t.escape], color: tint("#2fbf5f") },
  { tag: [t.number, t.bool, t.null, t.atom, t.literal], color: tint("#ff7a1a") },
  { tag: [t.keyword, t.operatorKeyword, t.definitionKeyword, t.moduleKeyword], color: tint("#a15cff") },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.propertyName], color: tint("#3a8dff") },
  // Labels name stems (`kick:`), so they get the theme's accent.
  { tag: t.labelName, color: tint(live("chosen-default")), fontWeight: "bold" },
  { tag: [t.punctuation, t.bracket, t.operator], color: fade(foreground, 70) },
  { tag: t.invalid, color: live("alert") },
]);

/**
 * Registers the theme with @strudel/codemirror, which looks themes up by name
 * (the `theme` editor setting) and sets CSS variables from their settings.
 */
export function registerLiveTheme() {
  themes[LIVE_THEME] = [editorTheme, syntaxHighlighting(highlightStyle)];
  // --foreground outlines the events that are playing (highlight.mjs).
  settings[LIVE_THEME] = { background, foreground, gutterForeground: live("text-disabled") };
}

/**
 * Hands Live's colours to @strudel/draw, whose visuals (`.pianoroll()` etc.)
 * draw on a canvas and so need actual colours rather than CSS variables. Call
 * it whenever the theme's colours may have changed.
 */
export function syncDrawTheme() {
  const style = getComputedStyle(document.documentElement);
  const color = (name: string) => style.getPropertyValue(`--live-${name}`).trim();
  setDrawTheme({
    ...settings[LIVE_THEME],
    background: color("control-text-back"),
    foreground: color("control-foreground"),
    gutterForeground: color("text-disabled"),
  });
}
