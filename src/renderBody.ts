// The body the editor UI POSTs to /api/render: u32 LE header length, JSON
// header, zero padding to a multiple of 4 bytes, then interleaved float32
// samples. Shared by ui/main.ts and src/server.ts. Live's Extension Host has
// no TextEncoder/TextDecoder globals, so callers pass them in.

export interface RenderHeader {
  code: string;
  cycles: number;
  sampleRate: number;
  channels: number;
}

export interface RenderResult extends RenderHeader {
  /** Interleaved samples. */
  samples: Float32Array;
}

/** Encodes a render, interleaving the given per-channel sample arrays. */
export function encodeRenderBody(
  header: RenderHeader,
  channelData: Float32Array[],
  encoder: { encode(text: string): Uint8Array },
): Uint8Array<ArrayBuffer> {
  const json = encoder.encode(JSON.stringify(header));
  const samplesStart = Math.ceil((4 + json.length) / 4) * 4;
  const frames = channelData[0]?.length ?? 0;
  const channels = channelData.length;

  const body = new Uint8Array(samplesStart + frames * channels * 4);
  new DataView(body.buffer).setUint32(0, json.length, true);
  body.set(json, 4);
  const samples = new Float32Array(body.buffer, samplesStart, frames * channels);
  for (let c = 0; c < channels; c++) {
    const data = channelData[c];
    for (let i = 0; i < frames; i++) samples[i * channels + c] = data[i];
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
  return { ...header, samples: new Float32Array(bytes.buffer, 0, bytes.byteLength >> 2) };
}
