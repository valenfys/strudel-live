import { isPattern, silence, stack, type Pattern } from "@strudel/core";
import { parse, type Node } from "acorn";

// `scenes({ intro: { hat }, verse: { kick, hat, bass } })` lays the code out as
// Session scenes: one row per scene, one track per part. The parts' keys name
// their tracks, so shorthand properties (`{ kick }`) use the variable names.

export interface Scene {
  name: string;
  /** Track name → pattern, in the order written. */
  parts: [string, Pattern][];
}

let defined: Scene[] | null = null;
let previewed = "";

/** Call before every evaluation, so code that drops `scenes()` has none. */
export function resetScenes(): void {
  defined = null;
}

/** The scenes the last evaluation defined, or null if it didn't call `scenes()`. */
export function definedScenes(): Scene[] | null {
  return defined;
}

/** Chooses the scene that `scenes()` returns, and so the one that previews. */
export function previewScene(name: string): void {
  previewed = name;
}

/**
 * The variable each part of `scenes({...})` was written with, by scene and
 * then track: `drop: { hats: rollinghats }` maps drop → hats → rollinghats.
 * `scenes()` only receives the values, so this reads the code. Parts written
 * any other way (`hats: s("hh*16")`) aren't listed.
 */
export function partVariables(code: string): Map<string, Map<string, string>> {
  const found = new Map<string, Map<string, string>>();
  let ast: Node;
  try {
    ast = parse(code, { ecmaVersion: "latest", allowAwaitOutsideFunction: true });
  } catch {
    return found; // Evaluating the code reports the error.
  }
  visit(ast, (node) => {
    if (node.type !== "CallExpression") return;
    const {
      callee,
      arguments: [definition],
    } = node as unknown as CallNode;
    if (callee.type !== "Identifier" || callee.name !== "scenes" || definition?.type !== "ObjectExpression") return;
    for (const scene of definition.properties ?? []) {
      const parts = new Map<string, string>();
      for (const part of scene.value?.type === "ObjectExpression" ? (scene.value.properties ?? []) : []) {
        if (part.value?.type === "Identifier" && keyOf(part)) parts.set(keyOf(part)!, part.value.name!);
      }
      if (keyOf(scene)) found.set(keyOf(scene)!, parts);
    }
  });
  return found;
}

// The bits of ESTree that partVariables reads.
interface ExpressionNode {
  type: string;
  name?: string;
  value?: unknown;
  properties?: PropertyNode[];
}
interface PropertyNode {
  type: string;
  computed?: boolean;
  key: ExpressionNode;
  value?: ExpressionNode;
}
interface CallNode {
  callee: ExpressionNode;
  arguments: ExpressionNode[];
}

/** A property's key as written: `drop` or `"drop"`, but not `[drop]`. */
function keyOf(property: PropertyNode): string | undefined {
  if (property.type !== "Property" || property.computed) return undefined;
  const { key } = property;
  if (key.type === "Identifier") return key.name;
  return key.type === "Literal" && typeof key.value === "string" ? key.value : undefined;
}

function visit(node: unknown, onNode: (node: Node) => void) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) return node.forEach((child) => visit(child, onNode));
  if (typeof (node as Node).type === "string") onNode(node as Node);
  for (const value of Object.values(node)) if (value && typeof value === "object") visit(value, onNode);
}

/** Exposed to Strudel code. Returns the previewed scene (else the first) as one pattern. */
export function scenes(definition: Record<string, Record<string, unknown>>): Pattern {
  if (defined) throw new Error("scenes() can only be called once");
  defined = Object.entries(definition).map(([name, parts]) => {
    if (!parts || typeof parts !== "object") throw new Error(`Scene "${name}" must be an object of parts`);
    return {
      name,
      parts: Object.entries(parts).map(([track, pattern]): [string, Pattern] => {
        if (!isPattern(pattern)) throw new Error(`"${track}" in scene "${name}" is not a pattern`);
        return [track, pattern as Pattern];
      }),
    };
  });
  const scene = defined.find((s) => s.name === previewed) ?? defined[0];
  return scene ? stack(...scene.parts.map(([, pattern]) => pattern)) : silence;
}
