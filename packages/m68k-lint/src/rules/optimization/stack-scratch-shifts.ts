import type { Rule } from "../../core/rule.js";
import type { RuleContext } from "../../core/context.js";
import {
  dataRegisterOperand,
  immediateExpressionOperand,
  instructionSize,
  isInstruction,
} from "../../util/ast.js";
import { canonicalMnemonic } from "../../semantics/mnemonics.js";
import { changedFlagsApplicability } from "./helpers.js";

function m68000Only(ctx: RuleContext): boolean {
  return ctx.config.processors.every((cpu) => cpu === "mc68000");
}

function hasInterveningLabel(
  ctx: RuleContext,
  from: number,
  to: number,
): boolean {
  for (let i = from + 1; i <= to; i++) if (ctx.line(i)?.label) return true;
  return false;
}

function precedingMoveq(
  ctx: RuleContext,
  index: number,
  register: string,
  count: number,
) {
  const previous = ctx.previousInstruction(index);
  if (
    !previous ||
    hasInterveningLabel(ctx, previous.index, index) ||
    !isInstruction(previous.line, "moveq")
  )
    return undefined;
  const expr = immediateExpressionOperand(previous.line, 0);
  const dst = dataRegisterOperand(previous.line, 1);
  if (!expr || !dst || dst.register.toLowerCase() !== register)
    return undefined;
  const value = ctx.evaluate(expr);
  if (!value.known || value.value !== count) return undefined;
  return previous;
}

function canRemoveCountSetup(
  ctx: RuleContext,
  setupIndex: number,
  shiftIndex: number,
  register: string,
  count: number,
): boolean {
  if (ctx.registers.isLiveAfter(shiftIndex, register) === "dead") return true;
  return ctx.registers.knownConstantBefore(setupIndex, register) === count;
}

/**
 * The CLR.B in these sequences zeroes the half of the word that came back from
 * the stack slot rather than from the register: `move.b dN,-(sp)` writes only
 * the high byte of the word it reserves, so the low byte is whatever was in
 * that slot before.
 *
 * Zeroing the slot once therefore removes the CLR.B from every shift after it.
 * Not offered as a rewrite, because nothing here can prove what is in memory
 * below SP -- and an interrupt or exception pushes its frame exactly there, so
 * a zero left below SP survives only while nothing interrupts. That makes it a
 * technique for a person who knows their interrupt state, not a substitution.
 */
const CLEARS_STACK_BYTE = "clr.b";

function stackNotes(
  flagSafe: boolean,
  countNote?: string,
  replacement?: string,
) {
  return [
    ...(countNote ? [{ message: countNote }] : []),
    ...(replacement?.includes(CLEARS_STACK_BYTE)
      ? [
          {
            message:
              "The CLR.B only clears what came back from the stack slot, so it can be dropped where that slot is already zero. Zeroing it once serves any number of these shifts, provided nothing between them can push a frame below SP.",
          },
        ]
      : []),
    {
      message:
        "The replacement uses 2 bytes of stack and restores SP exactly, but a register shift needs no stack at all: SP must already point at writable memory here.",
    },
    ...(flagSafe
      ? []
      : [
          {
            message:
              "CCR results differ from the original shift; changed flags must be unobserved.",
          },
        ]),
  ];
}

/** Immediate word shifts using the 68000 A7 byte-alignment behaviour. */
export const stackAlignedWordShiftByEight: Rule = {
  meta: {
    id: "optimization/stack-word-shift-eight",
    category: "optimization",
    defaultSeverity: "suggestion",
    description:
      "Use the 68000 A7 byte-alignment quirk for a word shift by eight",
    tags: ["flamewing", "68000", "shift", "stack", "ccr"],
    serves: "speed",
    docs: {
      source:
        "Flamewing M68000 Peephole Optimizations / 68000 Tricks and Traps",
      note: "Uses two temporary stack bytes and restores SP exactly.",
    },
  },
  checkLine(ctx, line, index) {
    if (!m68000Only(ctx)) return;
    const mnemonic = canonicalMnemonic(line);
    if (
      mnemonic !== "lsl" &&
      mnemonic !== "asl" &&
      mnemonic !== "lsr" &&
      mnemonic !== "asr"
    )
      return;
    if (instructionSize(line) !== "w") return;

    const count = immediateExpressionOperand(line, 0);
    const dst = dataRegisterOperand(line, 1);
    if (!count || !dst) return;
    const value = ctx.evaluate(count);
    if (!value.known || value.value !== 8) return;

    const reg = dst.register;
    let replacement: string;
    if (mnemonic === "lsr") {
      replacement = `move.w ${reg},-(sp)\nclr.w ${reg}\nmove.b (sp)+,${reg}`;
    } else if (mnemonic === "asr") {
      replacement = `move.w ${reg},-(sp)\nmove.b (sp)+,${reg}\next.w ${reg}`;
    } else {
      replacement = `move.b ${reg},-(sp)\nmove.w (sp)+,${reg}\nclr.b ${reg}`;
    }

    const safety = changedFlagsApplicability(ctx, index, [
      "X",
      "N",
      "Z",
      "V",
      "C",
    ]);
    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence: safety.confidence,
      message: `${mnemonic.toUpperCase()}.W #8,${reg.toUpperCase()} can use the 68000 stack-alignment byte-lane trick`,
      loc: line.mnemonic!.loc,
      suggestion: {
        description:
          "Use A7's two-byte byte-stack adjustment to move the surviving byte into place",
        replacement,
        // Stack memory traffic is an observable side effect, but SP scratch itself is allowed.
        applicability:
          safety.applicability === "safe"
            ? "conditional"
            : safety.applicability,
      },
      notes: stackNotes(
        safety.applicability === "safe",
        undefined,
        replacement,
      ),
      data: {
        provenance: "flamewing",
        stackScratch: true,
        temporaryStackBytes: 2,
        netStackBytes: 0,
        stackPointerRestored: true,
        writesStackMemory: true,
        shiftCount: 8,
      },
    });
  },
};

/**
 * Register-count variants where Flamewing's best 68000 sequence uses the same
 * two-byte A7 scratch trick.  The preceding MOVEQ is only removed when its
 * architectural value is disposable, exactly as for the non-stack rules.
 */
export const stackAlignedKnownRegisterShifts: Rule = {
  meta: {
    id: "optimization/stack-known-register-shift",
    category: "optimization",
    defaultSeverity: "suggestion",
    description:
      "Use bounded A7 scratch space for selected known register-count shifts",
    tags: ["flamewing", "68000", "shift", "register-count", "stack", "ccr"],
    serves: "speed",
    docs: { source: "Flamewing M68000 Peephole Optimizations" },
  },
  checkLine(ctx, line, index) {
    if (!m68000Only(ctx)) return;
    const mnemonic = canonicalMnemonic(line);
    if (
      mnemonic !== "lsl" &&
      mnemonic !== "asl" &&
      mnemonic !== "lsr" &&
      mnemonic !== "asr"
    )
      return;
    const size = instructionSize(line);
    if (size !== "w" && size !== "l") return;
    const countOp = dataRegisterOperand(line, 0);
    const dst = dataRegisterOperand(line, 1);
    if (!countOp || !dst) return;
    const countReg = countOp.register.toLowerCase();
    if (countReg === dst.register.toLowerCase()) return;

    const known = ctx.registers.knownConstantBefore(index, countReg);
    if (known === undefined) return;
    const count = known & 63;
    const setup = precedingMoveq(ctx, index, countReg, known);
    if (
      !setup ||
      !canRemoveCountSetup(ctx, setup.index, index, countReg, known)
    )
      return;

    const reg = dst.register;
    let replacement: string | undefined;
    if (
      size === "w" &&
      (mnemonic === "lsl" || mnemonic === "asl") &&
      count === 9
    ) {
      replacement = `move.b ${reg},-(sp)\nmove.w (sp)+,${reg}\nclr.b ${reg}\nadd.w ${reg},${reg}`;
    } else if (
      size === "l" &&
      (mnemonic === "lsl" || mnemonic === "asl") &&
      count === 24
    ) {
      replacement = `move.b ${reg},-(sp)\nmove.w (sp)+,${reg}\nclr.b ${reg}\nswap ${reg}\nclr.w ${reg}`;
    } else if (
      size === "l" &&
      (mnemonic === "lsl" || mnemonic === "asl") &&
      count === 25
    ) {
      replacement = `move.b ${reg},-(sp)\nmove.w (sp)+,${reg}\nclr.b ${reg}\nadd.w ${reg},${reg}\nswap ${reg}\nclr.w ${reg}`;
    } else if (size === "l" && mnemonic === "lsr" && count === 24) {
      replacement = `swap ${reg}\nmove.w ${reg},-(sp)\nmoveq #0,${reg}\nmove.b (sp)+,${reg}`;
    } else if (size === "l" && mnemonic === "asr" && count === 24) {
      replacement = `swap ${reg}\next.l ${reg}\nmove.w ${reg},-(sp)\nmove.b (sp)+,${reg}\next.w ${reg}`;
    }
    if (!replacement) return;

    const safety = changedFlagsApplicability(ctx, index, [
      "X",
      "N",
      "Z",
      "V",
      "C",
    ]);
    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence: safety.confidence,
      message: `${mnemonic.toUpperCase()}.${size.toUpperCase()} uses known count ${count}; a bounded stack-scratch form is faster on 68000`,
      loc: setup.line.mnemonic!.loc,
      suggestion: {
        description:
          "Replace the MOVEQ count setup and register-count shift with the A7 scratch sequence",
        replacement,
        applicability:
          safety.applicability === "safe"
            ? "conditional"
            : safety.applicability,
      },
      notes: stackNotes(
        safety.applicability === "safe",
        `${countOp.register.toUpperCase()} is dead afterwards or already held the same count before MOVEQ, so the count setup can be removed.`,
        replacement,
      ),
      data: {
        secondInstructionIndex: index,
        provenance: "flamewing",
        stackScratch: true,
        temporaryStackBytes: 2,
        netStackBytes: 0,
        stackPointerRestored: true,
        writesStackMemory: true,
        countRegister: countReg,
        shiftCount: count,
      },
    });
  },
};
