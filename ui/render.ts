import type { Hap, Pattern } from "@strudel/core";
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

/** The events of `cycles` cycles that start within them, in onset order. */
export function queryOnsets(pattern: Pattern, cycles: number, bpm: number): Hap[] {
  // Ascending onset order matters for controls like `cut`.
  return pattern
    .queryArc(0, cycles, { _cps: cyclesPerSecond(bpm) })
    .filter((hap) => hap.hasOnset())
    .sort((a, b) => a.whole!.begin.valueOf() - b.whole!.begin.valueOf());
}

// Based on renderPatternAudio from @strudel/webaudio, which downloads the
// result instead of returning it.
export async function renderOffline(
  haps: Hap[],
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
