import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import type { StrudelData } from "./wav.js";

// An installed extension can't read the project's audio files (Live runs it
// under Node's permission model), so the `strd` chunk in a clip's WAV can't be
// read back when editing. Each clip's Strudel data is also kept here, in the
// extension's storage directory, under an ID that's part of the WAV's file
// name: `strudel-<id>….wav`. Editing finds it from the clip's file path alone.
// The store is per machine; the chunk is what travels with the Set (#52).

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const CLIP_FILE = new RegExp(`^strudel-(${UUID})`);

/** A new clip ID, to start the clip's file name with (see clipFilePrefix). */
export function newClipId(): string {
  return randomUUID();
}

/** How a clip's file name starts. */
export function clipFilePrefix(id: string): string {
  return `strudel-${id}`;
}

/** The ID in a clip's file name, or undefined for files not named by clipFilePrefix. */
export function clipIdOf(filePath: string): string | undefined {
  return CLIP_FILE.exec(path.basename(filePath))?.[1];
}

export class ClipStore {
  constructor(private readonly directory: string) {}

  save(id: string, data: StrudelData) {
    fs.mkdirSync(this.directory, { recursive: true });
    fs.writeFileSync(this.file(id), JSON.stringify(data));
  }

  /** The data of the clip in `filePath`, or null if it isn't a Strudel clip rendered on this machine. */
  load(filePath: string): StrudelData | null {
    const id = clipIdOf(filePath);
    if (!id || !fs.existsSync(this.file(id))) return null;
    const data = JSON.parse(fs.readFileSync(this.file(id), "utf8"));
    return data?.version === 1 ? (data as StrudelData) : null;
  }

  private file(id: string) {
    return path.join(this.directory, `${id}.json`);
  }
}
