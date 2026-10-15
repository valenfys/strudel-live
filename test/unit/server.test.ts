import * as http from "node:http";
import * as os from "node:os";
import { TextEncoder } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeRenderBody } from "../../src/renderBody";
import { runEditorSession } from "../../src/server";

// Live's Extension Host runs src/ without these web-style globals, although
// plain Node (and so the e2e tests) has them. Keep in sync with eslint.config.js.
const MISSING_IN_LIVE = ["URL", "URLSearchParams", "TextEncoder", "TextDecoder", "fetch", "Blob"];

function request(url: string, method = "GET", body?: Uint8Array): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (part) => (data += part));
      res.on("end", () => resolve({ status: res.statusCode!, body: data }));
    });
    req.on("error", reject);
    req.end(body);
  });
}

describe("runEditorSession", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("serves the session and receives a render without web globals", async () => {
    for (const name of MISSING_IN_LIVE) vi.stubGlobal(name, undefined);

    const input = { code: 'note("c ♯")', cycles: 2, bpm: 120 };
    const header = { code: 's("bd")', cycles: 2, sampleRate: 48000, channels: 1 };
    const result = await runEditorSession(
      input,
      async (dialogUrl) => {
        const session = dialogUrl.slice(dialogUrl.indexOf("?"));
        const origin = dialogUrl.slice(0, dialogUrl.indexOf("/?"));

        const got = await request(`${origin}/api/session${session}`);
        expect(got.status).toBe(200);
        expect(JSON.parse(got.body)).toEqual(input);

        const body = encodeRenderBody(header, [[new Float32Array([0.5, -0.5])]], new TextEncoder());
        expect((await request(`${origin}/api/render${session}`, "POST", body)).status).toBe(204);
        return "rendered";
      },
      os.tmpdir(),
    );

    expect(result).toMatchObject(header);
    expect(Array.from(result!.samples[0])).toEqual([0.5, -0.5]);
  });
});
