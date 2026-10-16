import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { TextEncoder } from "node:util";
import { describe, expect, it } from "vitest";
import { runEditorSession } from "../../src/server";
import { cssVariable, findLiveResources, parseTheme, themeCss } from "../../src/theme";
import { request } from "./request";

// Made-up themes in the shape of Live's .ask files.
function askFile(colors: Record<string, string>) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Ableton MajorVersion="5" MinorVersion="12.0_12120">
\t<Theme>
${Object.entries(colors)
  .map(([name, value]) => `\t\t<${name} Value="${value}" />`)
  .join("\n")}
\t\t<DefaultBlendFactor Value="0.75" />
\t\t<StandardVuMeter>
\t\t\t<Minimum Value="#00ff00" />
\t\t</StandardVuMeter>
\t</Theme>
</Ableton>
`;
}

/** A stand-in for Live's App-Resources, with the standard themes, one other theme and the fonts. */
function liveResources() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "strudel-live-theme-"));
  const resources = path.join(root, "Live.app/Contents/App-Resources");
  fs.mkdirSync(path.join(resources, "Themes"), { recursive: true });
  fs.mkdirSync(path.join(resources, "Fonts"));
  const themes = {
    "Default Light Neutral Medium": { SurfaceBackground: "#A5A5A5" },
    "Default Dark Neutral Medium": { SurfaceBackground: "#363636" },
    Riparian: { SurfaceBackground: "#123456", ControlBackground: "#11223344" },
  };
  for (const [name, colors] of Object.entries(themes)) {
    fs.writeFileSync(path.join(resources, "Themes", `${name}.ask`), askFile(colors));
  }
  fs.writeFileSync(path.join(resources, "Fonts", "AbletonSansSmall-Regular.ttf"), "font");
  fs.writeFileSync(path.join(resources, "Fonts", "Secret.ttf"), "not served");
  return { root, resources };
}

describe("parseTheme", () => {
  it("reads the theme's own colours", () => {
    const colors = parseTheme(askFile({ ControlBackground: "#CFCFCF", ScrollbarInnerTrack: "#00000000" }));
    expect(Object.fromEntries(colors)).toEqual({ ControlBackground: "#cfcfcf", ScrollbarInnerTrack: "#00000000" });
  });
});

describe("cssVariable", () => {
  it("turns theme names into custom property names", () => {
    expect(cssVariable("ControlBackground")).toBe("--live-control-background");
    expect(cssVariable("RetroDisplayForeground2")).toBe("--live-retro-display-foreground2");
  });
});

describe("themeCss", () => {
  it("sets a theme's colours and colour scheme", () => {
    const css = themeCss(new Map([["SurfaceBackground", "#a5a5a5"]]));
    expect(css).toContain("color-scheme: light;");
    expect(css).toContain("--live-surface-background: #a5a5a5;");
  });

  it("follows the system appearance with a light and a dark theme", () => {
    const css = themeCss({
      light: new Map([["SurfaceBackground", "#a5a5a5"]]),
      dark: new Map([["SurfaceBackground", "#363636"]]),
    });
    expect(css).toMatch(/^:root \{[^}]*--live-surface-background: #a5a5a5;/);
    expect(css).toMatch(/@media \(prefers-color-scheme: dark\) \{\s*:root \{[^}]*--live-surface-background: #363636;/);
  });
});

describe("findLiveResources", () => {
  it("finds Live's resources from the Extension Host inside it", () => {
    const { root, resources } = liveResources();
    const execPath = path.join(root, "Live.app/Contents/Helpers/ExtensionHost/node");
    expect(findLiveResources(execPath)).toBe(resources);
    expect(findLiveResources(path.join(os.tmpdir(), "node"))).toBeUndefined();
  });
});

describe("the editor server's theme", () => {
  it("serves Live's themes and fonts, and saves the chosen theme", async () => {
    const { root, resources } = liveResources();
    const settingsFile = path.join(root, "storage", "settings.json");
    const options = { uiRoot: root, liveResources: resources, settingsFile };

    await runEditorSession(
      { code: "", cycles: 1, bpm: 120, view: "session" },
      async (dialogUrl) => {
        const origin = new URL(dialogUrl).origin;
        const css = async () => (await request(`${origin}/live/theme.css`)).body;
        const choose = (theme: string | null) =>
          request(`${origin}/api/themes`, "PUT", new TextEncoder().encode(JSON.stringify({ theme })));

        // Following the system by default.
        expect(JSON.parse((await request(`${origin}/api/themes`)).body)).toEqual({
          themes: ["Default Dark Neutral Medium", "Default Light Neutral Medium", "Riparian"],
          theme: null,
        });
        expect(await css()).toContain("prefers-color-scheme: dark");
        expect(await css()).toContain('src: url("/live/fonts/AbletonSansSmall-Regular.ttf")');

        expect((await choose("Riparian")).status).toBe(204);
        expect(await css()).toContain("--live-control-background: #11223344;");
        expect(await css()).not.toContain("prefers-color-scheme");
        expect(JSON.parse(fs.readFileSync(settingsFile, "utf8"))).toEqual({ theme: "Riparian" });

        expect((await choose("../../secrets")).status).toBe(400);
        expect((await request(`${origin}/live/fonts/AbletonSansSmall-Regular.ttf`)).body).toBe("font");
        expect((await request(`${origin}/live/fonts/Secret.ttf`)).status).toBe(404);
        return "cancel";
      },
      options,
    );
  });
});
