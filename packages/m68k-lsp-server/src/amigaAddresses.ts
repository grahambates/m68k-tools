import {
  evaluateConstant,
  type ExpressionNode,
  type ParsedFile,
  type ParsedLine,
} from "m68k-parser";
import {
  CUSTOM_BASE,
  ciaRegisterAt,
  customRegisterAt,
  type CustomRegister,
} from "@m68k-lsp/platforms";
import type { AddressResolver } from "./addressOperands";
import {
  ciaBitDocs,
  ciaSymbolDocs,
  ciaWriteDocs,
  type CiaOperand,
} from "./amigaCia";
import {
  amigaHardwareDocs,
  namedRegisterOperand,
  registerWriteDocs,
} from "./amigaHardware";
import { inCopperList } from "./amigaCopper";

type Operand = NonNullable<ParsedLine["operands"]>[number];

/** An Amiga hardware register an operand refers to by its address alone. */
export type AddressedRegister =
  | { kind: "custom"; register: CustomRegister }
  | { kind: "cia"; operand: CiaOperand };

/** The hardware register at an address: `$dff096`, or `$bfe001`. */
export function amigaRegisterAt(
  address: number | undefined,
): AddressedRegister | undefined {
  if (address === undefined) return undefined;
  const custom = customRegisterAt(address >>> 0);
  if (custom) return { kind: "custom", register: custom };
  const cia = ciaRegisterAt(address);
  return cia && { kind: "cia", operand: cia };
}

/** The register an operand refers to by address, where it is one. */
export function addressedRegister(
  addresses: AddressResolver,
  lineIndex: number,
  operand: Operand,
): AddressedRegister | undefined {
  return amigaRegisterAt(addresses.operandAddress(lineIndex, operand));
}

/** Documentation for a register referred to by its address. */
export function addressedRegisterDocs(
  register: AddressedRegister,
): string | undefined {
  if (register.kind === "custom")
    return amigaHardwareDocs(register.register.name, undefined);
  const { register: cia, cia: which } = register.operand;
  return ciaSymbolDocs(`cia${cia.name.toLowerCase()}`, undefined, which);
}

const bitInstructions = new Set(["btst", "bset", "bclr", "bchg"]);

/**
 * What the immediate at `index` does to a register its destination refers to
 * by address: a word moved into a custom register, `move.w #$8200,$dff096`,
 * read against its bits; a byte moved into a CIA register; or the bit a bit
 * instruction tests or changes in one, `btst #6,$bfe001`.
 */
export function addressedAccessDocs(
  addresses: AddressResolver,
  lineIndex: number,
  line: ParsedLine,
  index: number,
  evaluate: (expr: ExpressionNode) => number | undefined,
): string | undefined {
  const operands = line.operands ?? [];
  const source = operands[index];
  if (
    index !== 0 ||
    source?.type !== "immediate" ||
    source.value.type === "string-literal" ||
    !operands[1] ||
    line.mnemonic?.type !== "instruction"
  )
    return undefined;
  const value = evaluate(source.value as ExpressionNode);
  if (value === undefined) return undefined;
  const register = addressedRegister(addresses, lineIndex, operands[1]);
  if (!register) return undefined;
  const mnemonic = line.mnemonic.instruction.toLowerCase();
  const size =
    line.qualifier?.type === "size"
      ? line.qualifier.size.toLowerCase()
      : undefined;

  if (register.kind === "custom")
    return mnemonic === "move" && (size ?? "w") === "w"
      ? registerWriteDocs(register.register.name, undefined, value)
      : undefined;
  if (bitInstructions.has(mnemonic)) return ciaBitDocs(register.operand, value);
  if (mnemonic === "move" && size === "b")
    return ciaWriteDocs(register.operand, value);
  return undefined;
}

/** A value written to a custom register an operand gives by address. */
export interface AddressedWrite {
  /** The register, as the Hardware Reference Manual names it. */
  name: string;
  value: ExpressionNode;
}

/**
 * The write the operand at `index` provides the value for, where the
 * register is given by address rather than name: the immediate of
 * `move.w #$0f80,$180(a6)`, an address-based feature; or the value of a
 * Copper MOVE written as numbers, `dc.w $0180,$0f80`, in a Copper list, which
 * is recognised by its own evidence, as for its hover.
 */
export function addressedWrite(
  addresses: AddressResolver,
  parsed: ParsedFile,
  lineIndex: number,
  index: number,
  lookup: (name: string) => number | undefined,
  kinds: { moves: boolean; copper: boolean },
): AddressedWrite | undefined {
  const line = parsed.lines[lineIndex];
  const operands = line?.operands ?? [];
  const operand = operands[index];
  const size =
    line?.qualifier?.type === "size" ? line.qualifier.size.toLowerCase() : "w";
  if (!operand || size !== "w") return undefined;

  if (
    kinds.moves &&
    line.mnemonic?.type === "instruction" &&
    line.mnemonic.instruction.toLowerCase() === "move" &&
    index === 0 &&
    operand.type === "immediate" &&
    operand.value.type !== "string-literal" &&
    operands[1] &&
    !namedRegisterOperand(operands[1])
  ) {
    const register = addressedRegister(addresses, lineIndex, operands[1]);
    return register?.kind === "custom"
      ? { name: register.register.name, value: operand.value as ExpressionNode }
      : undefined;
  }

  if (
    kinds.copper &&
    line.mnemonic?.type === "directive" &&
    line.mnemonic.directive.toLowerCase() === "dc" &&
    index % 2 === 1 &&
    operand.type === "value"
  ) {
    const previous = operands[index - 1];
    if (previous?.type !== "value" || previous.value.type === "symbol")
      return undefined;
    const result = evaluateConstant(previous.value, lookup);
    if (!result.known || result.value & 1) return undefined;
    const register = customRegisterAt(CUSTOM_BASE + (result.value & 0x1fe));
    return register && inCopperList(parsed, lineIndex, lookup)
      ? { name: register.name, value: operand.value }
      : undefined;
  }
  return undefined;
}
