import { Pattern, type Hap } from "@strudel/core";

// Strudel transpiles labelled blocks (`kick: s("bd*4")`) into `.p("kick")`
// calls, and the REPL stacks the labelled patterns into one. The labels don't
// survive into the stacked events, so tagStems wraps `.p` to record each
// block's label in its events' context, and splitStems groups by it.

const STEM = "strudelLiveStem";

let labels: string[] = [];

/**
 * Call before every evaluation, after the REPL has (re)defined `.p`: the
 * StrudelMirror `beforeEval` hook runs at the right time.
 */
export function tagStems(): void {
  const p = Pattern.prototype.p;
  let anonymous = 0;
  labels = [];
  Pattern.prototype.p = function (id) {
    const label = stemLabel(String(id), () => ++anonymous);
    if (!labels.includes(label)) labels.push(label);
    return p.call(
      this.withContext((context) => ({ ...context, [STEM]: label })),
      id,
    );
  };
}

/**
 * The label a block's stem is named after. Muted blocks (`_kick:`, `kick_:`)
 * keep their stem, which renders silent. Anonymous `$:` blocks are numbered in
 * order: "Strudel 1", "Strudel 2"…
 */
export function stemLabel(id: string, nextAnonymous: () => number): string {
  const label = id.replace(/^_+|_+$/g, "");
  return label.includes("$") ? `Strudel ${nextAnonymous()}` : label;
}

export interface Stem {
  label: string;
  haps: Hap[];
}

/**
 * Splits the events of the last evaluation by label, in the order the labels
 * appear in the code, or returns null if the code has no labels.
 */
export function splitStems(haps: Hap[]): Stem[] | null {
  if (!labels.length) return null;
  const stems = labels.map((label): Stem => ({ label, haps: [] }));
  for (const hap of haps) {
    const stem = stems.find((s) => s.label === hap.context[STEM]);
    if (stem) stem.haps.push(hap);
    else console.warn("Event without a label, left out of the stems:", hap);
  }
  return stems;
}
