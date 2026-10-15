// Only what src/ imports, typed loosely (members that callbacks or array
// methods hang off are typed, so `any` doesn't leak into parameters). CI can't
// check SDK usage itself, only that everything else typechecks, builds and
// passes its tests. Extend this when src/ uses more of the SDK.

export type Handle = unknown;
export type ActivationContext = unknown;

export interface ExtensionContext<Version extends string = string> {
  __version?: Version;
  commands: { registerCommand(commandId: string, callback: (...args: unknown[]) => void): void };
  ui: {
    registerContextMenuAction(scope: string, title: string, commandId: string): Promise<unknown>;
    showModalDialog(url: string, width: number, height: number): Promise<string>;
  };
  application: { song: { tracks: LiveObject<Version>[]; [key: string]: any }; [key: string]: any };
  getObjectFromHandle<T extends LiveObject<Version>>(handle: Handle, type: abstract new (...args: never) => T): T;
  [key: string]: any;
}
export declare function initialize<V extends string>(activation: ActivationContext, version: V): ExtensionContext<V>;

declare class LiveObject<Version extends string> {
  private __version?: Version;
  [key: string]: any;
}
export declare class ClipSlot<Version extends string = string> extends LiveObject<Version> {}
export declare class AudioClip<Version extends string = string> extends LiveObject<Version> {}
export declare class AudioTrack<Version extends string = string> extends LiveObject<Version> {
  clipSlots: ClipSlot<Version>[];
  arrangementClips: LiveObject<Version>[];
}
