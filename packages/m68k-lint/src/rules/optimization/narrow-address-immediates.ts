import type { Rule } from "../../core/rule.js";
import {
  addressRegisterOperand,
  immediateExpressionOperand,
  instructionSize,
  isInstruction,
} from "../../util/ast.js";
import { valueText } from "./helpers.js";

function m68000Only(
  ctx: Parameters<NonNullable<Rule["checkLine"]>>[0],
): boolean {
  return ctx.config.processors.every((cpu) => cpu === "mc68000");
}

function signedWord(value: number): boolean {
  return Number.isInteger(value) && value >= -32768 && value <= 32767;
}

export const narrowMoveaImmediate: Rule = {
  meta: {
    id: "optimization/narrow-movea-immediate-word",
    category: "optimization",
    defaultSeverity: "suggestion",
    description:
      "Use MOVEA.W for signed 16-bit immediate address loads on 68000",
    tags: ["flamewing", "68000", "address-register"],
    docs: { source: "Flamewing M68000 Peephole Optimizations" },
  },
  checkLine(ctx, line) {
    if (
      !m68000Only(ctx) ||
      !isInstruction(line, "movea") ||
      instructionSize(line) !== "l"
    )
      return;
    const expr = immediateExpressionOperand(line, 0);
    const dst = addressRegisterOperand(line, 1);
    if (!expr || !dst) return;
    const value = ctx.evaluate(expr);
    if (!value.known || !signedWord(value.value)) return;

    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence: "certain",
      message: `MOVEA.L #${value.value},${dst.register.toUpperCase()} can use the sign-extending word form`,
      loc: line.mnemonic!.loc,
      suggestion: {
        description: "Use MOVEA.W immediate",
        replacement: `movea.w #${valueText(ctx, expr, value.value)},${dst.register}`,
        applicability: "safe",
        impact: { sizeBytes: { delta: -2, confidence: "source" } },
      },
    });
  },
};

export const narrowAddaSubaImmediate: Rule = {
  meta: {
    id: "optimization/narrow-address-immediate-word",
    category: "optimization",
    defaultSeverity: "suggestion",
    description:
      "Use word-sized ADDA/SUBA immediates when the constant fits signed 16 bits",
    tags: ["flamewing", "68000", "address-register"],
    docs: {
      source: "Flamewing M68000 Peephole Optimizations",
      note: "ADDA.L row is in the source; SUBA.L is a separately verified symmetric extension.",
    },
  },
  checkLine(ctx, line) {
    if (!m68000Only(ctx) || instructionSize(line) !== "l") return;
    const op = isInstruction(line, "adda")
      ? "adda"
      : isInstruction(line, "suba")
        ? "suba"
        : undefined;
    if (!op) return;
    const expr = immediateExpressionOperand(line, 0);
    const dst = addressRegisterOperand(line, 1);
    if (!expr || !dst) return;
    const value = ctx.evaluate(expr);
    if (!value.known || !signedWord(value.value)) return;

    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence: "certain",
      message: `${op.toUpperCase()}.L #${value.value},${dst.register.toUpperCase()} can use the word form`,
      loc: line.mnemonic!.loc,
      suggestion: {
        description: `Use ${op.toUpperCase()}.W immediate`,
        replacement: `${op}.w #${valueText(ctx, expr, value.value)},${dst.register}`,
        applicability: "safe",
        impact: { sizeBytes: { delta: -2, confidence: "source" } },
      },
      notes: [],
    });
  },
};

export const narrowCmpaImmediate: Rule = {
  meta: {
    id: "optimization/narrow-cmpa-immediate-word",
    category: "optimization",
    defaultSeverity: "suggestion",
    description: "Use CMPA.W for signed 16-bit immediate comparisons",
    tags: ["vasm", "address-register"],
    docs: { source: "vasm m68k optimization history" },
  },
  checkLine(ctx, line) {
    if (instructionSize(line) !== "l" || !isInstruction(line, "cmpa")) return;
    const expr = immediateExpressionOperand(line, 0);
    const dst = addressRegisterOperand(line, 1);
    if (!expr || !dst) return;
    const value = ctx.evaluate(expr);
    if (!value.known || !signedWord(value.value)) return;

    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence: "certain",
      message: `CMPA.L #${value.value},${dst.register.toUpperCase()} can use the word form`,
      loc: line.mnemonic!.loc,
      suggestion: {
        description: "Use CMPA.W immediate",
        replacement: `cmpa.w #${valueText(ctx, expr, value.value)},${dst.register}`,
        applicability: "safe",
        impact: { sizeBytes: { delta: -2, confidence: "source" } },
      },
    });
  },
};
