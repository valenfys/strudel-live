import type { Pattern } from "@strudel/core";
import {
  getAudioContext,
  initAudio,
  resetGlobalEffects,
  setAudioContext,
  setSuperdoughAudioController,
  superdough,
} from "@strudel/webaudio";
import { cyclesPerSecond } from "../src/protocol";

const SAMPLE_RATE = 48000;
const CHANNELS = 2;

// Based on renderPatternAudio from @strudel/webaudio, which downloads the
// result instead of returning it.
export async function renderOffline(
  pattern: Pattern,
  cycles: number,
  bpm: number,
  onProgress: (message: string) => void,
): Promise<AudioBuffer> {
  const cps = cyclesPerSecond(bpm);
  await getAudioContext().close();
  const context = new OfflineAudioContext(CHANNELS, Math.round((cycles / cps) * SAMPLE_RATE), SAMPLE_RATE);
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
      onProgress(`Scheduling ${i + 1}/${haps.length}…`);
      const onset = hap.whole!.begin.valueOf() / cps;
      hap.ensureObjectValue();
      try {
        await superdough(hap.value, onset, hap.duration / cps, cps, onset);
      } catch (error) {
        console.warn("superdough failed for hap", hap, error);
      }
    }
    onProgress("Rendering…");
    return await context.startRendering();
  } finally {
    setAudioContext(null);
    setSuperdoughAudioController(null);
    resetGlobalEffects();
  }
}
