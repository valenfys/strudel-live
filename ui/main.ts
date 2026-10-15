import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { setDiagnostics } from "@codemirror/lint";
import { StateEffect } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import {
  codemirrorSettings,
  defaultSettings,
  StrudelMirror,
  type EditorSettings,
  type Keybindings,
} from "@strudel/codemirror";
import { evalScope, type Pattern } from "@strudel/core";
import { getDrawContext } from "@strudel/draw";
import { miniAllStrings } from "@strudel/mini";
import { transpiler } from "@strudel/transpiler";
import {
  getAudioContext,
  initAudioOnFirstClick,
  registerSynthSounds,
  samples,
  webaudioOutput,
} from "@strudel/webaudio";
import { cyclesPerSecond, RENDER_PATH, SESSION_PATH, type SessionInput } from "../src/protocol";
import { encodeRenderBody } from "../src/renderBody";
import { closeWithResult } from "./bridge";
import { queryOnsets, renderOffline } from "./render";
import { splitStems, tagStems } from "./stems";

// Overrides @strudel/codemirror's defaults (which suit strudel.cc's settings
// panel). Only the keymap is user-selectable here.
const EDITOR_SETTINGS = {
  isAutoCompletionEnabled: true,
  isTooltipEnabled: true,
  isBracketMatchingEnabled: true,
  isActiveLineHighlighted: true,
  isMultiCursorEnabled: true,
  isTabIndentationEnabled: true,
  fontFamily: "ui-monospace, Menlo, monospace",
  fontSize: 13,
};

const session = new URLSearchParams(location.search).get("session") ?? "";
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const editorRoot = $<HTMLDivElement>("editor");
const cyclesInput = $<HTMLInputElement>("cycles");
const keymapSelect = $<HTMLSelectElement>("keymap");
const previewButton = $<HTMLButtonElement>("preview");
const renderButton = $<HTMLButtonElement>("render");
const status = $<HTMLSpanElement>("status");
const isMac = /Mac/.test(navigator.platform);

let bpm = 120;
let mirror: StrudelMirror | undefined;
let lastEvalError: Error | undefined;
let previewing = false;

function setStatus(text: string, isError = false) {
  status.textContent = text;
  status.title = text;
  status.classList.toggle("error", isError);
}

// Underline the failing code for errors that carry a position (syntax errors
// from the transpiler's parser); other errors only show in the status bar.
function showEvalError(error: Error) {
  setStatus(error.message, true);
  if (!mirror) return;
  const { state } = mirror.editor;
  const pos = (error as { pos?: unknown }).pos;
  const diagnostics =
    typeof pos === "number" && pos <= state.doc.length
      ? [{ from: pos, to: Math.min(pos + 1, state.doc.length), severity: "error" as const, message: error.message }]
      : [];
  mirror.editor.dispatch(setDiagnostics(state, diagnostics));
}

function clearEvalError() {
  if (mirror) mirror.editor.dispatch(setDiagnostics(mirror.editor.state, []));
}

async function evaluatePattern(code: string, play: boolean): Promise<Pattern> {
  lastEvalError = undefined;
  const pattern = await mirror!.repl.evaluate(code, play);
  if (!pattern) throw lastEvalError ?? new Error("Code did not produce a pattern");
  return pattern;
}

async function render() {
  const code = mirror!.code;
  const cycles = Math.max(1, Math.round(Number(cyclesInput.value) || 1));
  renderButton.disabled = previewButton.disabled = true;
  try {
    stopPreview();
    const pattern = await evaluatePattern(code, false);
    // Query once, so random choices are the same in every stem.
    const haps = queryOnsets(pattern, cycles, bpm);
    const stems = splitStems(haps);
    const buffers: AudioBuffer[] = [];
    for (const [i, stem] of (stems ?? [{ label: "", haps }]).entries()) {
      const prefix = stems ? `${stem.label} (${i + 1}/${stems.length}): ` : "";
      buffers.push(await renderOffline(stem.haps, cycles, bpm, (message) => setStatus(prefix + message)));
    }
    const { sampleRate, numberOfChannels: channels } = buffers[0];
    setStatus("Sending to Live…");
    const response = await fetch(`${RENDER_PATH}?session=${session}`, {
      method: "POST",
      body: encodeRenderBody(
        { code, cycles, sampleRate, channels, stems: stems?.map((stem) => stem.label) },
        buffers.map((buffer) => Array.from({ length: channels }, (_, c) => buffer.getChannelData(c))),
        new TextEncoder(),
      ),
    });
    if (!response.ok) throw new Error(`Upload failed: ${response.status}`);
    closeWithResult("rendered");
  } catch (error) {
    console.error(error);
    if (error !== lastEvalError) setStatus(String((error as Error).message ?? error), true);
    renderButton.disabled = previewButton.disabled = false;
  }
}

function stopPreview() {
  if (previewing) mirror?.stop();
}

function togglePreview() {
  if (previewing) stopPreview();
  else mirror?.evaluate();
}

// StrudelMirror.updateSettings reconfigures every extension from the object it
// is given, so it always needs a complete settings object.
function updateEditorSettings(changes: Partial<EditorSettings>) {
  mirror?.updateSettings({ ...defaultSettings, ...codemirrorSettings.get(), ...EDITOR_SETTINGS, ...changes });
}

function setPreviewing(started: boolean) {
  previewing = started;
  previewButton.textContent = started ? "Stop" : "Preview";
  if (started) setStatus("Previewing");
  else if (!status.classList.contains("error")) setStatus(`Ready · ${bpm} BPM`);
}

async function main() {
  const response = await fetch(`${SESSION_PATH}?session=${session}`);
  if (!response.ok) throw new Error("Session not found");
  const input: SessionInput = await response.json();
  bpm = input.bpm;
  cyclesInput.value = String(input.cycles);

  initAudioOnFirstClick();
  miniAllStrings();
  const prebaked = Promise.all([
    evalScope(
      import("@strudel/core"),
      import("@strudel/mini"),
      import("@strudel/tonal"),
      import("@strudel/webaudio"),
      import("@strudel/draw"),
      import("@strudel/codemirror"),
    ),
    registerSynthSounds(),
    samples("github:tidalcycles/dirt-samples"),
  ]);

  mirror = new StrudelMirror({
    root: editorRoot,
    initialCode: input.code,
    prebake: () => prebaked,
    bgFill: false,
    drawContext: getDrawContext(),
    defaultOutput: webaudioOutput,
    // Not bound to one context: rendering swaps in an OfflineAudioContext.
    getTime: () => getAudioContext().currentTime,
    transpiler,
    onToggle: setPreviewing,
    beforeEval: tagStems,
    onEvalError: (error) => {
      lastEvalError = error;
      showEvalError(error);
    },
    afterEval: () => {
      clearEvalError();
      if (previewing) setStatus("Previewing");
    },
  });
  updateEditorSettings({});
  keymapSelect.value = codemirrorSettings.get().keybindings;
  mirror.editor.dispatch({
    effects: StateEffect.appendConfig.of([search({ top: true }), highlightSelectionMatches(), keymap.of(searchKeymap)]),
  });
  mirror.editor.focus();

  await prebaked;
  mirror.repl.setCps(cyclesPerSecond(bpm));
  renderButton.disabled = previewButton.disabled = false;
  setStatus(`Ready · ${bpm} BPM`);
}

renderButton.addEventListener("click", render);
previewButton.addEventListener("click", togglePreview);
keymapSelect.addEventListener("change", () => {
  updateEditorSettings({ keybindings: keymapSelect.value as Keybindings });
  mirror?.editor.focus();
});
$("cancel").addEventListener("click", () => {
  stopPreview();
  closeWithResult("cancel");
});
// Capture phase, so this wins over the editor's own Ctrl-Enter (preview).
window.addEventListener(
  "keydown",
  (event) => {
    if (event.key === "Enter" && (isMac ? event.metaKey : event.ctrlKey) && !event.altKey) {
      event.preventDefault();
      event.stopPropagation();
      if (!renderButton.disabled) render();
    }
  },
  true,
);

main().catch((error) => {
  console.error(error);
  setStatus(String(error.message ?? error), true);
});
