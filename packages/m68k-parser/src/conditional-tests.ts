const comparisons = new Map<string, (value: number) => boolean>([
  ["if", (value) => value !== 0],
  ["ifne", (value) => value !== 0],
  ["elif", (value) => value !== 0],
  ["ifeq", (value) => value === 0],
  ["ifgt", (value) => value > 0],
  ["ifge", (value) => value >= 0],
  ["iflt", (value) => value < 0],
  ["ifle", (value) => value <= 0],
]);

/** The numeric predicate used by a vasm Motorola conditional directive. */
export function conditionalComparison(directive: string) {
  return comparisons.get(directive.toLowerCase());
}

/** ELSEIF is a Motorola spelling of ELSE. ELIF takes an expression. */
export function isUnconditionalAlternative(
  directive: string | undefined,
): boolean {
  return directive === "else" || directive === "elseif";
}
