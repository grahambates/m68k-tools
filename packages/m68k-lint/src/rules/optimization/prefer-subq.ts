import type { Rule } from "../../core/rule.js";
import {
  immediateOperand,
  instructionSize,
  isAddqDestination,
  isInstructionFamily,
  operand,
} from "../../util/ast.js";
import { sourceOperand, valueText } from "./helpers.js";

export const preferSubq: Rule = {
  meta: {
    id: "optimization/prefer-subq",
    category: "optimization",
    defaultSeverity: "suggestion",
    description: "Prefer SUBQ for immediate subtractions from 1 through 8",
    tags: ["asp68k"],
    docs: { source: "ASP68K", example: { source: "\tsub.l #5,d0" } },
  },
  checkLine(ctx, line) {
    if (!isInstructionFamily(line, "sub")) return;
    const imm = immediateOperand(line, 0);
    const dest = operand(line, 1);
    const size = instructionSize(line);
    if (
      !imm ||
      imm.value.type === "string-literal" ||
      !isAddqDestination(dest, size)
    )
      return;
    const value = ctx.evaluate(imm.value);
    if (!value.known || value.value < 1 || value.value > 8) return;
    const suffix = size ? `.${size}` : "";
    const d = sourceOperand(ctx, line, 1);
    const written = valueText(ctx, imm.value, value.value);

    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence: "certain",
      message: `Immediate ${value.value} fits the SUBQ range`,
      loc: line.mnemonic!.loc,
      suggestion: {
        description: "Use SUBQ",
        replacement: d ? `subq${suffix} #${written},${d}` : undefined,
        applicability: "safe",
      },
    });
  },
};
