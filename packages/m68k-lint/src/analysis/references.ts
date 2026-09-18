import type { ParsedLine } from "m68k-parser";

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
): Set<string> {
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const candidate = node as { type?: string; name?: string };
    if (candidate.type === "symbol" && typeof candidate.name === "string")
      into.add(candidate.name.toLowerCase());
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === "object") walk(value);
    }
  };
  for (const line of lines)
    for (const operand of line.operands ?? []) walk(operand);
  return into;
}
