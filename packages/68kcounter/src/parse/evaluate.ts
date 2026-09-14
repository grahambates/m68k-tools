import { evaluateConstant, parseExpression } from "m68k-parser";

export type Variables = Record<string, number>;

/** Evaluate a Motorola-syntax integer expression using vasm precedence. */
export default function evaluate(
  expression: string,
  vars: Variables = {},
): number | undefined {
  const parsed = parseExpression(expression.trim().replace(/^#/, ""));
  if (parsed.errors.length) return undefined;
  const result = evaluateConstant(parsed.value, (name) =>
    Object.hasOwn(vars, name) ? vars[name] : undefined,
  );
  return result.known && Number.isFinite(result.value)
    ? result.value
    : undefined;
}
