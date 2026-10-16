// The Strudel packages ship no type declarations; these cover what ui/main.ts uses.
declare module "@strudel/core" {
  interface Fraction {
    valueOf(): number;
  }
  export interface Hap {
    whole?: { begin: Fraction; end: Fraction };
    duration: number;
    value: any;
    context: Record<string, unknown>;
    hasOnset(): boolean;
    ensureObjectValue(): void;
  }
  export class Pattern {
    queryArc(begin: number, end: number, controls?: Record<string, unknown>): Hap[];
    /** Registers the pattern under a label; `kick: …` transpiles to `….p("kick")`. */
    p(id: string | number): Pattern;
    withContext(func: (context: Record<string, unknown>) => Record<string, unknown>): Pattern;
  }
  export function evalScope(...modules: unknown[]): Promise<unknown[]>;
  export function isPattern(thing: unknown): boolean;
  export function stack(...patterns: Pattern[]): Pattern;
  export const silence: Pattern;
}

declare module "@strudel/mini" {
  export function miniAllStrings(): void;
}

declare module "@strudel/tonal";

declare module "@strudel/transpiler" {
  export const transpiler: unknown;
}

declare module "@strudel/draw" {
  export function getDrawContext(): CanvasRenderingContext2D;
  /** Colours for visuals drawn on a canvas, like a CodeMirror theme's settings. */
  export function setTheme(settings: Record<string, string>): void;
}

declare module "@strudel/webaudio" {
  import type { Hap } from "@strudel/core";

  export function webaudioOutput(hap: Hap, deadline: number, duration: number, cps: number, t: number): Promise<void>;
  export function registerSynthSounds(): void;
  export function samples(source: string): Promise<void>;
  export function initAudioOnFirstClick(): Promise<void>;

  export function getAudioContext(): AudioContext;
  export function setAudioContext(context: BaseAudioContext | null): void;
  export function setSuperdoughAudioController(controller: null): void;
  export function initAudio(options?: { maxPolyphony?: number; multiChannelOrbits?: boolean }): Promise<void>;
  export function resetGlobalEffects(): void;
  export function superdough(
    value: unknown,
    deadline: number,
    duration: number,
    cps: number,
    cycle: number,
  ): Promise<void>;
}

declare module "@strudel/codemirror" {
  import type { Pattern } from "@strudel/core";
  import type { Extension } from "@codemirror/state";
  import type { EditorView } from "@codemirror/view";

  export type Keybindings = "codemirror" | "vim" | "emacs" | "vscode";
  export interface EditorSettings {
    keybindings: Keybindings;
    isBracketMatchingEnabled: boolean;
    isBracketClosingEnabled: boolean;
    isLineNumbersDisplayed: boolean;
    isActiveLineHighlighted: boolean;
    isAutoCompletionEnabled: boolean;
    isPatternHighlightingEnabled: boolean;
    isFlashEnabled: boolean;
    isTooltipEnabled: boolean;
    isLineWrappingEnabled: boolean;
    isTabIndentationEnabled: boolean;
    isMultiCursorEnabled: boolean;
    theme: string;
    fontFamily: string;
    fontSize: number;
  }
  export const defaultSettings: EditorSettings;
  /** Editor themes by name, as chosen by the `theme` setting. */
  export const themes: Record<string, Extension>;
  /** Each theme's colours, set as CSS variables (`--foreground`, …) and handed to @strudel/draw. */
  export const settings: Record<string, Record<string, string>>;
  export const codemirrorSettings: {
    get(): EditorSettings;
    set(settings: EditorSettings): void;
  };

  interface Repl {
    evaluate(code: string, autostart?: boolean): Promise<Pattern | undefined>;
    setCps(cps: number): void;
    stop(): void;
    scheduler: { started: boolean };
  }

  export class StrudelMirror {
    constructor(options: {
      root: HTMLElement;
      initialCode?: string;
      prebake: () => Promise<unknown>;
      bgFill?: boolean;
      drawContext?: CanvasRenderingContext2D;
      defaultOutput: unknown;
      getTime: () => number;
      transpiler: unknown;
      onToggle?: (started: boolean) => void;
      onEvalError?: (error: Error) => void;
      beforeEval?: () => void | Promise<void>;
      afterEval?: (options: { code: string; pattern: Pattern }) => void;
    });
    editor: EditorView;
    repl: Repl;
    code: string;
    evaluate(autostart?: boolean): Promise<void>;
    stop(): Promise<void>;
    updateSettings(settings: Partial<EditorSettings>): void;
    changeSetting<K extends keyof EditorSettings>(key: K, value: EditorSettings[K]): void;
  }
}
