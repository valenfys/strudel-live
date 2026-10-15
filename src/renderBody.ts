// The body the editor UI POSTs to /api/render: u32 LE header length, JSON
// header, zero padding to a multiple of 4 bytes, then each stem's interleaved
// float32 samples, one after another. Shared by ui/main.ts and src/server.ts.
// Live's Extension Host has no TextEncoder/TextDecoder globals, so callers pass
// them in.

export interface RenderHeader {
  code: string;
  cycles: number;
  sampleRate: number;
  channels: number;
  /**
   * One per stem, in order: its label (`kick: …`, or a part's key in
   * `scenes()`) and, with scenes, the index of its scene. Absent when the code
   * has neither and renders as a single mix.
   */
  stems?: StemHeader[];
  /** The scenes' names, in order, when the code calls `scenes()`. */
  scenes?: string[];
}

export interface StemHeader {
  label: string;
  scene?: number;
  /** The clip's name, when it differs from its track's (`hats: rollinghats`). */
  clip?: string;
}

export interface RenderResult extends RenderHeader {
  /** Interleaved samples: one array per stem, or a single one without stems. */
  samples: Float32Array[];
}

/**
 * Encodes a render. `audio` holds each stem's per-channel sample arrays (a
 * single entry without stems); all must have the same length.
 */
export function encodeRenderBody(
  header: RenderHeader,
  audio: Float32Array[][],
  encoder: { encode(text: string): Uint8Array },
): Uint8Array<ArrayBuffer> {
  const json = encoder.encode(JSON.stringify(header));
  const samplesStart = Math.ceil((4 + json.length) / 4) * 4;
  const frames = audio[0]?.[0]?.length ?? 0;
  const channels = header.channels;
  const stemLength = frames * channels;

  const body = new Uint8Array(samplesStart + audio.length * stemLength * 4);
  new DataView(body.buffer).setUint32(0, json.length, true);
  body.set(json, 4);
  for (const [s, channelData] of audio.entries()) {
    const samples = new Float32Array(body.buffer, samplesStart + s * stemLength * 4, stemLength);
    for (let c = 0; c < channels; c++) {
      const data = channelData[c];
      for (let i = 0; i < frames; i++) samples[i * channels + c] = data[i];
    }
  }
  return body;
}

export function decodeRenderBody(body: Uint8Array, decoder: { decode(bytes: Uint8Array): string }): RenderResult {
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const headerLength = view.getUint32(0, true);
  const header: RenderHeader = JSON.parse(decoder.decode(body.subarray(4, 4 + headerLength)));
  const samplesStart = Math.ceil((4 + headerLength) / 4) * 4;
  // Copy so the samples are 4-byte aligned regardless of the input's offset.
  // (Not body.slice: on a Node Buffer that returns a view into the pool.)
  const bytes = new Uint8Array(body.subarray(samplesStart));
  const all = new Float32Array(bytes.buffer, 0, bytes.byteLength >> 2);
  const count = header.stems?.length ?? 1;
  const stemLength = all.length / count;
  const samples = Array.from({ length: count }, (_, s) => all.subarray(s * stemLength, (s + 1) * stemLength));
  return { ...header, samples };
}
