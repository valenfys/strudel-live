import {
  evaluate,
  getAudioContext,
  hush,
  initAudio,
  initStrudel,
  resetGlobalEffects,
  samples,
  setAudioContext,
  setSuperdoughAudioController,
  superdough,
  type Pattern,
} from "@strudel/web";

const SAMPLE_RATE = 48000;
const CHANNELS = 2;
const BEATS_PER_CYCLE = 4;

const session = new URLSearchParams(location.search).get("session") ?? "";
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const codeInput = $<HTMLTextAreaElement>("code");
const cyclesInput = $<HTMLInputElement>("cycles");
const previewButton = $<HTMLButtonElement>("preview");
const renderButton = $<HTMLButtonElement>("render");
const status = $<HTMLSpanElement>("status");

let bpm = 120;
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

async function evaluatePattern(code: string, play: boolean): Promise<Pattern> {
  lastEvalError = undefined;
  const pattern = await evaluate(code, play);
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
  const code = codeInput.value;
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
    setStatus(String((error as Error).message ?? error), true);
    renderButton.disabled = previewButton.disabled = false;
  }
}

function stopPreview() {
  if (!previewing) return;
  hush();
  previewing = false;
  previewButton.textContent = "Preview";
}

async function togglePreview() {
  if (previewing) return stopPreview();
  try {
    await evaluatePattern(codeInput.value, true);
    previewing = true;
    previewButton.textContent = "Stop";
    setStatus("Previewing");
  } catch (error) {
    setStatus(String((error as Error).message ?? error), true);
  }
}

async function main() {
  const response = await fetch(`/api/session?session=${session}`);
  if (!response.ok) throw new Error("Session not found");
  const input: { code: string; cycles: number; bpm: number } = await response.json();
  bpm = input.bpm;
  codeInput.value = input.code;
  cyclesInput.value = String(input.cycles);

  const repl = await initStrudel({
    prebake: () => samples("github:tidalcycles/dirt-samples"),
    onEvalError: (error: Error) => {
      lastEvalError = error;
    },
  });
  repl.setCps(bpm / 60 / BEATS_PER_CYCLE);

  codeInput.disabled = false;
  renderButton.disabled = previewButton.disabled = false;
  setStatus(`Ready · ${bpm} BPM`);
  codeInput.focus();
}

renderButton.addEventListener("click", render);
previewButton.addEventListener("click", togglePreview);
$("cancel").addEventListener("click", () => {
  stopPreview();
  closeWithResult("cancel");
});
codeInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    if (!renderButton.disabled) render();
  }
});

main().catch((error) => {
  console.error(error);
  setStatus(String(error.message ?? error), true);
});
