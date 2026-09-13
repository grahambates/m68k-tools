import { type Variables } from "../parse/evaluate";
import { type StatementNode } from "../parse/nodes";
import directiveSize from "./directiveSize";
import instructionSize from "./instructionSize";

export default function statementSize(
  statement: StatementNode,
  vars: Variables,
): number {
  if (statement.isDirective()) {
    return directiveSize(statement, vars);
  }
  if (statement.isInstruction()) {
    return instructionSize(statement);
  }
  return 0;
}
