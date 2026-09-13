import {
  Mnemonics,
  mnemonicGroups,
  type Mnemonic,
  AddressingModes,
  type AddressingMode,
  Qualifiers,
} from "../syntax";
import { type InstructionStatement } from "../parse/nodes";

const bitOps: Mnemonic[] = [
  Mnemonics.BCHG,
  Mnemonics.BCLR,
  Mnemonics.BSET,
  Mnemonics.BTST,
];
const branchOps: Mnemonic[] = [
  Mnemonics.BRA,
  Mnemonics.BSR,
  ...mnemonicGroups.BCC,
];
// Instructions whose immediate operand is embedded in the opcode word (no
// extra extension word): the 68000 quick forms plus 68020 BKPT.
const quick: Mnemonic[] = [
  Mnemonics.MOVEQ,
  Mnemonics.ADDQ,
  Mnemonics.SUBQ,
  Mnemonics.BKPT,
];
const doubles: Mnemonic[] = [
  ...mnemonicGroups.DBCC,
  Mnemonics.LINK,
  Mnemonics.MOVEM,
  Mnemonics.MOVEP,
  Mnemonics.STOP,
  // movec is always two words; its control-register operand is not an absolute
  Mnemonics.MOVEC,
];

// 68020 instructions with a mandatory extension word beyond the opcode
// (bit-field instructions carry an {offset:width} extension word).
const extensionWord: Mnemonic[] = [
  Mnemonics.CHK2,
  Mnemonics.CMP2,
  Mnemonics.CAS,
  Mnemonics.MOVES,
  Mnemonics.BFCHG,
  Mnemonics.BFCLR,
  Mnemonics.BFEXTS,
  Mnemonics.BFEXTU,
  Mnemonics.BFFFO,
  Mnemonics.BFINS,
  Mnemonics.BFSET,
  Mnemonics.BFTST,
];

const dispTypes: AddressingMode[] = [
  AddressingModes.AnDisp,
  AddressingModes.AnDispIx,
  AddressingModes.PcDisp,
  AddressingModes.PcDispIx,
  // 68020 memory indirect: counts the mandatory extension word only; any
  // 16/32-bit base/outer displacements are not yet added (the parsed operand
  // detail isn't carried through to sizing).
  AddressingModes.MemIndir,
];

/**
 * Get byte size of instruction statement
 */
export default function instructionSize({
  opcode: { op, qualifier },
  operands,
}: InstructionStatement): number {
  // Bcc.W is 2 words
  if (branchOps.includes(op.name)) {
    return qualifier && qualifier.name === Qualifiers.B ? 2 : 4;
  }
  // These instructions are always 2 words
  if (doubles.includes(op.name)) {
    return 4;
  }
  // Unary instructions are always 1 word
  if (!operands.length) {
    return 2;
  }

  let words = 1;

  // Mandatory extension word (CHK2/CMP2/CAS)
  if (extensionWord.includes(op.name)) {
    words += 1;
  }

  for (const { mode } of operands) {
    // Absolute value:
    if (mode === AddressingModes.AbsW) {
      words += 1;
    } else if (mode === AddressingModes.AbsL) {
      words += 2;
    }
    // Displacement
    else if (dispTypes.includes(mode)) {
      words += 1;
    }
    // Immediate value:
    else if (
      mode === AddressingModes.Imm &&
      !quick.includes(op.name) &&
      !mnemonicGroups.SHIFT.includes(op.name)
    ) {
      if (bitOps.includes(op.name)) {
        words += 1;
      } else {
        words += qualifier && qualifier.name === Qualifiers.L ? 2 : 1;
      }
    }
  }

  return words * 2;
}
