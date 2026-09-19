import { addressingMode, parseLine } from "m68k-parser";
import type { AddressingModeName, OperandNode } from "m68k-parser";
import { type AddressingMode, AddressingModes } from "../syntax";

/** How the parser's mode names read in our timing and size tables. */
const modes: Record<AddressingModeName, AddressingMode> = {
  dn: AddressingModes.Dn,
  an: AddressingModes.An,
  anIndirect: AddressingModes.AnIndir,
  anPostInc: AddressingModes.AnPostInc,
  anPreDec: AddressingModes.AnPreDec,
  anOffset: AddressingModes.AnDisp,
  anIdx: AddressingModes.AnDispIx,
  pcOffset: AddressingModes.PcDisp,
  pcIdx: AddressingModes.PcDispIx,
  absW: AddressingModes.AbsW,
  absL: AddressingModes.AbsL,
  imm: AddressingModes.Imm,
  memIndirect: AddressingModes.MemIndir,
  regList: AddressingModes.RegList,
  ccr: AddressingModes.CCR,
  sr: AddressingModes.SR,
  usp: AddressingModes.USP,
};

/**
 * Map a parsed m68k-parser operand node to our internal AddressingMode.
 *
 * Modes that don't have an equivalent in our timing/size tables fall back to
 * absolute long so that lookups miss gracefully rather than throwing.
 */
export function nodeAddressingMode(node: OperandNode): AddressingMode {
  switch (node.type) {
    case "bitfield":
      // The mode is that of the effective address the bitfield applies to
      // (e.g. `d0` in `d0{4:8}`); on its own it defaults to a data register.
      return node.base ? nodeAddressingMode(node.base) : AddressingModes.Dn;
    case "register-pair":
      // 64-bit mul/div result pairs and cas2 register pairs behave, for timing
      // purposes, like a data register operand.
      return AddressingModes.Dn;
    default: {
      const mode = addressingMode(node);
      return mode ? modes[mode] : AddressingModes.AbsL;
    }
  }
}

/**
 * Look up addressing mode of an operand string.
 *
 * Parses the operand in isolation using m68k-parser. A `movem` carrier
 * mnemonic is used so that register lists are recognised in context.
 */
export default function operandMode(operand: string): AddressingMode {
  const { value } = parseLine("\tmovem " + operand);
  const node = value.operands && value.operands[0];
  return node ? nodeAddressingMode(node) : AddressingModes.AbsL;
}
