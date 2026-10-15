import { isPattern, silence, stack, type Pattern } from "@strudel/core";

// `scenes({ intro: { hat }, verse: { kick, hat, bass } })` lays the code out as
// Session scenes: one row per scene, one track per part. The parts' keys name
// their tracks, so shorthand properties (`{ kick }`) use the variable names.

export interface Scene {
  name: string;
  /** Track name → pattern, in the order written. */
  parts: [string, Pattern][];
}

let defined: Scene[] | null = null;
let previewed = "";

/** Call before every evaluation, so code that drops `scenes()` has none. */
export function resetScenes(): void {
  defined = null;
}

/** The scenes the last evaluation defined, or null if it didn't call `scenes()`. */
export function definedScenes(): Scene[] | null {
  return defined;
}

/** Chooses the scene that `scenes()` returns, and so the one that previews. */
export function previewScene(name: string): void {
  previewed = name;
}

/** Exposed to Strudel code. Returns the previewed scene (else the first) as one pattern. */
export function scenes(definition: Record<string, Record<string, unknown>>): Pattern {
  if (defined) throw new Error("scenes() can only be called once");
  defined = Object.entries(definition).map(([name, parts]) => {
    if (!parts || typeof parts !== "object") throw new Error(`Scene "${name}" must be an object of parts`);
    return {
      name,
      parts: Object.entries(parts).map(([track, pattern]): [string, Pattern] => {
        if (!isPattern(pattern)) throw new Error(`"${track}" in scene "${name}" is not a pattern`);
        return [track, pattern as Pattern];
      }),
    };
  });
  const scene = defined.find((s) => s.name === previewed) ?? defined[0];
  return scene ? stack(...scene.parts.map(([, pattern]) => pattern)) : silence;
}
