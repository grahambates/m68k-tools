import type { ParsedLine } from "m68k-parser";

/**
 * What a macro call stands for, where that can be worked out.
 *
 * Filled in by `prepareMacros` and read by the register, flag and stack
 * semantics, which would otherwise have to treat every call as opaque. Kept in
 * a module of its own with no imports beyond types so both the semantics and
 * the analysis that fills it can depend on it without a cycle.
 *
 * Keyed by the call's line object, so an expansion lives exactly as long as the
 * parse it belongs to and re-parsing never sees a stale one.
 */
const expansions = new WeakMap<ParsedLine, readonly ParsedLine[]>();

export function setExpansion(
  call: ParsedLine,
  lines: readonly ParsedLine[],
): void {
  expansions.set(call, lines);
}

/** The instructions a macro call expands to, or undefined if that is not known. */
export function expansionOf(
  line: ParsedLine | undefined,
): readonly ParsedLine[] | undefined {
  return line ? expansions.get(line) : undefined;
}
