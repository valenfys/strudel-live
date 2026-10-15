// Shared by the extension host (src/) and the editor dialog (ui/). Like
// renderBody.ts, this must not use web-style globals: Live's Extension Host
// lacks them.

/** One Strudel cycle is one 4/4 bar. */
export const BEATS_PER_CYCLE = 4;

export function cyclesPerSecond(bpm: number): number {
  return bpm / 60 / BEATS_PER_CYCLE;
}

/** GET ?session=<id> → SessionInput as JSON. */
export const SESSION_PATH = "/api/session";
/** POST ?session=<id> with a render body (see renderBody.ts) → 204. */
export const RENDER_PATH = "/api/render";

/** What the editor dialog starts from. */
export interface SessionInput {
  code: string;
  cycles: number;
  bpm: number;
}
