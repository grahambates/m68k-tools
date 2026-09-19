import type { OperandNode } from "./types.js";

/**
 * The addressing mode an operand is written in.
 *
 * Named as the 68000 programmer's reference does. The general modes are `dn`
 * through `imm`; the rest are operands that only some instructions take.
 */
export type AddressingModeName =
  | "dn"
  | "an"
  | "anIndirect"
  | "anPostInc"
  | "anPreDec"
  | "anOffset"
  | "anIdx"
  | "pcOffset"
  | "pcIdx"
  | "absW"
  | "absL"
  | "imm"
  /** 68020 memory indirect: `([bd,An,Xn],od)`. */
  | "memIndirect"
  /** A register list, as MOVEM takes. */
  | "regList"
  | "ccr"
  | "sr"
  | "usp";

/**
 * The addressing mode of a parsed operand, or undefined for one that is not an
 * effective address or a register operand of this kind: a string, a floating
 * point register, a value in a directive, or a special register with no mode
 * of its own.
 *
 * A bitfield or a register pair has no mode of its own either; what to make of
 * one depends on the question being asked, so that is left to the caller.
 *
 * An absolute address is short only when written so: `(addr).w`.
 */
export function addressingMode(
  operand: OperandNode,
): AddressingModeName | undefined {
  switch (operand.type) {
    case "data-register":
      return "dn";
    case "address-register":
      return "an";
    case "address-register-indirect":
      return "anIndirect";
    case "address-register-indirect-postinc":
      return "anPostInc";
    case "address-register-indirect-predec":
      return "anPreDec";
    case "address-register-indirect-displacement":
      return "anOffset";
    case "address-register-indirect-index":
      return "anIdx";
    case "pc-relative":
      return "pcOffset";
    case "pc-relative-index":
      return "pcIdx";
    case "absolute-address":
      return operand.addressSize &&
        "size" in operand.addressSize &&
        operand.addressSize.size === "w"
        ? "absW"
        : "absL";
    case "immediate":
      return "imm";
    case "memory-indirect":
      return "memIndirect";
    case "register-list":
      return "regList";
    case "special-register":
      switch (operand.register) {
        case "ccr":
          return "ccr";
        case "sr":
          return "sr";
        case "usp":
          return "usp";
        default:
          return undefined;
      }
    default:
      return undefined;
  }
}
