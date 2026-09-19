import {
  directiveSize as sizeOf,
  evaluateConstant,
  parseLine,
  type ExpressionNode,
} from "m68k-parser";
import { type Variables } from "../parse/evaluate";
import { type DirectiveStatement, type StatementNode } from "../parse/nodes";

/**
 * Get byte size of directive statement
 *
 * The parser says what `dc`, `dcb`, `ds` and their aliases emit, so counts
 * agree with every other tool here. A count that cannot be worked out is
 * counted as nothing rather than guessed. A backslash in a string counts as the
 * character it is written as.
 */
export default function directiveSize(
  statement: StatementNode & DirectiveStatement,
  vars: Variables,
): number {
  const evaluate = (expr: ExpressionNode): number | undefined => {
    const result = evaluateConstant(expr, (name) =>
      Object.hasOwn(vars, name) ? vars[name] : undefined,
    );
    return result.known && Number.isFinite(result.value)
      ? result.value
      : undefined;
  };
  return (
    sizeOf(parseLine(statement.text).value, { evaluate, escapes: "literal" }) ??
    0
  );
}
