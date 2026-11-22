import { parseBlocks } from "./block-parser.js";
import type { Block, ParsedFile, ParsedLine } from "./types.js";

/**
 * Whether a label name is local: `.loop` or `loop$`.
 *
 * A local label means something only within the routine that contains it, so
 * two routines can each have their own. Which spelling makes a name local is
 * the assembler's rule, decided here once rather than wherever a name is met.
 */
export function isLocalLabelName(name: string): boolean {
  return name.startsWith(".") || name.endsWith("$");
}

/**
 * How a symbol name is compared with another.
 *
 * An assembler treats `Foo` and `foo` as two symbols unless it was asked not to
 * (`-nocase` for vasm, or `opt c-` in the source), so the default is that case
 * matters. Where it does not, both spellings are one name and this reduces them
 * to the same key. The name of a label, constant or macro should be compared
 * through this and never by lower-casing it directly.
 *
 * Instruction and directive names, and register names, are not symbols and are
 * matched without regard to case regardless.
 */
export function symbolKey(name: string, caseSensitive = true): string {
  return caseSensitive ? name : name.toLowerCase();
}

/** A local name without its distinguishing dot, so `.loop` and `loop$` are alike. */
export function bareLocalName(name: string): string {
  return name.startsWith(".") ? name.slice(1) : name;
}

/**
 * What a name in the label column defines.
 *
 * - `position`: a place in the program, such as `loop: dbf d0,loop` or
 *   `table: dc.w 1`.
 * - `offset`: a structure or frame offset (`rs`, `so`, `fo`). Written like a
 *   `ds` line, but the assembler gives the name a value from a running counter
 *   and places nothing.
 * - `equate`: a value given directly (`equ`, `=`, `set`, `equr`, `reg` and
 *   their floating-point and register-list forms).
 * - `macro`: the name of a macro (`Name macro`).
 */
export type LabelKind = "position" | "offset" | "equate" | "macro";

const OFFSET_DIRECTIVES = new Set(["rs", "so", "fo"]);

const EQUATE_DIRECTIVES = new Set([
  "equ",
  "=",
  "set",
  "fequ",
  "fset",
  "equr",
  "equrl",
  "fequr",
  "fequrl",
  "reg",
  "freg",
]);

/**
 * What the line's label defines, or undefined for a line with no label.
 *
 * Only a `position` label begins a new routine for the local labels after it;
 * checked against vasm for `equ`, `rs`, `so` and `fo`.
 */
export function labelKind(line: ParsedLine): LabelKind | undefined {
  if (!line.label) return undefined;
  if (line.mnemonic?.type !== "directive") return "position";
  const directive = line.mnemonic.directive.toLowerCase();
  if (directive === "macro") return "macro";
  if (OFFSET_DIRECTIVES.has(directive)) return "offset";
  if (EQUATE_DIRECTIVES.has(directive)) return "equate";
  return "position";
}

export interface LocalLabelScopes {
  /**
   * The name, as written, of the label whose routine a line belongs to, or
   * undefined before the first one.
   */
  scopeOf(index: number): string | undefined;
  /**
   * A local label's file-wide identity: the scope it belongs to plus its own
   * name. Works for a definition and for a reference to it from any line.
   */
  keyOf(index: number, label: string): string;
}

/**
 * Tie every local label to the global label whose routine it is in, the way an
 * assembler resolves one: by the nearest preceding global label, not by name
 * alone.
 *
 * Two routines can each define their own `.loop`. Matching local names
 * file-wide, ignoring that, fails in the direction that matters: a `.loop`
 * genuinely unused in one routine reads as used because an unrelated routine's
 * own `.loop` is referenced elsewhere in the file, and a branch to `.loop`
 * lands on whichever was defined last.
 *
 * The scope only advances at a label that is part of the program: not one on a
 * line that merely defines a symbol, not one inside a macro body (which belongs
 * to each expansion rather than to the file), and not one inside conditional
 * assembly (which may not exist in the assembled output at all -- the arm not
 * taken vanishes before anything is resolved -- so letting it move the
 * boundary risks splitting a definition and its reference across two computed
 * scopes even though the assembler kept them in one).
 */
export function analyzeLocalLabelScopes(
  file: ParsedFile,
  options: { caseSensitive?: boolean } = {},
): LocalLabelScopes {
  const normalize = (name: string) => symbolKey(name, options.caseSensitive);
  const skipped = new Array<boolean>(file.lines.length).fill(false);
  const mark = (blocks: readonly Block[]) => {
    for (const block of blocks) {
      if (block.kind !== "repeat") {
        const last = block.end ?? file.lines.length - 1;
        for (let i = block.start; i <= last; i++) skipped[i] = true;
      }
      mark(block.children);
    }
  };
  mark(parseBlocks(file).blocks);

  const key: (string | undefined)[] = [];
  const name: (string | undefined)[] = [];
  let currentKey: string | undefined;
  let currentName: string | undefined;
  file.lines.forEach((line, index) => {
    const label = line.label;
    if (
      !skipped[index] &&
      label?.scope === "global" &&
      labelKind(line) === "position"
    ) {
      currentKey = normalize(label.label);
      currentName = label.label;
    }
    key[index] = currentKey;
    name[index] = currentName;
  });

  return {
    scopeOf: (index) => name[index],
    keyOf: (index, label) =>
      `${key[index] ?? "<file>"}.${bareLocalName(normalize(label))}`,
  };
}
