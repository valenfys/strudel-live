// The code a new Strudel clip starts with. Kept out of extension.ts so the
// browser tests can render it.

export const STARTER_CODE = `// Each label (kick, snare…) renders to its own clip, on a track named after it.
// Mute a part with _kick: and it renders silent; $: parts are numbered.
kick: s("bd*4")
snare: s("~ sd ~ [sd ~ ~ sd]").gain(.8)
hats: s("hh*8").gain("[.4 .7]*4")
bass: note("<c2 c2 ab1 bb1>(3,8)").s("sawtooth").lpf(700).decay(.2).sustain(0)
chords: note("<[c3,eb3,g3] [c3,eb3,ab3] [d3,f3,bb3] [d3,g3,bb3]>")
  .s("triangle").attack(.1).release(.4).room(.4).gain(.5)`;
export const STARTER_CYCLES = 4;
