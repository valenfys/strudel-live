// The code a new Strudel clip starts with. Kept out of extension.ts so the
// browser tests can render it.

export const STARTER_CODE = `// Each part below becomes a track, named after it, and each scene a row of
// clips. Pick the scene Preview plays from the Scene menu.
let kick = s("bd*4")
let snare = s("~ sd ~ [sd ~ ~ sd]").gain(.8)
let hats = s("hh*8").gain("[.4 .7]*4")
let rollinghats = s("hh*16").gain(.35)
let bass = note("<c2 c2 ab1 bb1>(3,8)").s("sawtooth").lpf(700).decay(.2).sustain(0)
let chords = note("<[c3,eb3,g3] [c3,eb3,ab3] [d3,f3,bb3] [d3,g3,bb3]>")
  .s("triangle").attack(.1).release(.4).room(.4).gain(.5)

scenes({
  intro: { hats, chords },
  groove: { kick, snare, hats, bass, chords },
  drop: { kick, snare, hats: rollinghats, bass },
})`;
export const STARTER_CYCLES = 4;
