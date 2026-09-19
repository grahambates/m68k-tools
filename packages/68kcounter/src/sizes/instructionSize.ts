import { parseLine } from "m68k-parser";
import type { Variables } from "../parse/evaluate";
import { fullFormat } from "../timings/ea68030";
import {
  Mnemonics,
  mnemonicGroups,
  type Mnemonic,
  AddressingModes,
  type AddressingMode,
  Qualifiers,
} from "../syntax";
import { type InstructionStatement } from "../parse/nodes";

const longArithmetic: Mnemonic[] = [
  Mnemonics.MULS,
  Mnemonics.MULU,
  Mnemonics.DIVS,
  Mnemonics.DIVU,
];

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
// extra extension word): the 68000 quick forms, TRAP's vector, and 68020 BKPT.
const quick: Mnemonic[] = [
  Mnemonics.MOVEQ,
  Mnemonics.ADDQ,
  Mnemonics.SUBQ,
  Mnemonics.TRAP,
  Mnemonics.BKPT,
];
const doubles: Mnemonic[] = [
  ...mnemonicGroups.DBCC,
  Mnemonics.MOVEP,
  Mnemonics.STOP,
  // movec is always two words; its control-register operand is not an absolute
  Mnemonics.MOVEC,
];

// 68020 instructions with a mandatory extension word beyond the opcode
// (bit-field instructions carry an {offset:width} extension word).
const extensionWord: Mnemonic[] = [
  Mnemonics.MOVEM,
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
  // Full-format displacement words are counted from the parsed operand.
  AddressingModes.MemIndir,
];

/**
 * Get byte size of instruction statement
 */
export default function instructionSize(
  { opcode: { op, qualifier }, operands }: InstructionStatement,
  vars: Variables = {},
): number {
  // Bcc.W is 2 words
  if (branchOps.includes(op.name)) {
    return qualifier?.name === Qualifiers.B
      ? 2
      : qualifier?.name === Qualifiers.L
        ? 6
        : 4;
  }
  if (op.name === Mnemonics.LINK)
    return qualifier?.name === Qualifiers.L ? 6 : 4;
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
  if (
    extensionWord.includes(op.name) ||
    (qualifier?.name === Qualifiers.L && longArithmetic.includes(op.name))
  ) {
    words += 1;
  }

  const parsed = parseLine(
    ` ${op.text}${qualifier ? "." + qualifier.text : ""} ${operands.map((o) => o.text).join(",")}`,
  );
  for (const [index, { mode }] of operands.entries()) {
    // Absolute value:
    if (mode === AddressingModes.AbsW) {
      words += 1;
    } else if (mode === AddressingModes.AbsL) {
      words += 2;
    }
    // Displacement
    else if (dispTypes.includes(mode)) {
      const node = parsed.value.operands?.[index];
      const form =
        node && !parsed.errors.length ? fullFormat(node, vars) : undefined;
      if (form === "word") words += 2;
      else if (form === "long") words += 3;
      else if (form?.startsWith("indirect")) {
        // Full extension word plus encoded base and outer displacements.
        const widths = form
          .replace("indirectPostWord", "16_")
          .replace("indirectWord", "16_")
          .replace("indirect", "")
          .split("_")
          .map(Number);
        words += 1 + widths.reduce((sum, width) => sum + width / 16, 0);
      } else words += 1;
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
