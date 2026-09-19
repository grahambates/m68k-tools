export type RegisterName = "pc" | "sr" | "ccr" | "usp" | "vbr";

export type AddressingMode =
  | "dn"
  | "an"
  | "anIndirect"
  | "anPostInc"
  | "anPreDec"
  | "anOffset"
  | "anIdx"
  | "absW"
  | "absL"
  | "pcOffset"
  | "pcIdx"
  | "imm";

export const registerNames: RegisterName[] = ["pc", "sr", "ccr", "usp", "vbr"]; // exclude sp

export const cpuTypes = [
  "68000",
  "68010",
  "68020",
  "68030",
  "68040",
  "68060",
  "68851",
  "68881",
  "68882",
  "cpu32",
];

/**
 * Directives that control assembly flow rather than emitting data.
 *
 * m68k-parser classifies all of these as directives, but the formatter offers
 * a separate case option for them (`m68k.format.case.control`), so the
 * distinction is kept here. Mirrors `control_mnemonic` in the tree-sitter
 * grammar.
 */
export const controlMnemonics = new Set([
  // Conditional assembly
  "if",
  "ifeq",
  "ifne",
  "ifgt",
  "ifge",
  "iflt",
  "ifle",
  "ifb",
  "ifnb",
  "if1",
  "if2",
  "ifp1",
  "ifc",
  "ifnc",
  "ifd",
  "ifnd",
  "ifmacrod",
  "ifmacrond",
  "iif",
  "else",
  "elseif",
  "endif",
  "endc",
  // Blocks
  "macro",
  "endm",
  "rem",
  "erem",
  "rept",
  "endr",
  "end",
]);
