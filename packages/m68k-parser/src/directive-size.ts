import { evaluateConstant } from "./evaluate.js";
import { decodeStringEscapes } from "./string-escapes.js";
import type { ExpressionNode, ParsedLine, Size } from "./types.js";

/** Bytes in one element of each size. */
const ELEMENT_BYTES: Readonly<Record<Size, number>> = {
  b: 1,
  w: 2,
  l: 4,
  s: 4,
  d: 8,
  q: 8,
  x: 12,
  p: 12,
};

export interface DirectiveSizeOptions {
  /**
   * The value of an expression, when it is known. Without it only a literal
   * number is understood, so a `ds` sized by a constant is unknown.
   */
  evaluate?: (expr: ExpressionNode) => number | undefined;
  /**
   * Whether the assembler reads backslash escapes in strings (vasm's `-esc`), so
   * `"a\n"` is two elements, not three. Default false.
   */
  escapeSequences?: boolean;
}

/**
 * How many bytes a data or storage directive emits, or undefined when that is
 * not known.
 *
 * Covers `dc` (and `db`, `dw`, `dl`), `dcb` and `ds` (and `blk`). Without a
 * size they take a word, as an assembler does. Every character of a string is
 * one element as written, so `"a\n"` is three bytes: a backslash is not an
 * escape, unless `escapeSequences` says the assembler reads them.
 *
 * Undefined also covers what has no fixed size, such as a count that is not a
 * known number, and everything that is not one of these directives: a caller
 * decides for itself what `equ` or `even` amount to.
 */
export function directiveSize(
  line: ParsedLine,
  options: DirectiveSizeOptions = {},
): number | undefined {
  if (line.mnemonic?.type !== "directive") return undefined;
  const directive = line.mnemonic.directive.toLowerCase();
  const qualifier =
    line.qualifier?.type === "size" ? line.qualifier.size : undefined;
  const operands = line.operands ?? [];

  const evaluate =
    options.evaluate ??
    ((expr: ExpressionNode) => {
      const result = evaluateConstant(expr);
      return result.known ? result.value : undefined;
    });

  switch (directive) {
    case "db":
    case "dw":
    case "dl":
    case "dc": {
      const size: Size =
        directive === "db"
          ? "b"
          : directive === "dw"
            ? "w"
            : directive === "dl"
              ? "l"
              : (qualifier ?? "w");
      let elements = 0;
      for (const operand of operands) {
        if (operand.type === "string-literal") {
          elements += options.escapeSequences
            ? decodeStringEscapes(operand.content).elements.length
            : operand.content.length;
        } else if (operand.type === "value") {
          elements++;
        } else {
          return undefined;
        }
      }
      return elements * ELEMENT_BYTES[size];
    }

    case "dcb":
    case "blk":
    case "ds": {
      const count = operands[0];
      if (count?.type !== "value") return undefined;
      const n = evaluate(count.value);
      if (n === undefined || !Number.isInteger(n) || n < 0) return undefined;
      return n * ELEMENT_BYTES[qualifier ?? "w"];
    }

    default:
      return undefined;
  }
}
