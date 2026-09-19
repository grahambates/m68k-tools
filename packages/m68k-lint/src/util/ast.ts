import type {
  AddressRegisterNode,
  DataRegisterNode,
  ExpressionNode,
  ImmediateNode,
  OperandNode,
  ParsedLine,
  Size,
} from "m68k-parser";
import { expansionOf } from "../semantics/macro-expansions.js";
import {
  canonicalMnemonicName,
  instructionFamily,
  instructionFamilyName,
  semanticMnemonic,
} from "../semantics/mnemonics.js";

export function isInstruction(line: ParsedLine, mnemonic: string): boolean {
  return semanticMnemonic(line) === canonicalMnemonicName(mnemonic);
}

/** Match a broader semantic family, e.g. ADD/ADDI/ADDA when the rule explicitly supports it. */
export function isInstructionFamily(
  line: ParsedLine,
  mnemonic: string,
): boolean {
  return instructionFamily(line) === instructionFamilyName(mnemonic);
}

export function instructionSize(line: ParsedLine): Size | undefined {
  return line.qualifier?.type === "size" ? line.qualifier.size : undefined;
}

export function operand(
  line: ParsedLine,
  index: number,
): OperandNode | undefined {
  return line.operands?.[index];
}

export function immediateOperand(
  line: ParsedLine,
  index: number,
): ImmediateNode | undefined {
  const value = operand(line, index);
  return value?.type === "immediate" ? value : undefined;
}

export function dataRegisterOperand(
  line: ParsedLine,
  index: number,
): DataRegisterNode | undefined {
  const value = operand(line, index);
  return value?.type === "data-register" ? value : undefined;
}

export function addressRegisterOperand(
  line: ParsedLine,
  index: number,
): AddressRegisterNode | undefined {
  const value = operand(line, index);
  return value?.type === "address-register" ? value : undefined;
}

export function immediateExpressionOperand(
  line: ParsedLine,
  index: number,
): ExpressionNode | undefined {
  const immediate = immediateOperand(line, index);
  if (!immediate || immediate.value.type === "string-literal") return undefined;
  return immediate.value;
}

/** A -(An) operand with a concrete address register, not a symbol/macro placeholder. */
export function predecrementAddressRegister(
  line: ParsedLine,
  index: number,
): AddressRegisterNode | undefined {
  const value = operand(line, index);
  if (value?.type !== "address-register-indirect-predec") return undefined;
  return value.register.type === "address-register"
    ? value.register
    : undefined;
}

/** A (An)+ operand with a concrete address register, not a symbol/macro placeholder. */
export function postincrementAddressRegister(
  line: ParsedLine,
  index: number,
): AddressRegisterNode | undefined {
  const value = operand(line, index);
  if (value?.type !== "address-register-indirect-postinc") return undefined;
  return value.register.type === "address-register"
    ? value.register
    : undefined;
}

export function isAddqDestination(
  value: OperandNode | undefined,
  size?: Size,
): boolean {
  if (!value) return false;

  switch (value.type) {
    case "data-register":
      return true;
    case "address-register":
      return size !== "b";
    case "address-register-indirect":
    case "address-register-indirect-postinc":
    case "address-register-indirect-predec":
    case "address-register-indirect-displacement":
    case "address-register-indirect-index":
    case "memory-indirect":
    case "absolute-address":
      return true;
    default:
      return false;
  }
}

/**
 * A macro invocation: a line whose body we cannot see from here.
 *
 * The assembler expands it into instructions that read and write registers,
 * touch the condition codes, and may branch. None of that is visible at this
 * line, so every analysis has to treat it as opaque rather than as nothing.
 * Before this existed the parser's "macro" mnemonic type fell through every
 * `type === "instruction"` filter, and a macro call was silently modelled as a
 * no-op that reads no registers — which made `dead-register-write` report
 * writes the macro went on to read, and let sequence rules fuse instructions
 * across a call, offering replacements that would have deleted it.
 */
export function isMacroInvocation(line: ParsedLine | undefined): boolean {
  return line?.mnemonic?.type === "macro";
}

/**
 * A macro call whose effect cannot be worked out: no visible definition, or one
 * too involved to expand. Calls that expand to plain instructions are not
 * opaque, and their semantics reflect what they expand to.
 */
export function isOpaqueMacro(line: ParsedLine | undefined): boolean {
  return isMacroInvocation(line) && expansionOf(line) === undefined;
}

/**
 * A line that executes: a real instruction, or a macro invocation standing in
 * for instructions we cannot see. Analyses walk these; anything else (a bare
 * label, a directive, a comment) contributes no control flow.
 */
export function isExecutableLine(line: ParsedLine | undefined): boolean {
  return line?.mnemonic?.type === "instruction" || isMacroInvocation(line);
}
