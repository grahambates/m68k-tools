import type { Rule } from "../../core/rule.js";
import {
  dataRegisterOperand,
  immediateExpressionOperand,
  instructionSize,
  isInstruction,
} from "../../util/ast.js";
import { normalizeRegister } from "../../semantics/registers.js";
import { valueText } from "./helpers.js";

export const compareLongImmediateViaMoveq: Rule = {
  meta: {
    id: "optimization/compare-long-immediate-via-moveq",
    category: "optimization",
    defaultSeverity: "suggestion",
    description:
      "Compare a small long immediate via MOVEQ and a dead scratch register",
    tags: ["tricks-and-traps", "68000", "compare"],
    docs: {
      source: "Mike Morton, 68000 Tricks and Traps (BYTE, Sep 1986)",
      example: { source: "\tcmp.l #42,d1\n\tmoveq #0,d0\n\trts" },
    },
  },
  checkLine(ctx, line, index) {
    if (!isInstruction(line, "cmp") || instructionSize(line) !== "l") return;
    const expr = immediateExpressionOperand(line, 0);
    const dst = dataRegisterOperand(line, 1);
    if (!expr || !dst) return;
    const value = ctx.evaluate(expr);
    if (!value.known || value.value < -128 || value.value > 127) return;
    const target = normalizeRegister(dst.register);
    if (!target) return;
    const scratch = ctx.registers
      .deadDataRegistersAfter(index)
      .find((r) => r !== target);
    if (!scratch) return;

    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence: "certain",
      message: `CMP.L #${value.value},${target.toUpperCase()} can use MOVEQ plus register CMP`,
      loc: line.mnemonic!.loc,
      suggestion: {
        description: `Load the small constant with MOVEQ into ${scratch.toUpperCase()} and compare registers`,
        replacement: `moveq #${valueText(ctx, expr, value.value)},${scratch}\ncmp.l ${scratch},${target}`,
        applicability: "safe",
      },
      notes: [
        {
          message:
            "A small long immediate can be compared through a scratch register; the one used here is proven dead.",
        },
      ],
    });
  },
};
