import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { ClipStore, clipFilePrefix, clipIdOf, newClipId } from "../../src/clipStore";
import type { StrudelData } from "../../src/wav";

const data: StrudelData = { version: 1, code: 's("bd sd")', cycles: 4, bpm: 120, stem: "kick", group: "g" };

describe("clipIdOf", () => {
  it("reads the ID from a clip's file name, whatever follows it", () => {
    const id = newClipId();
    const name = `${clipFilePrefix(id)}-verse-kick-120bpm.wav`;
    expect(clipIdOf(path.join("/Set Project/Samples/Imported", name))).toBe(id);
    // In case Live adds a suffix when a name is taken.
    expect(clipIdOf(`/x/${clipFilePrefix(id)}-120bpm-1.wav`)).toBe(id);
  });

  it("ignores other files, including clips named before IDs were full UUIDs", () => {
    expect(clipIdOf("/x/strudel-1a2b3c4d-kick-120bpm.wav")).toBeUndefined();
    expect(clipIdOf("/x/kick.wav")).toBeUndefined();
    expect(clipIdOf(`/x/my-${clipFilePrefix(newClipId())}.wav`)).toBeUndefined();
  });
});

describe("ClipStore", () => {
  const store = () => new ClipStore(path.join(fs.mkdtempSync(path.join(os.tmpdir(), "strudel-live-clips-")), "clips"));

  it("finds a clip's data from its file path", () => {
    const clips = store();
    const id = newClipId();
    clips.save(id, data);
    expect(clips.load(`/Set Project/Samples/Imported/${clipFilePrefix(id)}-kick-120bpm.wav`)).toEqual(data);
  });

  it("has nothing for clips rendered elsewhere or not by Strudel", () => {
    const clips = store();
    expect(clips.load(`/x/${clipFilePrefix(newClipId())}.wav`)).toBeNull();
    expect(clips.load("/x/kick.wav")).toBeNull();
  });
});
