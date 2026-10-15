import { STARTER_CODE, STARTER_CYCLES } from "../../src/starter";
import { DEFAULT_CODE, expect, test } from "./fixtures";

// Spans the editor marks while their events are playing (see highlight.mjs in
// @strudel/codemirror).
const ACTIVE_EVENT = '.cm-line span[style*="outline"]';

const peak = (samples: Float32Array) => samples.reduce((max, sample) => Math.max(max, Math.abs(sample)), 0);

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
  const { page, closed, result, typeLine } = await openEditor({
    code: 'note("c3 e3").s("square")',
    cycles: 2,
    bpm: 120,
  });

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
  expect(rendered.stems).toBeUndefined();
  expect(rendered.samples).toHaveLength(1);
  // 2 bars of 4/4 at 120 BPM is 4 seconds.
  expect(rendered.samples[0].length).toBe(4 * 48000 * 2);
  // Audible, and plausible for a square wave at half gain (not garbage).
  expect(peak(rendered.samples[0])).toBeGreaterThan(0.01);
  expect(peak(rendered.samples[0])).toBeLessThan(1);
});

test("renders each label to its own stem", async ({ openEditor }) => {
  const { page, closed, result } = await openEditor({
    code: [
      'lead: note("c4 e4").s("square").gain(.5)',
      '_muted: note("c3").s("sawtooth")',
      '$: note("g2").s("triangle")',
      'bass: note("c2*2").s("sawtooth").gain(.5)',
    ].join("\n"),
    cycles: 1,
    bpm: 120,
  });

  await page.locator("#render").click();
  expect(await closed).toBe("rendered");

  const rendered = (await result)!;
  expect(rendered.stems?.map((stem) => stem.label)).toEqual(["lead", "muted", "Strudel 1", "bass"]);
  // 1 bar of 4/4 at 120 BPM is 2 seconds.
  for (const samples of rendered.samples) expect(samples.length).toBe(2 * 48000 * 2);
  const [lead, muted, anonymous, bass] = rendered.samples.map(peak);
  expect(lead).toBeGreaterThan(0.01);
  expect(muted).toBe(0);
  expect(anonymous).toBeGreaterThan(0.01);
  expect(bass).toBeGreaterThan(0.01);
});

test("renders the starter code to a stem per part", async ({ openEditor }) => {
  const { page, closed, result } = await openEditor({ code: STARTER_CODE, cycles: STARTER_CYCLES });

  await page.locator("#render").click();
  expect(await closed).toBe("rendered");

  const rendered = (await result)!;
  expect(rendered.stems?.map((stem) => stem.label)).toEqual(["kick", "snare", "hats", "bass", "chords"]);
  // The tests don't load sample audio, so only the synth parts are audible.
  const peaks = rendered.samples.map(peak);
  expect(peaks[3]).toBeGreaterThan(0.01);
  expect(peaks[4]).toBeGreaterThan(0.01);
  for (const p of peaks) expect(p).toBeLessThan(1);
});

const SCENES_CODE = [
  'let lead = note("c4 e4").s("square").gain(.5)',
  'let bass = note("c2*2").s("sawtooth").gain(.5)',
  "scenes({ intro: { lead }, drop: { lead, bass }, outro: {} })",
].join("\n");

test("renders a stem per part of each scene", async ({ openEditor }) => {
  const { page, closed, result } = await openEditor({ code: SCENES_CODE, cycles: 1, bpm: 120 });

  await page.locator("#render").click();
  expect(await closed).toBe("rendered");

  const rendered = (await result)!;
  expect(rendered.scenes).toEqual(["intro", "drop", "outro"]);
  expect(rendered.stems).toEqual([
    { label: "lead", scene: 0 },
    { label: "lead", scene: 1 },
    { label: "bass", scene: 1 },
  ]);
  for (const samples of rendered.samples) {
    expect(samples.length).toBe(2 * 48000 * 2);
    expect(peak(samples)).toBeGreaterThan(0.01);
  }
});

test("previews the scene chosen in the picker", async ({ openEditor }) => {
  const { page } = await openEditor({ code: SCENES_CODE });
  const picker = page.locator("#scene");

  await expect(page.locator("#scene-picker")).toBeHidden();
  await page.locator("#preview").click();
  await expect(picker.locator("option")).toHaveText(["intro", "drop", "outro"]);
  await expect(picker).toHaveValue("intro");

  await picker.selectOption("drop");
  await expect(picker).toHaveValue("drop");
  await expect(page.locator("#status")).toHaveText("Previewing");
  await page.locator("#preview").click();
});

test("explains that scenes need Session View", async ({ openEditor }) => {
  const { page } = await openEditor({ code: SCENES_CODE, view: "arrangement" });

  await page.locator("#render").click();
  await expect(page.locator("#status")).toHaveText("scenes() only works in Session View");
});

test("rejects mixing labels and scenes", async ({ openEditor }) => {
  const { page } = await openEditor({ code: `${SCENES_CODE}\nhats: s("hh*8")` });

  await page.locator("#render").click();
  await expect(page.locator("#status")).toHaveText("Use either labels or scenes(), not both");
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
