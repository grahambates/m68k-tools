import type { Rule } from "../../core/rule.js";
import {
  immediateOperand,
  instructionSize,
  isAddqDestination,
  isInstructionFamily,
  operand,
} from "../../util/ast.js";
import { valueText } from "./helpers.js";

export const preferAddq: Rule = {
  meta: {
    id: "optimization/prefer-addq",
    category: "optimization",
    defaultSeverity: "suggestion",
    description: "Prefer ADDQ for immediate additions from 1 through 8",
    tags: ["asp68k"],
    docs: { source: "ASP68K", example: { source: "\tadd.l #5,d0" } },
  },

  checkLine(ctx, line) {
    if (!isInstructionFamily(line, "add")) return;

    const immediate = immediateOperand(line, 0);
    const destination = operand(line, 1);
    const size = instructionSize(line);
    if (!immediate || immediate.value.type === "string-literal") return;
    if (!isAddqDestination(destination, size)) return;

    const value = ctx.evaluate(immediate.value);
    if (!value.known || value.value < 1 || value.value > 8) return;

    const suffix = size ? `.${size}` : "";
    const originalDestination = destination
      ? ctx
          .sourceLine((line.lineNumber ?? 1) - 1)
          ?.slice(destination.loc.start, destination.loc.end)
      : undefined;

    const written = valueText(ctx, immediate.value, value.value);

    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence: "certain",
      message: `Immediate ${value.value} fits the ADDQ range`,
      loc: line.mnemonic!.loc,
      suggestion: {
        description: "Use ADDQ",
        replacement: originalDestination
          ? `addq${suffix} #${written},${originalDestination}`
          : undefined,
        applicability: "safe",
      },
    });
  },
};
