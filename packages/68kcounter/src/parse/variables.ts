/**
 * Values of the symbols a source defines, as far as they can be worked out.
 *
 * An assembler keeps the case of a symbol unless it was asked not to (`-nocase`),
 * so `Foo` and `foo` are two variables by default. Where case is folded the set
 * is marked so, and every lookup and store goes through the functions here, which
 * fold the name to match. Marking the set, rather than passing a flag, keeps the
 * many places that hand it on to the expression evaluator unchanged.
 */
export type Variables = Record<string, number>;

const FOLDED = Symbol("caseFolded");

/** A new set of variables. */
export function createVariables(caseSensitive = true): Variables {
  const variables: Variables = {};
  if (!caseSensitive) Object.defineProperty(variables, FOLDED, { value: true });
  return variables;
}

function keyOf(variables: Variables, name: string): string {
  return FOLDED in variables ? name.toLowerCase() : name;
}

export function lookupVariable(
  variables: Variables,
  name: string,
): number | undefined {
  const key = keyOf(variables, name);
  return Object.hasOwn(variables, key) ? variables[key] : undefined;
}

export function setVariable(
  variables: Variables,
  name: string,
  value: number,
): void {
  variables[keyOf(variables, name)] = value;
}
