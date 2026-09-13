import type { Rule } from "../../core/rule.js";
import {
  addressRegisterOperand,
  isInstruction,
  operand,
} from "../../util/ast.js";

export const leaZeroAddress: Rule = {
  meta: {
    id: "optimization/lea-zero-address",
    category: "optimization",
    defaultSeverity: "suggestion",
    description: "Zero an address register with SUBA/SUB where profitable",
    tags: ["asp68k", "68000", "68010", "68030", "ccr"],
    docs: { source: "ASP68K" },
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
    if (
      !ctx.config.processors.every((cpu) =>
        ["mc68000", "mc68010", "mc68030"].includes(cpu),
      )
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
