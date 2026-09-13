import * as expEval from "expression-eval";

export type Variables = Record<string, number>;

/**
 * Try to evaluate an ASM expression to a numeric value.
 *
 * @param expression Text value
 * @param vars Optional variables to substitute in expression
 */
export default function evaluate(
  expression: string,
  vars: Variables = {},
): number | undefined {
  // Transform ASM expression syntax to be compatible with `expression-eval`
  const preprocessed = expression
    // Remove immediate prefix
    .replace(/^#/, "")
    // Hex
    .replace(/\$([0-9a-f]+)/gi, (_, p1) => eval("0x" + p1))
    // Binary
    .replace(/%([0-1]+)/gi, (_, p1) => eval("0b" + p1))
    // Octal
    .replace(/@([0-7]+)/gi, (_, p1) => eval("0o" + p1))
    // OR
    .replace(/(?<=[a-z0-9_])!(?=[a-z0-9_])/g, "|")
    // XOR
    .replace(/(?<=[a-z0-9_])~(?=[a-z0-9_])/g, "^");

  try {
    const ast = expEval.parse(preprocessed);
    return expEval.eval(ast, vars);
  } catch (e) {
    // ignore
  }
}
