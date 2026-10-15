import { Buffer } from "node:buffer";
import { TextDecoder, TextEncoder } from "node:util";
import { describe, expect, it } from "vitest";
import { decodeRenderBody as decode, encodeRenderBody as encode, type RenderHeader } from "../../src/renderBody";

// Encodes a single mix, which is what most tests need.
const encodeRenderBody = (header: RenderHeader, channelData: Float32Array[]) =>
  encode(header, [channelData], new TextEncoder());
const decodeRenderBody = (body: Uint8Array) => decode(body, new TextDecoder());

const header: RenderHeader = { code: 's("bd")', cycles: 2, sampleRate: 48000, channels: 2 };

describe("render body", () => {
  it("round-trips the header and interleaves samples", () => {
    const left = new Float32Array([0.1, 0.2, 0.3]);
    const right = new Float32Array([-0.1, -0.2, -0.3]);
    const result = decodeRenderBody(encodeRenderBody(header, [left, right]));

    expect(result).toMatchObject(header);
    expect(Array.from(result.samples[0])).toEqual([0.1, -0.1, 0.2, -0.2, 0.3, -0.3].map(Math.fround));
  });

  // The samples start at the next multiple of 4 after the JSON header, so
  // every padding length (0-3 bytes) needs to decode.
  it.each([0, 1, 2, 3])("handles %i extra code bytes", (extra) => {
    const code = "x".repeat(extra);
    const body = encodeRenderBody({ ...header, code, channels: 1 }, [new Float32Array([1, -1])]);
    expect(body.byteLength % 4).toBe(0);

    const result = decodeRenderBody(body);
    expect(result.code).toBe(code);
    expect(Array.from(result.samples[0])).toEqual([1, -1]);
  });

  it("keeps non-ASCII code intact", () => {
    const code = '// ♪ héllo\nn("0 2").scale("C:mäjor")';
    expect(
      decodeRenderBody(encodeRenderBody({ ...header, code }, [new Float32Array(1), new Float32Array(1)])).code,
    ).toBe(code);
  });

  it("keeps stems apart, in order", () => {
    const stems = ["kick", "bass", "chords"];
    const audio = stems.map((_, s) => [new Float32Array([s, s + 0.5]), new Float32Array([-s, -s - 0.5])]);
    const result = decodeRenderBody(encode({ ...header, stems }, audio, new TextEncoder()));

    expect(result.stems).toEqual(stems);
    expect(result.samples.map((samples) => Array.from(samples))).toEqual([
      [0, -0, 0.5, -0.5],
      [1, -1, 1.5, -1.5],
      [2, -2, 2.5, -2.5],
    ]);
  });

  it("decodes from a pooled Node Buffer", () => {
    const body = encodeRenderBody(header, [new Float32Array([0.5]), new Float32Array([0.25])]);
    // Small Buffers share a pool, so byteOffset is usually non-zero.
    const buffer = Buffer.from(body);
    expect(Array.from(decodeRenderBody(buffer).samples[0])).toEqual([0.5, 0.25]);
  });

  it("decodes from an unaligned view", () => {
    const body = encodeRenderBody(header, [new Float32Array([0.5]), new Float32Array([0.25])]);
    const padded = new Uint8Array(body.byteLength + 1);
    padded.set(body, 1);
    expect(Array.from(decodeRenderBody(padded.subarray(1)).samples[0])).toEqual([0.5, 0.25]);
  });
});
