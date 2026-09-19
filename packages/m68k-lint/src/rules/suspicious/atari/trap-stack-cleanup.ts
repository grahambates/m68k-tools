import type { ParsedLine } from "m68k-parser";
import type { RuleContext } from "../../../core/context.js";
import type { Rule } from "../../../core/rule.js";
import { isReturn } from "../../../semantics/flags.js";
import { semanticMnemonic } from "../../../semantics/mnemonics.js";
import { isStackPointerRegister } from "../../../semantics/registers.js";
import {
  immediateExpressionOperand,
  instructionSize,
  operand,
  predecrementAddressRegister,
} from "../../../util/ast.js";

/**
 * GEMDOS, BIOS and XBIOS take their parameters on the stack and leave them
 * there: the caller removes them. TRAP #2 is excluded because GEM passes a
 * parameter block in registers instead, so there is nothing to clean up.
 */
const STACK_TRAPS = new Map<number, string>([
  [1, "GEMDOS"],
  [13, "BIOS"],
  [14, "XBIOS"],
]);

/**
 * GEMDOS calls that never return, so their parameters are never removed. The
 * opcodes have been stable since TOS 1.0.
 */
const NON_RETURNING_GEMDOS = new Map<number, string>([
  [0x00, "Pterm0"],
  [0x31, "Ptermres"],
  [0x4c, "Pterm"],
]);

function isStackPointer(line: ParsedLine, index: number): boolean {
  const register = predecrementAddressRegister(line, index);
  return !!register && isStackPointerRegister(register.register);
}

/** Bytes a single instruction pushes, or undefined when it is not a plain push. */
function pushedBytes(line: ParsedLine): number | undefined {
  const mnemonic = semanticMnemonic(line);
  if (mnemonic === "pea") return 4;
  if (mnemonic !== "move" && mnemonic !== "clr") return undefined;

  const destination = mnemonic === "clr" ? 0 : 1;
  if (!isStackPointer(line, destination)) return undefined;

  switch (instructionSize(line)) {
    // A7 is special-cased: a byte push still moves the stack pointer by two so
    // it stays word-aligned.
    case "b":
    case "w":
      return 2;
    case "l":
      return 4;
    default:
      return undefined;
  }
}

function isStackPointerOperand(line: ParsedLine, index: number): boolean {
  const op = operand(line, index);
  return op?.type === "address-register" && isStackPointerRegister(op.register);
}

/** Bytes a single instruction removes from the stack, or undefined. */
function releasedBytes(ctx: RuleContext, line: ParsedLine): number | undefined {
  const mnemonic = semanticMnemonic(line);

  // ADDQ keeps its own mnemonic; ADD with an address-register destination
  // normalizes to ADDA. Stack cleanup is written both ways.
  if (mnemonic === "add" || mnemonic === "adda" || mnemonic === "addq") {
    if (!isStackPointerOperand(line, 1)) return undefined;
    const expr = immediateExpressionOperand(line, 0);
    if (!expr) return undefined;
    const value = ctx.evaluate(expr);
    return value.known && value.value > 0 ? value.value : undefined;
  }

  // LEA n(sp),sp is the usual way to drop more than eight bytes.
  if (mnemonic === "lea") {
    if (!isStackPointerOperand(line, 1)) return undefined;
    const source = operand(line, 0);
    if (source?.type !== "address-register-indirect-displacement")
      return undefined;
    if (source.register.type !== "address-register") return undefined;
    if (!isStackPointerRegister(source.register.register)) return undefined;
    const value = ctx.evaluate(source.displacement);
    return value.known && value.value > 0 ? value.value : undefined;
  }

  return undefined;
}

function trapVector(ctx: RuleContext, line: ParsedLine): number | undefined {
  if (semanticMnemonic(line) !== "trap") return undefined;
  const expr = immediateExpressionOperand(line, 0);
  if (!expr) return undefined;
  const value = ctx.evaluate(expr);
  return value.known ? value.value : undefined;
}

export const atariTrapStackCleanup: Rule = {
  meta: {
    id: "suspicious/atari-trap-stack-cleanup",
    category: "suspicious",
    defaultSeverity: "warning",
    platforms: ["atari"],
    description:
      "Check that TOS trap parameters are removed from the stack by the caller",
    tags: ["atari", "tos", "stack", "calling-convention"],
    docs: {
      note: "GEMDOS/BIOS/XBIOS are caller-cleans-stack. Pushes are accumulated across calls and compared against the stack adjustment that follows, because cleanup is often deferred so that one adjustment covers several calls. Needs no table of TOS function signatures, so it does not depend on the TOS version.",
    },
  },

  checkFile(ctx) {
    // Cleanup is commonly deferred: several calls are made and one adjustment
    // removes all of their parameters at once. Tracking a running total handles
    // that, where comparing each call against the next instruction would report
    // every call but the last.
    let outstanding = 0;
    let pushedRun = 0;
    let opcodeWord: number | undefined;
    let lastTrap: { index: number; api: string } | undefined;

    const report = (released: number | undefined) => {
      if (!lastTrap || outstanding === 0) return;
      const trapLine = ctx.line(lastTrap.index);
      if (!trapLine?.mnemonic) return;
      const detail =
        released === undefined
          ? "nothing is removed afterwards"
          : `${released} ${released === 1 ? "byte is" : "bytes are"} removed afterwards`;

      ctx.report({
        ruleId: "suspicious/atari-trap-stack-cleanup",
        category: "suspicious",
        severity: "warning",
        confidence: released === undefined ? "medium" : "high",
        message: `${outstanding} bytes are pushed for this ${lastTrap.api} call but ${detail}`,
        loc: trapLine.mnemonic.loc,
        notes: [
          {
            message: `${lastTrap.api} takes its parameters on the stack and the caller removes them.`,
          },
          {
            message:
              "Suppress this inline if the call does not return, or if the stack is unwound elsewhere, for example by restoring a saved stack pointer.",
          },
        ],
        suggestion: {
          description: `Remove ${outstanding} bytes, e.g. ${outstanding <= 8 ? `addq.l #${outstanding},sp` : `lea ${outstanding}(sp),sp`}`,
          applicability: "manual",
        },
        data: {
          pushedBytes: outstanding,
          releasedBytes: released,
          trapIndex: lastTrap.index,
        },
      });
    };

    const reset = () => {
      outstanding = 0;
      pushedRun = 0;
      opcodeWord = undefined;
      lastTrap = undefined;
    };

    ctx.file.lines.forEach((line, index) => {
      if (line.mnemonic?.type !== "instruction") return;
      const mnemonic = semanticMnemonic(line);
      if (!mnemonic) return;

      if (isReturn(line)) {
        report(undefined);
        reset();
        return;
      }
      // A label means control can arrive without passing the calls seen so far,
      // so start again rather than blame whichever call happened to come first.
      if (line.label) reset();

      const pushes = pushedBytes(line);
      if (pushes !== undefined) {
        pushedRun += pushes;
        // The word pushed last before a trap is the function opcode.
        if (pushes === 2) {
          const immediate = immediateExpressionOperand(line, 0);
          const value = immediate ? ctx.evaluate(immediate) : undefined;
          opcodeWord = value?.known ? value.value : undefined;
        }
        return;
      }

      const released = releasedBytes(ctx, line);
      if (released !== undefined) {
        if (outstanding !== 0 && released !== outstanding) report(released);
        reset();
        return;
      }

      const vector = trapVector(ctx, line);
      const api = vector === undefined ? undefined : STACK_TRAPS.get(vector);
      if (api) {
        const nonReturning =
          vector === 1 &&
          opcodeWord !== undefined &&
          NON_RETURNING_GEMDOS.has(opcodeWord);
        if (!nonReturning && pushedRun > 0) {
          outstanding += pushedRun;
          lastTrap = { index, api };
        }
        pushedRun = 0;
        opcodeWord = undefined;
        return;
      }

      pushedRun = 0;
      opcodeWord = undefined;
    });

    report(undefined);
  },
};
