// @strudel/web ships no type declarations; these cover what ui/main.ts uses.
declare module "@strudel/web" {
  interface Fraction {
    valueOf(): number;
  }
  interface Hap {
    whole?: { begin: Fraction; end: Fraction };
    duration: number;
    value: any;
    hasOnset(): boolean;
    ensureObjectValue(): void;
  }
  export interface Pattern {
    queryArc(begin: number, end: number, controls?: Record<string, unknown>): Hap[];
  }
  interface Repl {
    setCps(cps: number): void;
  }

  export function initStrudel(options?: {
    prebake?: () => Promise<unknown>;
    onEvalError?: (error: Error) => void;
  }): Promise<Repl>;
  export function evaluate(code: string, autoplay?: boolean): Promise<Pattern | undefined>;
  export function hush(): void;
  export function samples(source: string): Promise<void>;

  export function getAudioContext(): BaseAudioContext & { close(): Promise<void> };
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
