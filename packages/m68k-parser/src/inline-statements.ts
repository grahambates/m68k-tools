import type { ParsedFile } from "./types.js";

/**
 * Make an `iif` line the statement it makes conditional.
 *
 * `iif <condition> <statement>` is an inline `if`. Tools look at a line's
 * mnemonic and operands, and the parser keeps the statement apart from the
 * directive, so this replaces each such line with one that has the statement's
 * mnemonic, size and operands and keeps the label, the comment and the
 * condition. The condition is what marks it as conditional: whatever it does
 * may not happen, and it is not part of a sequence with its neighbours, as
 * anything in a conditional block is not.
 *
 * Changes the file it is given, as an analysis would otherwise have to work
 * around the line at every step.
 *
 * Safe to call again: a line already made one has no statement left to take.
 */
export function expandInlineStatements(file: ParsedFile): void {
  file.lines.forEach((line, index) => {
    const inner = line.inlineStatement;
    if (!inner?.mnemonic || line.inlineCondition === undefined) return;
    file.lines[index] = {
      ...line,
      mnemonic: inner.mnemonic,
      qualifier: inner.qualifier,
      operands: inner.operands,
      inlineStatement: undefined,
    };
  });
}
