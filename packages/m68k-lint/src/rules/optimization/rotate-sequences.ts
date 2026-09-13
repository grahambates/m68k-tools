import type { Rule } from "../../core/rule.js";
import type { RuleContext } from "../../core/context.js";
import {
  dataRegisterOperand,
  immediateExpressionOperand,
  instructionSize,
  isInstruction,
} from "../../util/ast.js";
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

function knownMoveqBefore(ctx: RuleContext, index: number) {
  const previous = ctx.previousInstruction(index);
  if (
    !previous ||
    hasInterveningLabel(ctx, previous.index, index) ||
    !isInstruction(previous.line, "moveq")
  )
    return undefined;
  const expr = immediateExpressionOperand(previous.line, 0);
  const dst = dataRegisterOperand(previous.line, 1);
  if (!expr || !dst) return undefined;
  const value = ctx.evaluate(expr);
  if (!value.known) return undefined;
  return {
    ...previous,
    register: dst.register.toLowerCase(),
    count: value.value,
  };
}

function countRegisterCanLoseMoveq(
  ctx: RuleContext,
  moveqIndex: number,
  rotateIndex: number,
  register: string,
  count: number,
): boolean {
  if (ctx.registers.isLiveAfter(rotateIndex, register) === "dead") return true;
  return ctx.registers.knownConstantBefore(moveqIndex, register) === count;
}

/**
 * Flamewing register-count rotate reductions.  These are particularly useful
 * on 68000 because a register-count rotate pays for the whole count at run time.
 */
export const simplifyKnownRegisterRotate: Rule = {
  meta: {
    id: "optimization/known-register-rotate",
    category: "optimization",
    defaultSeverity: "suggestion",
    description:
      "Replace a known register-count rotate with a shorter immediate rotate sequence",
    tags: ["flamewing", "68000", "rotate", "sequence", "ccr"],
    docs: { source: "Flamewing M68000 Peephole Optimizations" },
  },
  checkLine(ctx, line, index) {
    if (!m68000Only(ctx)) return;
    const direction = isInstruction(line, "rol")
      ? "rol"
      : isInstruction(line, "ror")
        ? "ror"
        : undefined;
    if (!direction) return;
    const size = instructionSize(line);
    if (size !== "w" && size !== "l") return;
    const countReg = dataRegisterOperand(line, 0);
    const valueReg = dataRegisterOperand(line, 1);
    if (
      !countReg ||
      !valueReg ||
      countReg.register.toLowerCase() === valueReg.register.toLowerCase()
    )
      return;

    const moveq = knownMoveqBefore(ctx, index);
    if (!moveq || moveq.register !== countReg.register.toLowerCase()) return;
    const count = moveq.count;
    if (
      !countRegisterCanLoseMoveq(ctx, moveq.index, index, moveq.register, count)
    )
      return;

    const opposite = direction === "rol" ? "ror" : "rol";
    let replacement: string | undefined;

    if (size === "w" && count >= 8 && count <= 15) {
      const immediate = 16 - count;
      replacement = `${opposite}.w #${immediate},${valueReg.register}`;
    } else if (size === "l") {
      if (count >= 9 && count <= 15) {
        replacement = `swap ${valueReg.register}\n${opposite}.l #${16 - count},${valueReg.register}`;
      } else if (count === 16) {
        replacement = `swap ${valueReg.register}`;
      } else if (count >= 17 && count <= 23) {
        replacement = `swap ${valueReg.register}\n${direction}.l #${count - 16},${valueReg.register}`;
      } else if (count >= 24 && count <= 31) {
        replacement = `${opposite}.l #${32 - count},${valueReg.register}`;
      }
    }
    if (!replacement) return;

    // Equivalent rotations preserve result/N/Z and both clear V; C is the
    // observable difference because the last bit shifted out changes.
    const safety = changedFlagsApplicability(ctx, index, ["C"]);
    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence: safety.confidence,
      message: `${direction.toUpperCase()}.${size.toUpperCase()} uses a known count of ${count}; the equivalent immediate form is faster on 68000`,
      loc: moveq.line.mnemonic!.loc,
      suggestion: {
        description: "Replace the MOVEQ + register-count rotate sequence",
        replacement,
        applicability: safety.applicability,
      },
      notes: [
        {
          message: `The removed ${countReg.register.toUpperCase()} value is ${ctx.registers.isLiveAfter(index, moveq.register) === "dead" ? "dead after the rotate" : "already equal to the MOVEQ constant before the sequence"}.`,
        },
        ...(safety.applicability === "safe"
          ? []
          : [
              {
                message:
                  "The equivalent opposite-direction form can leave a different C flag.",
              },
            ]),
      ],
      data: {
        secondInstructionIndex: index,
        countRegister: moveq.register,
        rotateCount: count,
      },
    });
  },
};

export const roxlToAddx: Rule = {
  meta: {
    id: "optimization/roxl-to-addx",
    category: "optimization",
    defaultSeverity: "suggestion",
    description:
      "Use ADDX for small rotate-through-extend-left counts on 68000",
    tags: ["flamewing", "68000", "rotate", "addx", "ccr"],
    docs: { source: "Flamewing M68000 Peephole Optimizations" },
  },
  checkLine(ctx, line, index) {
    if (!m68000Only(ctx) || !isInstruction(line, "roxl")) return;
    const size = instructionSize(line);
    if (size !== "b" && size !== "w" && size !== "l") return;
    const expr = immediateExpressionOperand(line, 0);
    const dst = dataRegisterOperand(line, 1);
    if (!expr || !dst) return;
    const value = ctx.evaluate(expr);
    if (!value.known || (value.value !== 1 && value.value !== 2)) return;
    if (size === "l" && value.value !== 1) return;

    const replacement = Array.from(
      { length: value.value },
      () => `addx.${size} ${dst.register},${dst.register}`,
    ).join("\n");
    // ADDX implements the same rotate-through-X data path and final X/C/N;
    // its overflow and cumulative-Z semantics differ from ROXL.
    const safety = changedFlagsApplicability(ctx, index, ["Z", "V"]);
    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence: safety.confidence,
      message: `ROXL.${size.toUpperCase()} #${value.value},${dst.register.toUpperCase()} can use ${value.value === 1 ? "ADDX" : "two ADDX instructions"} on 68000`,
      loc: line.mnemonic!.loc,
      suggestion: {
        description: "Use ADDX for rotate-through-extend-left",
        replacement,
        applicability: safety.applicability,
      },
      notes:
        safety.applicability === "safe"
          ? undefined
          : [
              {
                message:
                  "ADDX has different V and cumulative-Z flag semantics from ROXL.",
              },
            ],
    });
  },
};

export const lslByteSeven: Rule = {
  meta: {
    id: "optimization/lsl-byte-seven",
    category: "optimization",
    defaultSeverity: "suggestion",
    description: "Replace LSL.B #7 with ROR.B #1 plus a mask on 68000",
    tags: ["flamewing", "68000", "shift", "ccr"],
    serves: "speed",
    docs: { source: "Flamewing M68000 Peephole Optimizations" },
  },
  checkLine(ctx, line, index) {
    if (
      !m68000Only(ctx) ||
      !isInstruction(line, "lsl") ||
      instructionSize(line) !== "b"
    )
      return;
    const expr = immediateExpressionOperand(line, 0);
    const dst = dataRegisterOperand(line, 1);
    if (!expr || !dst) return;
    const value = ctx.evaluate(expr);
    if (!value.known || value.value !== 7) return;
    // Same byte result and N/Z/V. LSL updates X/C from the shifted-out bit;
    // the final ANDI clears C and leaves X from before the sequence.
    const safety = changedFlagsApplicability(ctx, index, ["X", "C"]);
    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence: safety.confidence,
      message: `LSL.B #7,${dst.register.toUpperCase()} can use a 1-bit rotate and mask on 68000`,
      loc: line.mnemonic!.loc,
      suggestion: {
        description: "Use ROR.B #1 followed by ANDI.B #$80",
        replacement: `ror.b #1,${dst.register}\nandi.b #$80,${dst.register}`,
        applicability: safety.applicability,
      },
      notes: [
        ...(safety.applicability === "safe"
          ? []
          : [
              {
                message:
                  "X/C differ from the original LSL and must not be observed.",
              },
            ]),
      ],
    });
  },
};

/**
 * ASL.B #7 and LSL.B #7 shift in zeros identically -- an arithmetic left
 * shift fills the same way a logical one does, only right shifts differ --
 * so the same ROR.B #1 plus mask produces the same byte. Unlike LSL, which
 * always clears V, ASL's V is set if the sign bit changes at any point during
 * the shift, which depends on the input value and cannot be assumed zero, so
 * V is tracked alongside X/C here where LSL's version does not need to.
 */
export const aslByteSeven: Rule = {
  meta: {
    id: "optimization/asl-byte-seven",
    category: "optimization",
    defaultSeverity: "suggestion",
    description: "Replace ASL.B #7 with ROR.B #1 plus a mask on 68000",
    tags: ["flamewing", "68000", "shift", "ccr"],
    serves: "speed",
    docs: { source: "Flamewing M68000 Peephole Optimizations" },
  },
  checkLine(ctx, line, index) {
    if (
      !m68000Only(ctx) ||
      !isInstruction(line, "asl") ||
      instructionSize(line) !== "b"
    )
      return;
    const expr = immediateExpressionOperand(line, 0);
    const dst = dataRegisterOperand(line, 1);
    if (!expr || !dst) return;
    const value = ctx.evaluate(expr);
    if (!value.known || value.value !== 7) return;
    // Same byte result and N/Z. V is data-dependent for ASL (unlike LSL, which
    // always clears it) and X/C reflect the shifted-out bit, so all three are
    // checked; the final ANDI clears V/C and leaves X from before the sequence.
    const safety = changedFlagsApplicability(ctx, index, ["X", "V", "C"]);
    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence: safety.confidence,
      message: `ASL.B #7,${dst.register.toUpperCase()} can use a 1-bit rotate and mask on 68000`,
      loc: line.mnemonic!.loc,
      suggestion: {
        description: "Use ROR.B #1 followed by ANDI.B #$80",
        replacement: `ror.b #1,${dst.register}\nandi.b #$80,${dst.register}`,
        applicability: safety.applicability,
      },
      notes: [
        ...(safety.applicability === "safe"
          ? []
          : [
              {
                message:
                  "X/V/C differ from the original ASL and must not be observed.",
              },
            ]),
      ],
    });
  },
};
