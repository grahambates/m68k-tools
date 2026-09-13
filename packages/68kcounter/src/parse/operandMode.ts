import { parseLine } from "m68k-parser";
import type { OperandNode } from "m68k-parser";
import { type AddressingMode, AddressingModes } from "../syntax";

/**
 * Map a parsed m68k-parser operand node to our internal AddressingMode.
 *
 * Modes that don't have an equivalent in our timing/size tables fall back to
 * absolute long so that lookups miss gracefully rather than throwing.
 */
export function nodeAddressingMode(node: OperandNode): AddressingMode {
  switch (node.type) {
    case "data-register":
      return AddressingModes.Dn;
    case "address-register":
      return AddressingModes.An;
    case "special-register":
      switch (node.register) {
        case "ccr":
          return AddressingModes.CCR;
        case "sr":
          return AddressingModes.SR;
        case "usp":
          return AddressingModes.USP;
        default:
          return AddressingModes.AbsL;
      }
    case "address-register-indirect":
      return AddressingModes.AnIndir;
    case "address-register-indirect-postinc":
      return AddressingModes.AnPostInc;
    case "address-register-indirect-predec":
      return AddressingModes.AnPreDec;
    case "address-register-indirect-displacement":
      return AddressingModes.AnDisp;
    case "address-register-indirect-index":
      return AddressingModes.AnDispIx;
    case "pc-relative":
      return AddressingModes.PcDisp;
    case "pc-relative-index":
      return AddressingModes.PcDispIx;
    case "absolute-address":
      return node.addressSize &&
        "size" in node.addressSize &&
        node.addressSize.size === "w"
        ? AddressingModes.AbsW
        : AddressingModes.AbsL;
    case "immediate":
      return AddressingModes.Imm;
    case "register-list":
      return AddressingModes.RegList;
    case "memory-indirect":
      return AddressingModes.MemIndir;
    case "bitfield":
      // The mode is that of the effective address the bitfield applies to
      // (e.g. `d0` in `d0{4:8}`); on its own it defaults to a data register.
      return node.base ? nodeAddressingMode(node.base) : AddressingModes.Dn;
    case "register-pair":
      // 64-bit mul/div result pairs and cas2 register pairs behave, for timing
      // purposes, like a data register operand.
      return AddressingModes.Dn;
    default:
      return AddressingModes.AbsL;
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
