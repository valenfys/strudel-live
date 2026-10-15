import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { setDiagnostics } from "@codemirror/lint";
import { StateEffect } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { codemirrorSettings, defaultSettings, StrudelMirror, type EditorSettings, type Keybindings } from "@strudel/codemirror";
import { evalScope, type Pattern } from "@strudel/core";
import { getDrawContext } from "@strudel/draw";
import { miniAllStrings } from "@strudel/mini";
import { transpiler } from "@strudel/transpiler";
import {
  getAudioContext,
  initAudio,
  initAudioOnFirstClick,
  registerSynthSounds,
  resetGlobalEffects,
  samples,
  setAudioContext,
  setSuperdoughAudioController,
  superdough,
  webaudioOutput,
} from "@strudel/webaudio";

const SAMPLE_RATE = 48000;
const CHANNELS = 2;
const BEATS_PER_CYCLE = 4;

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

// Send a result back to the extension host and close this dialog.
function closeWithResult(result: string) {
  const message = { method: "close_and_send", params: [result] };
  const w = window as any;
  if (w.webkit?.messageHandlers?.live) {
    w.webkit.messageHandlers.live.postMessage(message);
  } else if (w.chrome?.webview) {
    w.chrome.webview.postMessage(message);
  } else {
    console.log("closeWithResult:", result);
  }
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

// Based on renderPatternAudio from @strudel/webaudio, which downloads the
// result instead of returning it.
async function renderOffline(pattern: Pattern, cycles: number): Promise<AudioBuffer> {
  const cps = bpm / 60 / BEATS_PER_CYCLE;
  await getAudioContext().close();
  const context = new OfflineAudioContext(
    CHANNELS,
    Math.round((cycles / cps) * SAMPLE_RATE),
    SAMPLE_RATE,
  );
  setAudioContext(context);
  // Let superdough lazily create a controller for the offline context.
  setSuperdoughAudioController(null);
  try {
    await initAudio({ multiChannelOrbits: false });
    // Ascending onset order matters for controls like `cut`.
    const haps = pattern
      .queryArc(0, cycles, { _cps: cps })
      .filter((hap) => hap.hasOnset())
      .sort((a, b) => a.whole!.begin.valueOf() - b.whole!.begin.valueOf());
    for (const [i, hap] of haps.entries()) {
      setStatus(`Scheduling ${i + 1}/${haps.length}…`);
      const onset = hap.whole!.begin.valueOf() / cps;
      hap.ensureObjectValue();
      try {
        await superdough(hap.value, onset, hap.duration / cps, cps, onset);
      } catch (error) {
        console.warn("superdough failed for hap", hap, error);
      }
    }
    setStatus("Rendering…");
    return await context.startRendering();
  } finally {
    setAudioContext(null);
    setSuperdoughAudioController(null);
    resetGlobalEffects();
  }
}

// Body layout expected by src/server.ts: u32 LE header length, JSON header,
// zero padding to a multiple of 4 bytes, then interleaved float32 samples.
function encodeRenderBody(code: string, cycles: number, buffer: AudioBuffer): Blob {
  const header = new TextEncoder().encode(
    JSON.stringify({ code, cycles, sampleRate: buffer.sampleRate, channels: buffer.numberOfChannels }),
  );
  const prefix = new Uint8Array(Math.ceil((4 + header.length) / 4) * 4);
  new DataView(prefix.buffer).setUint32(0, header.length, true);
  prefix.set(header, 4);

  const frames = buffer.length;
  const channels = buffer.numberOfChannels;
  const samples = new Float32Array(frames * channels);
  for (let c = 0; c < channels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < frames; i++) samples[i * channels + c] = data[i];
  }
  return new Blob([prefix, samples]);
}

async function render() {
  const code = mirror!.code;
  const cycles = Math.max(1, Math.round(Number(cyclesInput.value) || 1));
  renderButton.disabled = previewButton.disabled = true;
  try {
    stopPreview();
    const pattern = await evaluatePattern(code, false);
    const buffer = await renderOffline(pattern, cycles);
    setStatus("Sending to Live…");
    const response = await fetch(`/api/render?session=${session}`, {
      method: "POST",
      body: encodeRenderBody(code, cycles, buffer),
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
  const response = await fetch(`/api/session?session=${session}`);
  if (!response.ok) throw new Error("Session not found");
  const input: { code: string; cycles: number; bpm: number } = await response.json();
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
    effects: StateEffect.appendConfig.of([
      search({ top: true }),
      highlightSelectionMatches(),
      keymap.of(searchKeymap),
    ]),
  });
  mirror.editor.focus();

  await prebaked;
  mirror.repl.setCps(bpm / 60 / BEATS_PER_CYCLE);
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
