import type { Rule } from "../../core/rule.js";
import {
  dataRegisterOperand,
  immediateExpressionOperand,
  instructionSize,
  isInstruction,
} from "../../util/ast.js";
import {
  registersReadByOperand,
  normalizeRegister,
} from "../../semantics/registers.js";
import { sourceOperand } from "./helpers.js";

// Verified with 68kcounter: a clean win on every target it models
// (68000/68020/68030/68040/68060); 68010 follows 68000, being cycle-identical
// for this form.
const MEASURED_TARGETS = [
  "mc68000",
  "mc68010",
  "mc68020",
  "mc68030",
  "mc68040",
  "mc68060",
];
function supportedTarget(
  ctx: Parameters<NonNullable<Rule["checkLine"]>>[0],
): boolean {
  return ctx.config.processors.every((cpu) => MEASURED_TARGETS.includes(cpu));
}

function hasInterveningLabel(
  ctx: Parameters<NonNullable<Rule["checkLine"]>>[0],
  from: number,
  to: number,
): boolean {
  for (let i = from + 1; i <= to; i++) if (ctx.line(i)?.label) return true;
  return false;
}

/**
 * Flamewing's MOVE.B + ANDI.B rewrite. The low byte and final CCR are the same,
 * but MOVEQ replaces the upper 24 bits. We only emit it when the analyser proves
 * those bits are discarded before they can be observed.
 */
export const moveByteAndMaskViaMoveq: Rule = {
  meta: {
    obfuscated: true,
    id: "optimization/move-byte-and-mask",
    category: "optimization",
    defaultSeverity: "suggestion",
    description:
      "Replace MOVE.B + ANDI.B with MOVEQ + AND when upper bits are dead",
    tags: ["flamewing", "partial-register", "mask"],
    docs: {
      source: "Flamewing M68000 Peephole Optimizations",
      example: {
        source:
          "\tmove.b (a0),d0\n\tandi.b #$7f,d0\n\tmove.b d0,d1\n\tmoveq #0,d0\n\trts",
      },
    },
  },
  checkLine(ctx, line, index) {
    if (
      !supportedTarget(ctx) ||
      !isInstruction(line, "and") ||
      instructionSize(line) !== "b"
    )
      return;
    const maskExpr = immediateExpressionOperand(line, 0);
    const dst = dataRegisterOperand(line, 1);
    if (!maskExpr || !dst) return;
    const mask = ctx.evaluate(maskExpr);
    if (!mask.known || mask.value < -128 || mask.value > 127) return;

    const previous = ctx.previousInstruction(index);
    if (
      !previous ||
      hasInterveningLabel(ctx, previous.index, index) ||
      !isInstruction(previous.line, "move") ||
      instructionSize(previous.line) !== "b"
    )
      return;
    const previousDst = dataRegisterOperand(previous.line, 1);
    if (
      !previousDst ||
      previousDst.register.toLowerCase() !== dst.register.toLowerCase()
    )
      return;
    const source = previous.line.operands?.[0];
    if (!source) return;

    const destRegister = normalizeRegister(dst.register);
    if (!destRegister) return;
    // The replacement evaluates <ea> after MOVEQ. If <ea> itself reads Dn (for
    // example as an index register, or MOVE.B Dn,Dn), the address/value changes.
    if (registersReadByOperand(source).has(destRegister)) return;

    const upperUse = ctx.registers.registerBitsUseAfter(
      index,
      dst.register,
      0xffffff00,
    );
    if (upperUse !== "unused") return;
    const ea = sourceOperand(ctx, previous.line, 0);
    if (!ea) return;

    const signedMask = (mask.value << 24) >> 24;
    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence: "certain",
      message: `Only the low byte of ${dst.register.toUpperCase()} is observed; MOVE.B + ANDI.B can use MOVEQ + AND.B`,
      loc: previous.line.mnemonic!.loc,
      suggestion: {
        description: "Load the mask with MOVEQ and AND the source directly",
        replacement: `moveq #${signedMask},${dst.register}\nand.b ${ea},${dst.register}`,
        applicability: "safe",
      },
      notes: [
        {
          message: `The analyser proves bits 8-31 of ${dst.register.toUpperCase()} are discarded before any read.`,
        },
      ],
      data: {
        secondInstructionIndex: index,
        differingBits: "8-31",
        provenance: "flamewing",
      },
    });
  },
};
