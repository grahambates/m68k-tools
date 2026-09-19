import {
  descendants,
  symbolKey,
  type OperandNode,
  type ParsedLine,
} from "m68k-parser";

/** Every symbol name in an operand, as written, however deeply it is nested. */
export function symbolNamesIn(operand: OperandNode): string[] {
  const names: string[] = [];
  for (const node of [operand, ...descendants(operand)]) {
    const { name } = node as { name?: unknown };
    if (node.type === "symbol" && typeof name === "string") names.push(name);
  }
  return names;
}

/**
 * Symbol names referenced by a line's operands, lower-cased.
 *
 * Registers and mnemonics are not symbols to the parser, so this sees only the
 * names a person chose: constants, labels, equates. The operand tree is walked
 * generically rather than by shape, so a name buried in an expression is found
 * too -- `dc.l table+4` and `move.l #SCALE*2,d0` both count as a reference to
 * `table` and `SCALE` respectively.
 */
export function collectReferencedSymbols(
  lines: readonly ParsedLine[],
  into: Set<string> = new Set(),
  caseSensitive = true,
): Set<string> {
  for (const line of lines)
    for (const operand of line.operands ?? [])
      for (const name of symbolNamesIn(operand))
        into.add(symbolKey(name, caseSensitive));
  return into;
}
