// See index.d.ts. Nothing in CI runs the extension inside Live.
class LiveObject {}
export class ClipSlot extends LiveObject {}
export class AudioClip extends LiveObject {}
export class AudioTrack extends LiveObject {}
export function initialize() {
  throw new Error("The Ableton SDK stub can't run extensions");
}
