import type { ParsedFile } from "m68k-parser";
import type { Diagnostic } from "./diagnostic.js";

/**
 * The run of source lines a finding covers, inclusive, numbered from 1 to match
 * `loc.line`.
 *
 * A rule that matches a sequence replaces the whole run: BSR followed by RTS
 * becomes a single BRA, so the suggestion's replacement stands in for both
 * lines. Anything applying a replacement, measuring it, or drawing it needs to
 * know that extent, so it belongs on the diagnostic rather than being
 * reconstructed by each consumer.
 */
export interface SourceSpan {
  startLine: number;
  endLine: number;
}

/**
 * Work out the extent of a finding.
 *
 * Rules express a multi-line match by recording the index of the last line in
 * `data`, under `sourceEndIndex` or a key ending `InstructionIndex`. That
 * convention predates this function and is kept, but it is now read once, here,
 * so every diagnostic carries the answer whether or not anything measures it.
 */
export function computeSourceSpan(
  diagnostic: Diagnostic,
  file: ParsedFile,
): SourceSpan | undefined {
  const located = diagnostic.loc.line;
  let start =
    located !== undefined && located >= 1 && located <= file.lines.length
      ? located - 1
      : file.lines.findIndex((line) => line.mnemonic?.loc === diagnostic.loc);
  if (start < 0) return undefined;

  let end = start;
  for (const [key, value] of Object.entries(diagnostic.data ?? {})) {
    if (typeof value !== "number" || !Number.isInteger(value)) continue;
    if (key === "sourceStartIndex") start = Math.min(start, value);
    else if (key === "sourceEndIndex" || key.endsWith("InstructionIndex"))
      end = Math.max(end, value);
  }
  return { startLine: start + 1, endLine: end + 1 };
}
