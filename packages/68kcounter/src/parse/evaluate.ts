import { evaluateConstant, parseExpression } from "m68k-parser";
import { lookupVariable, type Variables } from "./variables";

export type { Variables };

/** Evaluate a Motorola-syntax integer expression using vasm precedence. */
export default function evaluate(
  expression: string,
  vars: Variables = {},
): number | undefined {
  const parsed = parseExpression(expression.trim().replace(/^#/, ""));
  if (parsed.errors.length) return undefined;
  const result = evaluateConstant(parsed.value, (name) =>
    lookupVariable(vars, name),
  );
  return result.known && Number.isFinite(result.value)
    ? result.value
    : undefined;
}
