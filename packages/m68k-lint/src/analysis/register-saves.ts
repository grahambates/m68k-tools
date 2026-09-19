import type { ParsedLine } from "m68k-parser";
import {
  normalizeRegister,
  registerOrdinal,
  type Register,
} from "../semantics/registers.js";
import { expansionOf } from "../semantics/macro-expansions.js";
import { semanticMnemonic } from "../semantics/mnemonics.js";
import { instructionSize, operand } from "../util/ast.js";

/**
 * Whether a line pushes registers to the stack or pops them back.
 *
 * `PUSHM` and `POPM` from the Amiga NDK are read as the `movem.l` they stand
 * for, whether or not the file defines them itself; see `prepareMacros`.
 */
export interface StackSave {
  kind: "push" | "pop";
  /** Registers moved, without duplicates, in MOVEM order. A7 is never included. */
  registers: Register[];
  /** Bytes each register occupies on the stack. */
  bytesEach: 2 | 4;
  viaMacro: boolean;
}

function registersOf(op: ReturnType<typeof operand>): Register[] | undefined {
  const names =
    op?.type === "register-list"
      ? op.registers
      : op?.type === "data-register" || op?.type === "address-register"
        ? [op.register]
        : undefined;
  if (!names) return undefined;
  const registers = new Set<Register>();
  for (const name of names) {
    const register = normalizeRegister(name);
    if (!register) return undefined;
    registers.add(register);
  }
  return [...registers].sort((a, b) => registerOrdinal(a) - registerOrdinal(b));
}

function isStack(op: ReturnType<typeof operand>): boolean {
  if (
    op?.type !== "address-register-indirect-predec" &&
    op?.type !== "address-register-indirect-postinc"
  )
    return false;
  return (
    op.register.type === "address-register" &&
    normalizeRegister(op.register.register) === "a7"
  );
}

export function stackSave(line: ParsedLine): StackSave | undefined {
  const mnemonic = line.mnemonic;

  // A macro that expands to exactly one save or restore is one. This covers
  // PUSHM and POPM in both forms, by way of the expansion made for them.
  if (mnemonic?.type === "macro") {
    const expansion = expansionOf(line);
    if (expansion?.length !== 1) return undefined;
    const save = stackSave(expansion[0]);
    return save && { ...save, viaMacro: true };
  }

  if (semanticMnemonic(line) !== "movem") return undefined;
  const size = instructionSize(line);
  if (size !== "l" && size !== "w") return undefined;

  const push =
    isStack(operand(line, 1)) &&
    operand(line, 1)?.type === "address-register-indirect-predec";
  const pop =
    isStack(operand(line, 0)) &&
    operand(line, 0)?.type === "address-register-indirect-postinc";
  if (!push && !pop) return undefined;
  const registers = registersOf(operand(line, push ? 0 : 1));
  if (!registers) return undefined;
  return {
    kind: push ? "push" : "pop",
    registers: registers.filter((r) => r !== "a7"),
    bytesEach: size === "l" ? 4 : 2,
    viaMacro: false,
  };
}
