import evaluate, { type Variables } from "../parse/evaluate";
import { type DirectiveStatement, type Node, StringNode } from "../parse/nodes";
import { Directives, type Qualifier, Qualifiers } from "../syntax";

/**
 * Get byte size of directive statement
 */
export default function directiveSize(
  { opcode: { op, qualifier }, operands }: DirectiveStatement,
  vars: Variables,
): number {
  // DC:
  if (op.name === Directives.DC && qualifier) {
    if (qualifier.name === Qualifiers.B) {
      return operandBytes(operands);
    }
    return operands.length * qualifierBytes[qualifier.name];
  }
  if (op.name === Directives.DB) {
    return operandBytes(operands);
  }
  if (op.name === Directives.DW) {
    return operands.length * 2;
  }
  if (op.name === Directives.DL) {
    return operands.length * 4;
  }

  // DCB / DS:
  if (
    (op.name === Directives.DCB || op.name === Directives.DS) &&
    qualifier &&
    operands[0]
  ) {
    const n = evaluate(operands[0].text, vars);
    if (n !== undefined) {
      const bytes = qualifierBytes[qualifier.name];
      return bytes * n;
    }
  }
  return 0;
}

const qualifierBytes: Record<Qualifier, number> = {
  B: 1,
  W: 2,
  L: 4,
  S: 4,
  D: 8,
  Q: 8,
  X: 12,
};

/**
 * Get byte count for a list of operands on dc.b / db
 *
 * Handles quoted strings as well as individual byte values.
 */
function operandBytes(operands: Node[]): number {
  let count = 0;
  for (const arg of operands) {
    if (arg instanceof StringNode) {
      count += arg.value.length;
    } else {
      count++;
    }
  }
  return count;
}
