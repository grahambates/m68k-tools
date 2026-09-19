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
const ESCAPES = Symbol("escapeSequences");

/**
 * A new set of variables. `escapeSequences` marks it the same way for whether
 * strings read backslash escapes (`-esc`), which the size of string data needs.
 */
export function createVariables(
  caseSensitive = true,
  escapeSequences = false,
): Variables {
  const variables: Variables = {};
  if (!caseSensitive) Object.defineProperty(variables, FOLDED, { value: true });
  if (escapeSequences)
    Object.defineProperty(variables, ESCAPES, { value: true });
  return variables;
}

/** Whether strings read backslash escapes, for a set made with that option. */
export function readsEscapes(variables: Variables): boolean {
  return ESCAPES in variables;
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
