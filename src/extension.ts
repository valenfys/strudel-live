import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import {
  AudioClip,
  AudioTrack,
  ClipSlot,
  initialize,
  type ActivationContext,
  type ExtensionContext,
  type Handle,
} from "@ableton-extensions/sdk";
import { runEditorSession, type RenderResult } from "./server.js";
import { encodeStrudelWav, readStrudelData, type StrudelData } from "./wav.js";

const DEFAULT_CODE = `note("c3 [e3 g3] a2 <f2 g2>")
  .s("sawtooth").lpf(1200).decay(.2).sustain(0)`;
const DEFAULT_CYCLES = 4;
const BEATS_PER_CYCLE = 4;

type Context = ExtensionContext<"1.0.0">;

export function activate(activation: ActivationContext) {
  const context = initialize(activation, "1.0.0");

  register(context, "ClipSlot", "New Strudel clip…", "strudel-live.newClip", (handle) =>
    newClip(context, context.getObjectFromHandle(handle, ClipSlot)),
  );
  register(context, "AudioClip", "Edit Strudel…", "strudel-live.editClip", (handle) =>
    editClip(context, context.getObjectFromHandle(handle, AudioClip)),
  );
}

function register(
  context: Context,
  scope: "ClipSlot" | "AudioClip",
  title: string,
  commandId: string,
  run: (handle: Handle) => Promise<void>,
) {
  context.commands.registerCommand(commandId, (handle) => {
    run(handle as Handle).catch((error) =>
      console.error(`${commandId} failed:`, error),
    );
  });
  context.ui
    .registerContextMenuAction(scope, title, commandId)
    .catch((error) =>
      console.error(`Failed to register ${scope} context menu action:`, error),
    );
}

async function newClip(context: Context, slot: ClipSlot<"1.0.0">) {
  if (!(slot.parent instanceof AudioTrack)) {
    console.warn("Strudel clips can only be created on audio tracks.");
    return;
  }
  if (slot.clip) {
    console.warn("Clip slot is not empty.");
    return;
  }
  const rendered = await edit(context, { code: DEFAULT_CODE, cycles: DEFAULT_CYCLES });
  if (rendered) await placeInSlot(slot, rendered);
}

async function editClip(context: Context, clip: AudioClip<"1.0.0">) {
  const existing = readStrudelData(fs.readFileSync(clip.filePath));
  if (!existing) {
    console.warn(`Not a Strudel clip: ${clip.filePath}`);
    return;
  }
  console.log(`Read Strudel code from ${clip.filePath}`);
  const rendered = await edit(context, existing);
  if (!rendered) return;

  // An audio clip's file can't be swapped, so replace the clip with a new one
  // in the same place, keeping its name and color.
  const { name, color } = clip;
  const parent = clip.parent;
  let replacement: AudioClip<"1.0.0">;
  if (parent instanceof ClipSlot) {
    await parent.deleteClip();
    replacement = await placeInSlot(parent, rendered);
  } else if (parent instanceof AudioTrack) {
    const startTime = clip.startTime;
    await parent.deleteClip(clip);
    replacement = await placeInArrangement(parent, startTime, rendered);
  } else {
    console.warn("Editing clips in take lanes isn't supported yet.");
    return;
  }
  replacement.name = name;
  replacement.color = color;
}

interface Rendered {
  filePath: string;
  data: StrudelData;
}

/** Opens the editor; if the user renders, writes the WAV into the project. */
async function edit(
  context: Context,
  initial: Pick<StrudelData, "code" | "cycles">,
): Promise<Rendered | undefined> {
  const bpm = context.application.song.tempo;
  const result = await runEditorSession({ ...initial, bpm }, (url) =>
    context.ui.showModalDialog(url, 720, 480),
  );
  if (!result) return undefined;
  const data: StrudelData = { version: 1, code: result.code, cycles: result.cycles, bpm };
  return { filePath: await writeIntoProject(context, result, data), data };
}

async function writeIntoProject(
  context: Context,
  result: RenderResult,
  data: StrudelData,
): Promise<string> {
  // Live only provides a temp directory when the host is given one, which
  // `ableton-extensions-cli run` doesn't do by default.
  const tempDirectory =
    context.environment.tempDirectory ?? path.join(os.tmpdir(), "strudel-live");
  fs.mkdirSync(tempDirectory, { recursive: true });
  const fileName = `strudel-${randomUUID().slice(0, 8)}-${Math.round(data.bpm)}bpm.wav`;
  const tempPath = path.join(tempDirectory, fileName);
  fs.writeFileSync(
    tempPath,
    encodeStrudelWav(result.samples, result.sampleRate, result.channels, data),
  );
  const imported = await context.resources.importIntoProject(tempPath);
  fs.rmSync(tempPath, { force: true });

  // Spike check: does the imported copy still carry the code?
  const survived = readStrudelData(fs.readFileSync(imported)) !== null;
  console.log(`Imported ${imported} (strd chunk ${survived ? "intact" : "MISSING"})`);
  return imported;
}

function clipArgs({ filePath, data }: Rendered) {
  const beats = data.cycles * BEATS_PER_CYCLE;
  return {
    filePath,
    isWarped: true,
    loopSettings: {
      looping: true,
      startMarker: 0,
      endMarker: beats,
      loopStart: 0,
      loopEnd: beats,
    },
  };
}

async function placeInSlot(slot: ClipSlot<"1.0.0">, rendered: Rendered) {
  const clip = await slot.createAudioClip(clipArgs(rendered));
  clip.name = "Strudel";
  return clip;
}

async function placeInArrangement(
  track: AudioTrack<"1.0.0">,
  startTime: number,
  rendered: Rendered,
) {
  const args = clipArgs(rendered);
  const clip = await track.createAudioClip({
    ...args,
    startTime,
    duration: args.loopSettings.loopEnd,
  });
  clip.name = "Strudel";
  return clip;
}
