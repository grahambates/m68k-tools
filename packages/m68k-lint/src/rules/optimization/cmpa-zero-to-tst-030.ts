import type { Rule } from "../../core/rule.js";
import {
  addressRegisterOperand,
  immediateExpressionOperand,
  instructionSize,
  isInstruction,
} from "../../util/ast.js";

export const cmpaZeroToTst030: Rule = {
  meta: {
    id: "optimization/cmpa-zero-to-tst-030",
    category: "optimization",
    defaultSeverity: "suggestion",
    description: "Use TST.L An for CMPA.L #0,An on 68030",
    tags: ["asp68k", "68030", "address-register", "ccr"],
    docs: { source: "ASP68K" },
  },
  checkLine(ctx, line) {
    if (!ctx.config.processors.every((cpu) => cpu === "mc68030")) return;
    if (!isInstruction(line, "cmpa") || instructionSize(line) !== "l") return;
    const expr = immediateExpressionOperand(line, 0);
    const dest = addressRegisterOperand(line, 1);
    if (!expr || !dest) return;
    const value = ctx.evaluate(expr);
    if (!value.known || value.value !== 0) return;
    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence: "certain",
      message: "CMPA.L #0,An can use TST.L An on 68030",
      loc: line.mnemonic!.loc,
      suggestion: {
        description: "Use TST.L",
        replacement: `tst.l ${dest.register}`,
        applicability: "safe",
      },
      notes: [
        {
          message:
            "The long form has equivalent N/Z/V/C semantics for comparison with zero.",
        },
        {
          message:
            "The .W form is intentionally not implemented because CMPA.W sign-extends the source before a 32-bit address comparison.",
        },
      ],
    });
  },
};
