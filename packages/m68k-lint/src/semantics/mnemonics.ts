import type { ParsedLine } from "m68k-parser";

/** Canonicalise source-level assembler aliases which are unconditionally equivalent. */
export function canonicalMnemonicName(name: string): string {
  let mnemonic = name.toLowerCase();

  const immediateAliases: Record<string, string> = {
    addi: "add",
    subi: "sub",
    cmpi: "cmp",
    andi: "and",
    ori: "or",
    eori: "eor",
  };
  mnemonic = immediateAliases[mnemonic] ?? mnemonic;

  if (mnemonic === "dbra") return "dbf";

  // Condition-code synonyms: HS == CC, LO == CS. Apply consistently to
  // Bcc, DBcc and Scc spellings without touching unrelated B*/S* opcodes.
  for (const prefix of ["db", "b", "s"] as const) {
    if (!mnemonic.startsWith(prefix)) continue;
    const cc = mnemonic.slice(prefix.length);
    if (cc === "hs") return `${prefix}cc`;
    if (cc === "lo") return `${prefix}cs`;
  }

  return mnemonic;
}

/** Canonical source spelling, before operand-sensitive instruction selection. */
export function canonicalMnemonic(line: ParsedLine): string | undefined {
  return line.mnemonic?.type === "instruction"
    ? canonicalMnemonicName(line.mnemonic.instruction)
    : undefined;
}

function hasAddressRegisterDestination(line: ParsedLine): boolean {
  return line.operands?.[1]?.type === "address-register";
}

/**
 * Resolve the semantic instruction selected by mnemonic + operands.
 *
 * Many assemblers accept generic spellings such as `move.l d0,a0` or
 * `add.l #4,a0`; those encode/behave as MOVEA/ADDA respectively.  Analysis
 * and most lint matching should use this form so CCR/register semantics do
 * not depend on how the source happened to spell the instruction.
 */
export function semanticMnemonic(line: ParsedLine): string | undefined {
  const mnemonic = canonicalMnemonic(line);
  if (!mnemonic) return undefined;

  if (hasAddressRegisterDestination(line)) {
    if (mnemonic === "move") return "movea";
    if (mnemonic === "add") return "adda";
    if (mnemonic === "sub") return "suba";
    if (mnemonic === "cmp") return "cmpa";
  }

  return mnemonic;
}

/** Broader operation family for rules intentionally valid across data/address forms. */
export function instructionFamilyName(name: string): string {
  const mnemonic = canonicalMnemonicName(name);
  const families: Record<string, string> = {
    adda: "add",
    suba: "sub",
    cmpa: "cmp",
    movea: "move",
  };
  return families[mnemonic] ?? mnemonic;
}

export function instructionFamily(line: ParsedLine): string | undefined {
  const mnemonic = semanticMnemonic(line);
  return mnemonic ? instructionFamilyName(mnemonic) : undefined;
}
