import type { Location } from "./types.js";

/**
 * A zero-based position in a document.
 *
 * Structurally the same as the language server protocol's `Position`, so a
 * value of either type is accepted where the other is wanted, without this
 * package depending on a language server library.
 */
export interface TextPosition {
  line: number;
  character: number;
}

/** A range between two positions, end-exclusive; the protocol's `Range` shape. */
export interface TextRange {
  start: TextPosition;
  end: TextPosition;
}

/**
 * The range of a node location.
 *
 * `Location.line` is one-based and absent entirely for a location produced by
 * `parseLine`, whereas positions are zero-based. Pass `line` explicitly
 * (zero-based) when the location came from a single parsed line. Columns need
 * no adjustment: both are zero-based and end-exclusive.
 */
export function locationAsRange(loc: Location, line?: number): TextRange {
  const row = line ?? (loc.line !== undefined ? loc.line - 1 : 0);
  return {
    start: { line: row, character: loc.start },
    end: { line: row, character: loc.end },
  };
}

/** Is position a <= position b? */
export function isBeforeOrEqual(a: TextPosition, b: TextPosition): boolean {
  if (a.line < b.line) {
    return true;
  }
  if (b.line < a.line) {
    return false;
  }
  return a.character <= b.character;
}

/** Does range contain position? */
export function containsPosition(
  range: TextRange,
  position: TextPosition,
): boolean {
  return (
    isBeforeOrEqual(range.start, position) &&
    isBeforeOrEqual(position, range.end)
  );
}

/** Does range contain sub-range? */
export function containsRange(range: TextRange, subRange: TextRange): boolean {
  return (
    isBeforeOrEqual(range.start, subRange.start) &&
    isBeforeOrEqual(subRange.end, range.end)
  );
}
