import * as fs from "node:fs";
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
import { BEATS_PER_CYCLE, type SessionInput } from "./protocol.js";
import { STARTER_CODE, STARTER_CYCLES } from "./starter.js";
import { runEditorSession, type RenderResult } from "./server.js";
import { ClipStore, clipFilePrefix, clipIdOf, newClipId } from "./clipStore.js";
import { encodeStrudelWav, type StrudelData } from "./wav.js";

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
  const result = await edit(context, { code: STARTER_CODE, cycles: STARTER_CYCLES }, "session");
  if (result) await place(context, { row: track.clipSlots.indexOf(slot) }, 1, result, [], track);
}

async function editClip(context: Context, clip: AudioClip<"1.0.0">) {
  const store = clipStore(context);
  const existing = store.load(clip.filePath);
  if (!existing) {
    console.warn(
      clipIdOf(clip.filePath)
        ? `This clip's code is only in its file, which extensions can't read: it was rendered on another machine. ${clip.filePath}`
        : `Not a Strudel clip: ${clip.filePath}`,
    );
    return;
  }
  const parent = clip.parent;
  // Where the group starts: the row of its first scene, or the clip's position
  // in the Arrangement (which has no scenes).
  let base: Position;
  let rows = 1;
  let track: AudioTrack<"1.0.0">;
  if (parent instanceof ClipSlot && parent.parent instanceof AudioTrack) {
    track = parent.parent;
    // Clamped in case rows were moved since the last render.
    base = { row: Math.max(0, track.clipSlots.indexOf(parent) - (existing.scene ?? 0)) };
    rows = existing.scenes?.length ?? 1;
  } else if (parent instanceof AudioTrack) {
    track = parent;
    base = { startTime: clip.startTime };
  } else {
    console.warn("Editing clips in take lanes isn't supported yet.");
    return;
  }
  // Editing one stem re-renders the whole group.
  const current = existing.group
    ? findGroup(context, store, base, rows, existing.group)
    : [{ track, clip, data: existing }];
  const result = await edit(context, existing, "row" in base ? "session" : "arrangement");
  if (result) await place(context, base, rows, result, current, track);
}

/** Where a clip sits: a Session row, or an Arrangement position in beats. */
type Position = { row: number } | { startTime: number };

/** Where the clip for `scene` goes, given where the group starts. */
function offset(base: Position, scene = 0): Position {
  return "row" in base ? { row: base.row + scene } : base;
}

interface Placed {
  track: AudioTrack<"1.0.0">;
  clip: AudioClip<"1.0.0">;
  data: StrudelData;
}

/** The clips of a stems group in the `rows` rows from `base`, or at `base` in the Arrangement. */
function findGroup(context: Context, store: ClipStore, base: Position, rows: number, group: string): Placed[] {
  const found: Placed[] = [];
  const positions = "row" in base ? Array.from({ length: rows }, (_, i) => offset(base, i)) : [base];
  for (const track of context.application.song.tracks) {
    if (!(track instanceof AudioTrack)) continue;
    for (const position of positions) {
      const clip = clipAt(track, position);
      if (!(clip instanceof AudioClip)) continue;
      const data = store.load(clip.filePath);
      if (data?.group === group) found.push({ track, clip, data });
    }
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
 * Replaces a group's clips (`current`, in the `rows` rows from `base`) with a
 * new render, in place: an audio clip's file can't be swapped. Rows match
 * scenes by position. If there are more scenes than rows, scenes are inserted
 * below, so the rest of the set moves down rather than being overwritten.
 *
 * Each label keeps the track it was on, or else goes on a free track named
 * after it, `fallback` if that's free, or a new track. Clips whose label or
 * scene is gone from the code are deleted; tracks and scenes are kept.
 */
async function place(
  context: Context,
  base: Position,
  rows: number,
  { rendered, scenes }: Edited,
  current: Placed[],
  fallback: AudioTrack<"1.0.0">,
) {
  const song = context.application.song;
  const labelOf = (data: StrudelData) => data.stem ?? "";
  const labels = new Set(rendered.map((r) => labelOf(r.data)));
  // Read before deleting anything: a deleted clip's properties are gone.
  const colors = new Map(current.map(({ clip, data }) => [`${data.scene ?? 0}/${labelOf(data)}`, clip.color]));
  const color = current[0]?.clip.color;
  const tracks = new Map<string, AudioTrack<"1.0.0">>();
  for (const { track, clip, data } of current) {
    if (labels.has(labelOf(data))) tracks.set(labelOf(data), track);
    await deleteClip(track, offset(base, data.scene), clip);
  }

  if (scenes && "row" in base) {
    for (let row = base.row + rows; row < base.row + scenes.length; row++) await song.createScene(row);
    for (const [i, name] of scenes.entries()) song.scenes[base.row + i].name = name;
  }

  for (const r of rendered) {
    const label = labelOf(r.data);
    const position = offset(base, r.data.scene);
    let track = tracks.get(label);
    if (!track) {
      const beats = r.data.cycles * BEATS_PER_CYCLE;
      const used = new Set(tracks.values());
      const found: AudioTrack<"1.0.0"> =
        freeTrack(context, position, beats, r.data.stem, fallback, used) ?? (await song.createAudioTrack());
      if (r.data.stem) found.name = r.data.stem;
      tracks.set(label, found);
      track = found;
    }
    const clip = await placeAt(track, position, r);
    // A stem is named after its variable or label; a clip without one keeps its name.
    const previous = current.find((p) => labelOf(p.data) === label && (p.data.scene ?? 0) === (r.data.scene ?? 0));
    clip.name = r.data.clip ?? r.data.stem ?? (previous?.clip.name || "Strudel");
    const clipColor = colors.get(`${r.data.scene ?? 0}/${label}`) ?? color;
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

interface Edited {
  rendered: Rendered[];
  /** The scenes' names, when the code calls `scenes()`. */
  scenes?: string[];
}

/** Opens the editor; if the user renders, writes a WAV per stem into the project. */
async function edit(
  context: Context,
  initial: Pick<StrudelData, "code" | "cycles" | "group">,
  view: SessionInput["view"],
): Promise<Edited | undefined> {
  const bpm = context.application.song.tempo;
  const { code, cycles } = initial;
  const { storageDirectory } = context.environment;
  const result = await runEditorSession(
    { code, cycles, bpm, view },
    (url) => context.ui.showModalDialog(url, 960, 640),
    { settingsFile: storageDirectory && path.join(storageDirectory, "settings.json") },
  );
  if (!result) return undefined;
  const group = result.stems && (initial.group ?? randomUUID());
  const rendered: Rendered[] = [];
  for (const [i, samples] of result.samples.entries()) {
    const data: StrudelData = {
      version: 1,
      code: result.code,
      cycles: result.cycles,
      bpm,
      stem: result.stems?.[i].label,
      clip: result.stems?.[i].clip,
      group,
      scene: result.stems?.[i].scene,
      scenes: result.scenes,
    };
    const id = newClipId();
    rendered.push({ filePath: await writeIntoProject(context, id, result, samples, data), data });
    clipStore(context).save(id, data);
  }
  return { rendered, scenes: result.scenes };
}

/** Where clips' Strudel data is kept: the extension can't read it back from their files (see clipStore.ts). */
function clipStore(context: Context): ClipStore {
  const { storageDirectory } = context.environment;
  if (!storageDirectory) throw new Error("The Extension Host has no storage directory to keep clips' code in.");
  return new ClipStore(path.join(storageDirectory, "clips"));
}

/** Writes a clip's WAV, with its Strudel data in a `strd` chunk, and imports it into the project. */
async function writeIntoProject(
  context: Context,
  id: string,
  result: RenderResult,
  samples: Float32Array,
  data: StrudelData,
): Promise<string> {
  // The only place besides the storage directory the extension may write to.
  // Live always gives one; in development, scripts/start.ts does.
  const { tempDirectory } = context.environment;
  if (!tempDirectory) throw new Error("The Extension Host has no temp directory to render into.");
  fs.mkdirSync(tempDirectory, { recursive: true });
  const scene = data.scene === undefined ? undefined : data.scenes?.[data.scene];
  const name = [scene, data.clip ?? data.stem]
    .map((part) => (part ? `-${part.replace(/[^\w-]+/g, "_")}` : ""))
    .join("");
  // The ID starts the name, so the clip's data can be found from its path (see clipStore.ts).
  const fileName = `${clipFilePrefix(id)}${name}-${Math.round(data.bpm)}bpm.wav`;
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
