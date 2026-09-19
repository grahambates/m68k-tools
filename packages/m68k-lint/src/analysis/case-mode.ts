import type { ParsedFile } from "m68k-parser";
import { symbolKey } from "m68k-parser";

/**
 * Whether the symbols in a file are compared with case kept.
 *
 * An assembler keeps case unless told otherwise (`-nocase`, or `opt c-`), and
 * whether it was told is not always in the source, so it comes from the
 * config, as does whether strings read backslash escapes (`-esc`), which
 * decides how long string data is. Recorded against the parsed file, as macro expansions and settled
 * conditionals are, so the analyses that look names up need not each be handed
 * it. A file nobody set it for keeps case, which is the assembler's default.
 */
const modes = new WeakMap<ParsedFile, boolean>();

export function setCaseSensitive(
  file: ParsedFile,
  caseSensitive: boolean,
): void {
  modes.set(file, caseSensitive);
}

export function isCaseSensitive(file: ParsedFile): boolean {
  return modes.get(file) ?? true;
}

/** The key a symbol name is compared by in this file. */
export function nameKey(file: ParsedFile, name: string): string {
  return symbolKey(name, isCaseSensitive(file));
}

const escapes = new WeakMap<ParsedFile, boolean>();

export function setEscapeSequences(file: ParsedFile, on: boolean): void {
  escapes.set(file, on);
}

/** Whether strings in this file read backslash escapes. Not unless asked, as with the assembler. */
export function hasEscapeSequences(file: ParsedFile): boolean {
  return escapes.get(file) ?? false;
}
