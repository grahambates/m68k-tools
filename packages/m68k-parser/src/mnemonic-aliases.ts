/**
 * Spellings an assembler treats as one instruction.
 *
 * Several tools need to see through these, and each had its own list: the
 * timing tables, the linter's semantics and the language server's operand
 * checks. This is the one place that says what is equivalent to what.
 */

import type { AddressingModeName } from "./addressing-mode.js";

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

/** The instructions with a separate form for an immediate source. */
const IMMEDIATE_FORMS: Readonly<Record<string, string>> = {
  add: "addi",
  sub: "subi",
  and: "andi",
  or: "ori",
  eor: "eori",
  cmp: "cmpi",
};

/**
 * The instruction a line is encoded as, lower case, from its mnemonic and the
 * addressing modes of its operands. `modes[i]` is undefined for an operand
 * whose mode is not known, such as a macro parameter, and no form is chosen
 * on the strength of one.
 *
 * This is the instruction as written, before assembler optimisations, which
 * may go on to pick a shorter one (vasm turns `add.w #1,d0` into ADDQ):
 *
 * - a condition-code synonym is read as its canonical spelling;
 * - `move`, `add`, `sub` and `cmp` to an address register are MOVEA, ADDA,
 *   SUBA and CMPA, except `move usp,An`;
 * - `cmp (Ay)+,(Ax)+` is CMPM;
 * - `add`, `sub`, `and`, `or` and `cmp` from an immediate are ADDI, SUBI,
 *   ANDI, ORI and CMPI when the destination is not a data register. To a data
 *   register they keep their own encoding, with an immediate source operand.
 *   EOR takes only a data register source, so `eor #n` is always EORI.
 */
export function encodedInstruction(
  name: string,
  modes: readonly (AddressingModeName | undefined)[],
): string {
  const mnemonic = canonicalConditionMnemonic(name);
  const [source, destination] = modes;

  // `move usp,a0` is MOVE USP, not MOVEA.
  if (destination === "an" && source !== "usp")
    return ADDRESS_FORMS[mnemonic] ?? mnemonic;

  if (
    mnemonic === "cmp" &&
    source === "anPostInc" &&
    destination === "anPostInc"
  )
    return "cmpm";

  const immediate = IMMEDIATE_FORMS[mnemonic];
  if (
    immediate &&
    source === "imm" &&
    (mnemonic === "eor" || (destination !== undefined && destination !== "dn"))
  )
    return immediate;

  return mnemonic;
}
