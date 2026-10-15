import { DEFAULT_CODE, expect, test } from "./fixtures";

// Spans the editor marks while their events are playing (see highlight.mjs in
// @strudel/codemirror).
const ACTIVE_EVENT = '.cm-line span[style*="outline"]';

test("shows the session's code, bars and tempo", async ({ openEditor }) => {
  const { page, content } = await openEditor({ code: '$: s("bd sd")\n$: note("c e g")', cycles: 3, bpm: 98 });

  await expect(content()).toContainText('$: s("bd sd")');
  await expect(page.locator(".cm-lineNumbers .cm-gutterElement", { hasText: /^2$/ })).toBeVisible();
  await expect(page.locator("#cycles")).toHaveValue("3");
  await expect(page.locator("#status")).toHaveText("Ready · 98 BPM");
});

test("highlights syntax", async ({ openEditor }) => {
  const { page } = await openEditor();

  const colors = await page
    .locator(".cm-line span")
    .evaluateAll((spans) => new Set(spans.map((span) => getComputedStyle(span).color)).size);
  expect(colors).toBeGreaterThan(1);
});

test("completes sound names from the loaded samples", async ({ openEditor }) => {
  const { page, typeLine } = await openEditor();

  await typeLine('$: s("cas');
  await expect(page.locator(".cm-tooltip-autocomplete")).toContainText("casio");
});

test("completes functions and shows their docs", async ({ openEditor }) => {
  const { page, typeLine } = await openEditor();

  await typeLine('$: s("bd").lpe');
  await expect(page.locator(".cm-tooltip-autocomplete li", { hasText: /^lpe$/ }).first()).toBeVisible();
  await expect(page.locator(".cm-completionInfo")).toContainText("lowpass");
});

test("underlines syntax errors until they're fixed", async ({ openEditor }) => {
  const { page, typeLine } = await openEditor({ code: 'note("c3")' });

  // Bracket closing turns this into `.lpf(1))`: one closing paren too many.
  await typeLine(".lpf(1))");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Alt+Enter");
  await expect(page.locator(".cm-lintRange-error")).toHaveCount(1);
  await expect(page.locator("#status")).toContainText("Unexpected token");

  await page.keyboard.press("Backspace");
  await page.keyboard.press("Alt+Enter");
  await expect(page.locator(".cm-lintRange-error")).toHaveCount(0);
});

test("opens search", async ({ openEditor }) => {
  const { page, content } = await openEditor();

  await content().click();
  await page.keyboard.press("ControlOrMeta+f");
  await expect(page.locator(".cm-search")).toBeVisible();
});

test("highlights active events while previewing", async ({ openEditor }) => {
  const { page } = await openEditor();
  const preview = page.locator("#preview");

  await preview.click();
  await expect(preview).toHaveText("Stop");
  await expect(page.locator(ACTIVE_EVENT).first()).toBeVisible();

  await preview.click();
  await expect(preview).toHaveText("Preview");
  await expect(page.locator(ACTIVE_EVENT)).toHaveCount(0);
});

test("renders the edited code to audio", async ({ openEditor }) => {
  const { page, closed, result, typeLine } = await openEditor({ code: 'note("c3 e3").s("square")', cycles: 2, bpm: 120 });

  await typeLine("  .gain(0.5)");
  await page.keyboard.press("Escape");
  await page.keyboard.press("ControlOrMeta+Enter");
  expect(await closed).toBe("rendered");

  const rendered = (await result)!;
  expect(rendered).toMatchObject({
    code: 'note("c3 e3").s("square")\n  .gain(0.5)',
    cycles: 2,
    sampleRate: 48000,
    channels: 2,
  });
  // 2 bars of 4/4 at 120 BPM is 4 seconds.
  expect(rendered.samples.length).toBe(4 * 48000 * 2);
  const peak = rendered.samples.reduce((max, sample) => Math.max(max, Math.abs(sample)), 0);
  // Audible, and plausible for a square wave at half gain (not garbage).
  expect(peak).toBeGreaterThan(0.01);
  expect(peak).toBeLessThan(1);
});

test("cancelling closes without a render", async ({ openEditor }) => {
  const { page, closed, result } = await openEditor();

  await page.locator("#cancel").click();
  expect(await closed).toBe("cancel");
  expect(await result).toBeUndefined();
});

// Regression guard for #3: rendering swaps in an OfflineAudioContext, and
// preview has to keep working when the render fails afterwards.
test("previews again after a failed render", async ({ openEditor }) => {
  const { page } = await openEditor({ code: DEFAULT_CODE });
  const preview = page.locator("#preview");
  await page.route("**/api/render*", (route) => route.fulfill({ status: 500 }));

  await preview.click();
  await expect(page.locator(ACTIVE_EVENT).first()).toBeVisible();
  await preview.click();

  await page.locator("#render").click();
  await expect(page.locator("#status")).toHaveText("Upload failed: 500");

  await preview.click();
  await expect(preview).toHaveText("Stop");
  await expect(page.locator(ACTIVE_EVENT).first()).toBeVisible();
});

test("switches to Vim keybindings", async ({ openEditor }) => {
  const { page } = await openEditor();

  await page.locator("#keymap").selectOption("vim");
  await expect(page.locator(".cm-fat-cursor")).toBeVisible();
});
