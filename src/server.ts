import * as fs from "node:fs";
import * as http from "node:http";
import * as path from "node:path";
import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { URL } from "node:url";

// The editor dialog is served from a local HTTP server rather than a data: URL
// so that Strudel's ES modules, workers and sample fetches behave as on the web,
// and so the dialog can POST rendered audio back without squeezing megabytes of
// base64 through the dialog's close message.

const UI_ROOT = path.join(__dirname, "ui");

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
};

export interface SessionInput {
  code: string;
  cycles: number;
  bpm: number;
}

export interface RenderResult {
  code: string;
  cycles: number;
  sampleRate: number;
  channels: number;
  /** Interleaved samples. */
  samples: Float32Array;
}

interface Session {
  input: SessionInput;
  result?: RenderResult;
}

const sessions = new Map<string, Session>();
let serverPort: Promise<number> | undefined;

function ensureServer(): Promise<number> {
  serverPort ??= new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      handle(req, res).catch((error) => {
        console.error("Request failed:", error);
        res.writeHead(500).end(String(error));
      });
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      resolve((server.address() as { port: number }).port);
    });
  });
  return serverPort;
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse) {
  const url = new URL(req.url ?? "/", "http://localhost");
  const session = sessions.get(url.searchParams.get("session") ?? "");

  if (url.pathname === "/api/session" && req.method === "GET") {
    if (!session) return void res.writeHead(404).end();
    res.writeHead(200, { "Content-Type": "application/json" });
    return void res.end(JSON.stringify(session.input));
  }

  if (url.pathname === "/api/render" && req.method === "POST") {
    if (!session) return void res.writeHead(404).end();
    session.result = parseRenderBody(await readBody(req));
    return void res.writeHead(204).end();
  }

  if (req.method !== "GET") return void res.writeHead(405).end();
  const relative = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  const file = path.resolve(UI_ROOT, relative);
  if (!file.startsWith(UI_ROOT + path.sep) || !fs.existsSync(file)) {
    return void res.writeHead(404).end();
  }
  res.writeHead(200, {
    "Content-Type":
      CONTENT_TYPES[path.extname(file)] ?? "application/octet-stream",
  });
  fs.createReadStream(file).pipe(res);
}

async function readBody(req: http.IncomingMessage): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const part of req) parts.push(part as Buffer);
  return Buffer.concat(parts);
}

// Body layout: u32 LE header length, JSON header, zero padding to a multiple
// of 4 bytes, then interleaved float32 samples. See ui/main.ts.
function parseRenderBody(body: Buffer): RenderResult {
  const headerLength = body.readUInt32LE(0);
  const header = JSON.parse(body.toString("utf8", 4, 4 + headerLength));
  const samplesStart = Math.ceil((4 + headerLength) / 4) * 4;
  // Copy so the samples are 4-byte aligned regardless of the Buffer's pool offset.
  const bytes = body.subarray(samplesStart);
  const samples = new Float32Array(bytes.byteLength / 4);
  Buffer.from(samples.buffer).set(bytes);
  return { ...header, samples };
}

/**
 * Opens the editor in a modal dialog and resolves with the rendered audio, or
 * undefined if the user closed the dialog without rendering.
 */
export async function runEditorSession(
  input: SessionInput,
  showModalDialog: (url: string) => Promise<string>,
): Promise<RenderResult | undefined> {
  const port = await ensureServer();
  const id = randomUUID();
  sessions.set(id, { input });
  try {
    await showModalDialog(`http://localhost:${port}/?session=${id}`);
    return sessions.get(id)?.result;
  } finally {
    sessions.delete(id);
  }
}
