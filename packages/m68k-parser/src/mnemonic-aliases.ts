/**
 * Spellings an assembler treats as one instruction.
 *
 * Several tools need to see through these, and each had its own list: the
 * timing tables, the linter's semantics and the language server's operand
 * checks. This is the one place that says what is equivalent to what.
 */

/**
 * The canonical spelling of a condition-code synonym, lower case.
 *
 * `HS` is `CC` (higher or same, carry clear) and `LO` is `CS` (lower, carry
 * set), in Bcc, DBcc and Scc alike, and `DBRA` is `DBF`. Any other name is
 * returned as it came, so this is safe to apply to every mnemonic.
 */
export function canonicalConditionMnemonic(name: string): string {
  const mnemonic = name.toLowerCase();
  if (mnemonic === "dbra") return "dbf";

  for (const prefix of ["db", "b", "s"] as const) {
    if (!mnemonic.startsWith(prefix)) continue;
    const condition = mnemonic.slice(prefix.length);
    if (condition === "hs") return `${prefix}cc`;
    if (condition === "lo") return `${prefix}cs`;
  }
  return mnemonic;
}

/** The instructions that take an address register destination in a separate form. */
const ADDRESS_FORMS: Readonly<Record<string, string>> = {
  move: "movea",
  add: "adda",
  sub: "suba",
  cmp: "cmpa",
};

/**
 * The address-register form of a generic instruction, or undefined if it has
 * none. Assemblers accept `move.l d0,a0` and `add.l #4,a0` and encode them as
 * MOVEA and ADDA, so what such a line does is that of the other instruction.
 */
export function addressRegisterForm(name: string): string | undefined {
  return ADDRESS_FORMS[name.toLowerCase()];
}
