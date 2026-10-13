import { Buffer } from "node:buffer";

// Strudel clips are 32-bit float WAV files with an extra `strd` RIFF chunk
// holding the code they were rendered from. The chunk is the source of truth:
// the audio can always be re-rendered from it.

const STRUDEL_CHUNK_ID = "strd";
const WAVE_FORMAT_IEEE_FLOAT = 3;

export interface StrudelData {
  version: 1;
  code: string;
  /** Number of cycles rendered. One cycle is one bar of 4/4. */
  cycles: number;
  /** Song tempo at render time. */
  bpm: number;
}

function chunk(id: string, payload: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.write(id, 0, "ascii");
  header.writeUInt32LE(payload.length, 4);
  // RIFF chunks are word-aligned; the pad byte is not counted in the size.
  const pad = payload.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0);
  return Buffer.concat([header, payload, pad]);
}

export function encodeStrudelWav(
  samples: Float32Array,
  sampleRate: number,
  channels: number,
  data: StrudelData,
): Buffer {
  const fmt = Buffer.alloc(16);
  fmt.writeUInt16LE(WAVE_FORMAT_IEEE_FLOAT, 0);
  fmt.writeUInt16LE(channels, 2);
  fmt.writeUInt32LE(sampleRate, 4);
  fmt.writeUInt32LE(sampleRate * channels * 4, 8);
  fmt.writeUInt16LE(channels * 4, 12);
  fmt.writeUInt16LE(32, 14);

  // Non-PCM formats should carry a fact chunk with the frame count.
  const fact = Buffer.alloc(4);
  fact.writeUInt32LE(samples.length / channels, 0);

  const body = Buffer.concat([
    Buffer.from("WAVE", "ascii"),
    chunk("fmt ", fmt),
    chunk("fact", fact),
    chunk(STRUDEL_CHUNK_ID, Buffer.from(JSON.stringify(data), "utf8")),
    chunk(
      "data",
      Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength),
    ),
  ]);

  const riff = Buffer.alloc(8);
  riff.write("RIFF", 0, "ascii");
  riff.writeUInt32LE(body.length, 4);
  return Buffer.concat([riff, body]);
}

/** Returns the Strudel data embedded in a WAV file, or null if there is none. */
export function readStrudelData(wav: Buffer): StrudelData | null {
  if (
    wav.length < 12 ||
    wav.toString("ascii", 0, 4) !== "RIFF" ||
    wav.toString("ascii", 8, 12) !== "WAVE"
  ) {
    return null;
  }
  let offset = 12;
  while (offset + 8 <= wav.length) {
    const id = wav.toString("ascii", offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (id === STRUDEL_CHUNK_ID) {
      const parsed = JSON.parse(wav.toString("utf8", start, start + size));
      return parsed?.version === 1 ? (parsed as StrudelData) : null;
    }
    offset = start + size + (size % 2);
  }
  return null;
}
