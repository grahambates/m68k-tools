import type { ParsedFile } from "m68k-parser";
import { symbolKey } from "m68k-parser";

/**
 * How the assembler was run, for the parts of it the source does not say:
 * whether symbols are compared with case kept (`-nocase`, or `opt c-`) and
 * whether strings read backslash escapes (`-esc`), which decides how long string
 * data is. Both come from the config.
 *
 * Recorded against the parsed file, as macro expansions and settled conditionals
 * are, so the analyses that need them are not each handed them. A file nobody
 * set them for gets the assembler's defaults: case kept, no escapes.
 */
/** Whether the symbols in a file are compared with case kept. */
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
