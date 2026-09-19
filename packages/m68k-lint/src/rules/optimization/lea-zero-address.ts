import type { Rule } from "../../core/rule.js";
import {
  addressRegisterOperand,
  isInstruction,
  operand,
} from "../../util/ast.js";
import { targetsOnly } from "../../core/config.js";

export const leaZeroAddress: Rule = {
  meta: {
    // Self-subtraction hides the original address expression.
    obfuscated: true,
    id: "optimization/lea-zero-address",
    category: "optimization",
    defaultSeverity: "suggestion",
    description: "Zero an address register with SUBA/SUB where profitable",
    tags: ["asp68k", "68000", "68010", "68030", "ccr"],
    docs: { source: "ASP68K", example: { source: "\tlea 0.w,a0" } },
  },
  checkLine(ctx, line) {
    if (!isInstruction(line, "lea")) return;
    const source = operand(line, 0);
    const dest = addressRegisterOperand(line, 1);
    if (!source || source.type !== "absolute-address" || !dest) return;
    const value = ctx.evaluate(source.address);
    if (!value.known || value.value !== 0) return;
    if (
      source.addressSize?.type !== "size" ||
      (source.addressSize.size !== "w" && source.addressSize.size !== "l")
    )
      return;
    // Verified with 68kcounter: a clean win on every target checked except
    // 68040, where SUBA costs one cycle more than LEA.
    if (
      !targetsOnly(ctx.config, [
        "mc68000",
        "mc68010",
        "mc68020",
        "mc68030",
        "mc68060",
      ])
    )
      return;

    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence: "certain",
      message: `LEA 0.${source.addressSize.size},${dest.register} can zero the address register with SUBA.L ${dest.register},${dest.register}`,
      loc: line.mnemonic!.loc,
      suggestion: {
        description: `Use SUBA.L ${dest.register},${dest.register}`,
        replacement: `suba.l ${dest.register},${dest.register}`,
        applicability: "safe",
      },
    });
  },
};
