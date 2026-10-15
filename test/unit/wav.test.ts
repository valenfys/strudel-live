import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import { encodeStrudelWav, readStrudelData, type StrudelData } from "../../src/wav";

const data: StrudelData = { version: 1, code: 's("bd sd")', cycles: 4, bpm: 120 };

function chunkIds(wav: Buffer): string[] {
  const ids: string[] = [];
  for (let offset = 12; offset + 8 <= wav.length; ) {
    const size = wav.readUInt32LE(offset + 4);
    ids.push(wav.toString("ascii", offset, offset + 4));
    offset += 8 + size + (size % 2);
  }
  return ids;
}

describe("encodeStrudelWav", () => {
  const samples = new Float32Array([0, 0.5, -0.5, 1, 0.25, -0.25]);
  const wav = encodeStrudelWav(samples, 48000, 2, data);

  it("writes a float WAV with fmt, fact, strd and data chunks", () => {
    expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
    expect(wav.readUInt32LE(4)).toBe(wav.length - 8);
    expect(wav.toString("ascii", 8, 12)).toBe("WAVE");
    expect(chunkIds(wav)).toEqual(["fmt ", "fact", "strd", "data"]);
  });

  it("describes the audio in the fmt and fact chunks", () => {
    // fmt payload starts after "RIFF" size "WAVE" "fmt " size.
    const fmt = 20;
    expect(wav.readUInt16LE(fmt)).toBe(3); // IEEE float
    expect(wav.readUInt16LE(fmt + 2)).toBe(2);
    expect(wav.readUInt32LE(fmt + 4)).toBe(48000);
    expect(wav.readUInt32LE(fmt + 8)).toBe(48000 * 2 * 4);
    expect(wav.readUInt16LE(fmt + 12)).toBe(8);
    expect(wav.readUInt16LE(fmt + 14)).toBe(32);
    expect(wav.readUInt32LE(fmt + 16 + 8)).toBe(3); // fact: frame count
  });

  it("stores the samples unchanged at the end", () => {
    const tail = wav.subarray(wav.length - samples.byteLength);
    expect(Array.from(new Float32Array(tail.buffer.slice(tail.byteOffset, tail.byteOffset + tail.byteLength)))).toEqual(
      Array.from(samples),
    );
  });
});

describe("readStrudelData", () => {
  it("reads back the embedded data", () => {
    expect(readStrudelData(encodeStrudelWav(new Float32Array(2), 44100, 1, data))).toEqual(data);
  });

  // An odd-length strd payload needs a pad byte before the data chunk.
  it.each(['s("bd")', 's("bd ")'])("round-trips code %j with either payload parity", (code) => {
    const wav = encodeStrudelWav(new Float32Array(4), 48000, 2, { ...data, code });
    expect(chunkIds(wav)).toEqual(["fmt ", "fact", "strd", "data"]);
    expect(readStrudelData(wav)?.code).toBe(code);
  });

  it("keeps non-ASCII code intact", () => {
    const code = '// ♪ héllo\nnote("c e g")';
    expect(readStrudelData(encodeStrudelWav(new Float32Array(2), 48000, 2, { ...data, code }))?.code).toBe(code);
  });

  it("returns null for files that aren't Strudel WAVs", () => {
    expect(readStrudelData(Buffer.from("not a wav"))).toBeNull();
    expect(readStrudelData(Buffer.alloc(0))).toBeNull();
  });

  it("returns null for a WAV without a strd chunk", () => {
    const wav = encodeStrudelWav(new Float32Array(2), 48000, 2, data);
    wav.write("junk", 12 + 8 + 16 + 8 + 4, "ascii"); // rename the strd chunk
    expect(readStrudelData(wav)).toBeNull();
  });

  it("returns null for an unknown data version", () => {
    const wav = encodeStrudelWav(new Float32Array(2), 48000, 2, { ...data, version: 2 } as unknown as StrudelData);
    expect(readStrudelData(wav)).toBeNull();
  });
});
