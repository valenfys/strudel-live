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
import { BEATS_PER_CYCLE } from "./protocol.js";
import { STARTER_CODE, STARTER_CYCLES } from "./starter.js";
import { runEditorSession, type RenderResult } from "./server.js";
import { encodeStrudelWav, readStrudelData, type StrudelData } from "./wav.js";

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
    run(handle as Handle).catch((error) => console.error(`${commandId} failed:`, error));
  });
  context.ui
    .registerContextMenuAction(scope, title, commandId)
    .catch((error) => console.error(`Failed to register ${scope} context menu action:`, error));
}

async function newClip(context: Context, slot: ClipSlot<"1.0.0">) {
  const track = slot.parent;
  if (!(track instanceof AudioTrack)) {
    console.warn("Strudel clips can only be created on audio tracks.");
    return;
  }
  if (slot.clip) {
    console.warn("Clip slot is not empty.");
    return;
  }
  const rendered = await edit(context, { code: STARTER_CODE, cycles: STARTER_CYCLES });
  if (rendered) await place(context, { row: track.clipSlots.indexOf(slot) }, rendered, new Map(), track);
}

async function editClip(context: Context, clip: AudioClip<"1.0.0">) {
  const existing = readStrudelData(fs.readFileSync(clip.filePath));
  if (!existing) {
    console.warn(`Not a Strudel clip: ${clip.filePath}`);
    return;
  }
  console.log(`Read Strudel code from ${clip.filePath}`);
  const parent = clip.parent;
  let position: Position;
  let track: AudioTrack<"1.0.0">;
  if (parent instanceof ClipSlot && parent.parent instanceof AudioTrack) {
    track = parent.parent;
    position = { row: track.clipSlots.indexOf(parent) };
  } else if (parent instanceof AudioTrack) {
    track = parent;
    position = { startTime: clip.startTime };
  } else {
    console.warn("Editing clips in take lanes isn't supported yet.");
    return;
  }
  // Editing one stem re-renders the whole group.
  const current = existing.group
    ? findGroup(context, position, existing.group)
    : new Map([[existing.stem ?? "", { track, clip }]]);
  const rendered = await edit(context, existing);
  if (rendered) await place(context, position, rendered, current, track);
}

/** Where a clip and its sibling stems sit: a Session row, or an Arrangement position in beats. */
type Position = { row: number } | { startTime: number };

interface Placed {
  track: AudioTrack<"1.0.0">;
  clip: AudioClip<"1.0.0">;
}

/** The clips of a stems group at `position`, by stem label. */
function findGroup(context: Context, position: Position, group: string): Map<string, Placed> {
  const found = new Map<string, Placed>();
  for (const track of context.application.song.tracks) {
    if (!(track instanceof AudioTrack)) continue;
    const clip = clipAt(track, position);
    if (!(clip instanceof AudioClip)) continue;
    const data = readStrudelData(fs.readFileSync(clip.filePath));
    if (data?.group === group) found.set(data.stem ?? "", { track, clip });
  }
  return found;
}

function clipAt(track: AudioTrack<"1.0.0">, position: Position) {
  return "row" in position
    ? track.clipSlots[position.row]?.clip
    : track.arrangementClips.find((clip) => clip.startTime === position.startTime);
}

async function deleteClip(track: AudioTrack<"1.0.0">, position: Position, clip: AudioClip<"1.0.0">) {
  if ("row" in position) await track.clipSlots[position.row].deleteClip();
  else await track.deleteClip(clip);
}

/**
 * Puts rendered clips at `position`, replacing the group's current clips in
 * place (an audio clip's file can't be swapped). Each stem goes on the track
 * its previous version was on, or else a free track named after its label,
 * `fallback` if that's free, or a new track. Stems whose label is gone from
 * the code have their clips deleted.
 */
async function place(
  context: Context,
  position: Position,
  rendered: Rendered[],
  current: Map<string, Placed>,
  fallback: AudioTrack<"1.0.0">,
) {
  const keyOf = (r: Rendered) => r.data.stem ?? "";
  const keys = new Set(rendered.map(keyOf));
  // Read before deleting anything: a deleted clip's properties are gone.
  const looks = new Map([...current].map(([key, { clip }]) => [key, { name: clip.name, color: clip.color }]));
  const color = [...looks.values()][0]?.color;
  const used = new Set<AudioTrack<"1.0.0">>();
  for (const [key, { track, clip }] of current) {
    if (keys.has(key)) used.add(track);
    else await deleteClip(track, position, clip);
  }

  for (const r of rendered) {
    const previous = current.get(keyOf(r));
    let track: AudioTrack<"1.0.0">;
    if (previous) {
      track = previous.track;
      await deleteClip(track, position, previous.clip);
    } else {
      const beats = r.data.cycles * BEATS_PER_CYCLE;
      track =
        freeTrack(context, position, beats, r.data.stem, fallback, used) ??
        (await context.application.song.createAudioTrack());
      if (r.data.stem) track.name = r.data.stem;
    }
    used.add(track);
    const clip = await placeAt(track, position, r);
    const look = looks.get(keyOf(r));
    clip.name = look?.name || r.data.stem || "Strudel";
    const clipColor = look?.color ?? color;
    if (clipColor !== undefined) clip.color = clipColor;
  }
}

/**
 * An unused track with room for `beats` at `position` for a new stem: one
 * already named after its label, or else `fallback`.
 */
function freeTrack(
  context: Context,
  position: Position,
  beats: number,
  stem: string | undefined,
  fallback: AudioTrack<"1.0.0">,
  used: Set<AudioTrack<"1.0.0">>,
): AudioTrack<"1.0.0"> | undefined {
  const isFree = (track: AudioTrack<"1.0.0">) =>
    !used.has(track) &&
    ("row" in position
      ? !track.clipSlots[position.row]?.clip
      : !track.arrangementClips.some(
          (clip) => clip.startTime < position.startTime + beats && clip.endTime > position.startTime,
        ));
  const named =
    stem === undefined
      ? undefined
      : context.application.song.tracks.find(
          (track): track is AudioTrack<"1.0.0"> => track instanceof AudioTrack && track.name === stem && isFree(track),
        );
  return named ?? (isFree(fallback) ? fallback : undefined);
}

interface Rendered {
  filePath: string;
  data: StrudelData;
}

/** Opens the editor; if the user renders, writes a WAV per stem into the project. */
async function edit(
  context: Context,
  initial: Pick<StrudelData, "code" | "cycles" | "group">,
): Promise<Rendered[] | undefined> {
  const bpm = context.application.song.tempo;
  const { code, cycles } = initial;
  const result = await runEditorSession({ code, cycles, bpm }, (url) => context.ui.showModalDialog(url, 960, 640));
  if (!result) return undefined;
  const group = result.stems && (initial.group ?? randomUUID());
  const rendered: Rendered[] = [];
  for (const [i, samples] of result.samples.entries()) {
    const stem = result.stems?.[i];
    const data: StrudelData = { version: 1, code: result.code, cycles: result.cycles, bpm, stem, group };
    rendered.push({ filePath: await writeIntoProject(context, result, samples, data), data });
  }
  return rendered;
}

async function writeIntoProject(
  context: Context,
  result: RenderResult,
  samples: Float32Array,
  data: StrudelData,
): Promise<string> {
  // Live only provides a temp directory when the host is given one, which
  // `ableton-extensions-cli run` doesn't do by default.
  const tempDirectory = context.environment.tempDirectory ?? path.join(os.tmpdir(), "strudel-live");
  fs.mkdirSync(tempDirectory, { recursive: true });
  const stem = data.stem ? `-${data.stem.replace(/[^\w-]+/g, "_")}` : "";
  const fileName = `strudel-${randomUUID().slice(0, 8)}${stem}-${Math.round(data.bpm)}bpm.wav`;
  const tempPath = path.join(tempDirectory, fileName);
  fs.writeFileSync(tempPath, encodeStrudelWav(samples, result.sampleRate, result.channels, data));
  const imported = await context.resources.importIntoProject(tempPath);
  fs.rmSync(tempPath, { force: true });
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

function placeAt(track: AudioTrack<"1.0.0">, position: Position, rendered: Rendered) {
  const args = clipArgs(rendered);
  return "row" in position
    ? track.clipSlots[position.row].createAudioClip(args)
    : track.createAudioClip({ ...args, startTime: position.startTime, duration: args.loopSettings.loopEnd });
}
