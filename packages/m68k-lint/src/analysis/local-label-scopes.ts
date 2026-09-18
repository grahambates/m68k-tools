import type { ParsedFile } from "m68k-parser";
import { scanBlocks } from "./blocks.js";

/** Same spelling rule the parser itself uses to classify a label as local. */
function isLocalShaped(name: string): boolean {
  return name.startsWith(".") || name.endsWith("$");
}

/** A local name without its distinguishing dot, so `.loop` and `loop$` key the same way. */
function bareLocalName(name: string): string {
  return name.startsWith(".") ? name.slice(1) : name;
}

export interface LocalLabelScopes {
  /**
   * The nearest enclosing global label's name for this line, as written in the
   * source, or undefined where no global label precedes it.
   */
  scopeOf(index: number): string | undefined;
  /** A local label's file-wide identity: the scope it belongs to, plus its own name. */
  keyOf(index: number, label: string): string;
  /** Every local-label key referenced anywhere at file scope. */
  readonly referenced: ReadonlySet<string>;
}

/**
 * Ties every local label (`.loop`, `loop$`) to the global label it belongs to,
 * the way an assembler resolves one: by the nearest global label preceding it
 * in the source, not by name alone.
 *
 * Two routines can each define their own `.loop` without colliding. Matching
 * local names file-wide, ignoring that, fails in the direction that matters:
 * a `.loop` genuinely unused in one routine reads as used because an unrelated
 * routine's own `.loop` is referenced elsewhere in the file.
 *
 * Scope only advances at a label outside conditional assembly and macro
 * bodies. A global label inside an IFxx/ENDC arm may not exist in the
 * assembled output at all -- the arm not taken vanishes before anything is
 * resolved -- and a macro body is not file-level source to begin with. Letting
 * either move the boundary risks splitting a definition and its reference
 * across two different computed scopes even though the assembler kept them in
 * one.
 */
export function analyzeLocalLabelScopes(file: ParsedFile): LocalLabelScopes {
  const blocks = scanBlocks(file);
  const insideConditional = new Array<boolean>(file.lines.length).fill(false);
  for (const block of blocks.conditionals) {
    for (let i = block.start; i <= block.end; i++) insideConditional[i] = true;
  }

  const scopeKeyOf: (string | undefined)[] = [];
  const scopeNameOf: (string | undefined)[] = [];
  let currentKey: string | undefined;
  let currentName: string | undefined;
  file.lines.forEach((line, index) => {
    if (blocks.region[index] === 0 && !insideConditional[index]) {
      const label = line.label;
      if (label?.scope === "global") {
        currentKey = label.label.toLowerCase();
        currentName = label.label;
      }
    }
    scopeKeyOf[index] = currentKey;
    scopeNameOf[index] = currentName;
  });

  const keyOf = (index: number, label: string): string =>
    `${scopeKeyOf[index] ?? "<file>"}.${bareLocalName(label.toLowerCase())}`;

  const referenced = new Set<string>();
  const walk = (node: unknown, index: number): void => {
    if (!node || typeof node !== "object") return;
    const candidate = node as { type?: string; name?: string };
    if (candidate.type === "symbol" && typeof candidate.name === "string") {
      if (isLocalShaped(candidate.name))
        referenced.add(keyOf(index, candidate.name));
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach((v) => walk(v, index));
      else if (value && typeof value === "object") walk(value, index);
    }
  };
  file.lines.forEach((line, index) => {
    // A macro body is not file-level source: its local labels and references
    // belong to each expansion, not to one place this scan can see.
    if (blocks.region[index] !== 0) return;
    for (const operand of line.operands ?? []) walk(operand, index);
  });

  return {
    scopeOf: (index) => scopeNameOf[index],
    keyOf,
    referenced,
  };
}
