import * as path from "node:path";
import { test as base, expect, type Page } from "@playwright/test";
import { runEditorSession, type RenderResult, type SessionInput } from "../../src/server";

const ROOT = path.resolve(import.meta.dirname, "../..");
const UI_ROOT = path.join(ROOT, "dist/ui");
const SAMPLE_MAP = path.join(import.meta.dirname, "dirt-samples.json");

export const DEFAULT_CODE = 'note("c3 e3 g3 b3").s("sawtooth")';

export interface EditorDialog {
  page: Page;
  /** Resolves with what the page sent to Live's close_and_send. */
  closed: Promise<string>;
  /** Resolves with what runEditorSession returned once the dialog closed. */
  result: Promise<RenderResult | undefined>;
  /** Moves the cursor to the end of the code and types on a new line. */
  typeLine(text: string): Promise<void>;
  /** Locator for the editor's text. */
  content(): ReturnType<Page["locator"]>;
}

declare global {
  interface Window {
    __closeDialog(result: string): void;
    webkit?: unknown;
  }
}

export const test = base.extend<{ openEditor: (input?: Partial<SessionInput>) => Promise<EditorDialog> }>({
  openEditor: async ({ page }, use) => {
    // Serve a small sample map instead of fetching dirt-samples from GitHub.
    // The tests only play synths, so the sample audio itself is never needed.
    await page.route("https://raw.githubusercontent.com/**", (route) =>
      route.request().url().endsWith("/strudel.json") ? route.fulfill({ path: SAMPLE_MAP }) : route.abort(),
    );

    // Stand in for Live's dialog bridge (see closeWithResult in ui/main.ts).
    let close!: (result: string) => void;
    const closed = new Promise<string>((resolve) => (close = resolve));
    await page.exposeFunction("__closeDialog", (result: string) => close(result));
    await page.addInitScript(() => {
      window.webkit = {
        messageHandlers: { live: { postMessage: (m: { params: [string] }) => window.__closeDialog(m.params[0]) } },
      };
    });

    await use(async (input) => {
      let showUrl!: (url: string) => void;
      const url = new Promise<string>((resolve) => (showUrl = resolve));
      const result = runEditorSession(
        { code: DEFAULT_CODE, cycles: 1, bpm: 120, ...input },
        (dialogUrl) => {
          showUrl(dialogUrl);
          return closed;
        },
        UI_ROOT,
      );

      await page.goto(await url);
      await expect(page.locator("#status")).toHaveText(/^Ready/);
      const content = () => page.locator(".cm-content");
      return {
        page,
        closed,
        result,
        content,
        async typeLine(text) {
          await content().click();
          await page.keyboard.press("ControlOrMeta+End");
          await page.keyboard.press("Enter");
          await page.keyboard.type(text);
        },
      };
    });
  },
});

export { expect };
