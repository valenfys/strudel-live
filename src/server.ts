import * as fs from "node:fs";
import * as http from "node:http";
import * as path from "node:path";
import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { URL } from "node:url";
import { TextDecoder } from "node:util";
import {
  RENDER_PATH,
  SESSION_PATH,
  THEME_CSS_PATH,
  THEMES_PATH,
  type SessionInput,
  type ThemeChoice,
  type ThemeSettings,
} from "./protocol.js";
import { decodeRenderBody, type RenderResult } from "./renderBody.js";
import { findLiveResources, FONT_FILES, fontCss, listThemes, parseTheme, STANDARD_THEMES, themeCss } from "./theme.js";

export type { RenderResult } from "./renderBody.js";

// The editor dialog is served from a local HTTP server rather than a data: URL
// so that Strudel's ES modules, workers and sample fetches behave as on the web,
// and so the dialog can POST rendered audio back without squeezing megabytes of
// base64 through the dialog's close message.

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
  ".ttf": "font/ttf",
};

const FONTS_PATH = "/live/fonts/";

export interface ServerOptions {
  /** The built editor UI. Defaults to the ui/ directory next to the bundled extension (dist/ui). */
  uiRoot?: string;
  /**
   * Live's resources directory, with its themes and fonts. Defaults to the one
   * of the Live running this Extension Host; null for none.
   */
  liveResources?: string | null;
  /** A JSON file to keep the user's settings (the theme) in. Without it they last until Live quits. */
  settingsFile?: string;
}

interface Settings {
  theme: string | null;
}

interface Session {
  input: SessionInput;
  result?: RenderResult;
}

const sessions = new Map<string, Session>();
let serverPort: Promise<number> | undefined;

// The server is shared by all sessions, so the first caller's options win.
function ensureServer(options: ServerOptions): Promise<number> {
  serverPort ??= new Promise((resolve, reject) => {
    const server = new EditorServer(options);
    const httpServer = http.createServer((req, res) => {
      server.handle(req, res).catch((error) => {
        console.error("Request failed:", error);
        res.writeHead(500).end(String(error));
      });
    });
    httpServer.on("error", reject);
    httpServer.listen(0, "127.0.0.1", () => {
      resolve((httpServer.address() as { port: number }).port);
    });
  });
  return serverPort;
}

class EditorServer {
  private readonly uiRoot: string;
  private readonly themesDirectory?: string;
  private readonly fontsDirectory?: string;
  private readonly settingsFile?: string;
  private settings: Settings = { theme: null };

  constructor(options: ServerOptions) {
    this.uiRoot = path.resolve(options.uiRoot ?? path.join(__dirname, "ui"));
    const resources = options.liveResources === undefined ? findLiveResources() : options.liveResources;
    if (resources) {
      this.themesDirectory = path.join(resources, "Themes");
      if (fs.existsSync(path.join(resources, "Fonts"))) this.fontsDirectory = path.join(resources, "Fonts");
    } else {
      console.warn("Live's themes weren't found; the editor uses its built-in colours.");
    }
    this.settingsFile = options.settingsFile;
    if (this.settingsFile && fs.existsSync(this.settingsFile)) {
      try {
        this.settings = { ...this.settings, ...JSON.parse(fs.readFileSync(this.settingsFile, "utf8")) };
      } catch (error) {
        console.warn(`Ignoring unreadable settings in ${this.settingsFile}:`, error);
      }
    }
  }

  async handle(req: http.IncomingMessage, res: http.ServerResponse) {
    const url = new URL(req.url ?? "/", "http://localhost");
    const session = sessions.get(url.searchParams.get("session") ?? "");

    if (url.pathname === SESSION_PATH && req.method === "GET") {
      if (!session) return void res.writeHead(404).end();
      return sendJson(res, session.input);
    }

    if (url.pathname === RENDER_PATH && req.method === "POST") {
      if (!session) return void res.writeHead(404).end();
      session.result = decodeRenderBody(await readBody(req), new TextDecoder());
      return void res.writeHead(204).end();
    }

    if (url.pathname === THEMES_PATH && req.method === "GET") {
      return sendJson(res, { themes: this.themes(), theme: this.settings.theme } satisfies ThemeSettings);
    }

    if (url.pathname === THEMES_PATH && req.method === "PUT") {
      const { theme } = JSON.parse((await readBody(req)).toString("utf8")) as ThemeChoice;
      if (theme !== null && !this.themes().includes(theme)) return void res.writeHead(400).end();
      this.settings.theme = theme;
      this.saveSettings();
      return void res.writeHead(204).end();
    }

    if (req.method !== "GET") return void res.writeHead(405).end();

    if (url.pathname === THEME_CSS_PATH) {
      res.writeHead(200, { "Content-Type": CONTENT_TYPES[".css"], "Cache-Control": "no-store" });
      return void res.end(this.themeCss());
    }

    if (url.pathname.startsWith(FONTS_PATH)) {
      const name = url.pathname.slice(FONTS_PATH.length);
      if (!this.fontsDirectory || !Object.hasOwn(FONT_FILES, name)) return void res.writeHead(404).end();
      return sendFile(res, path.join(this.fontsDirectory, name));
    }

    const relative = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    const file = path.resolve(this.uiRoot, relative);
    if (!file.startsWith(this.uiRoot + path.sep)) return void res.writeHead(404).end();
    sendFile(res, file);
  }

  private themes(): string[] {
    return this.themesDirectory && fs.existsSync(this.themesDirectory) ? listThemes(this.themesDirectory) : [];
  }

  private readTheme(name: string): Map<string, string> {
    return parseTheme(fs.readFileSync(path.join(this.themesDirectory!, `${name}.ask`), "utf8"));
  }

  /** The chosen theme, or else Live's standard light and dark themes, following the system. */
  private themeCss(): string {
    const themes = this.themes();
    const fonts = this.fontsDirectory ? fontCss(FONTS_PATH) : "";
    const { theme } = this.settings;
    if (theme && themes.includes(theme)) return fonts + themeCss(this.readTheme(theme));
    if (themes.includes(STANDARD_THEMES.light) && themes.includes(STANDARD_THEMES.dark)) {
      return (
        fonts + themeCss({ light: this.readTheme(STANDARD_THEMES.light), dark: this.readTheme(STANDARD_THEMES.dark) })
      );
    }
    return fonts;
  }

  private saveSettings() {
    if (!this.settingsFile) return;
    try {
      fs.mkdirSync(path.dirname(this.settingsFile), { recursive: true });
      fs.writeFileSync(this.settingsFile, JSON.stringify(this.settings, null, 2));
    } catch (error) {
      console.warn(`Couldn't save settings to ${this.settingsFile}:`, error);
    }
  }
}

function sendJson(res: http.ServerResponse, value: unknown) {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(value));
}

function sendFile(res: http.ServerResponse, file: string) {
  if (!fs.existsSync(file)) return void res.writeHead(404).end();
  res.writeHead(200, {
    "Content-Type": CONTENT_TYPES[path.extname(file)] ?? "application/octet-stream",
  });
  fs.createReadStream(file).pipe(res);
}

async function readBody(req: http.IncomingMessage): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const part of req) parts.push(part as Buffer);
  return Buffer.concat(parts);
}

/**
 * Opens the editor in a modal dialog and resolves with the rendered audio, or
 * undefined if the user closed the dialog without rendering.
 */
export async function runEditorSession(
  input: SessionInput,
  showModalDialog: (url: string) => Promise<string>,
  options: ServerOptions = {},
): Promise<RenderResult | undefined> {
  const port = await ensureServer(options);
  const id = randomUUID();
  sessions.set(id, { input });
  try {
    await showModalDialog(`http://localhost:${port}/?session=${id}`);
    return sessions.get(id)?.result;
  } finally {
    sessions.delete(id);
  }
}
