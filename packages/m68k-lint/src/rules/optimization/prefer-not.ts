import type { Rule } from "../../core/rule.js";
import {
  immediateOperand,
  instructionSize,
  isInstruction,
} from "../../util/ast.js";
import { sourceOperand } from "./helpers.js";
export const preferNot: Rule = {
  meta: {
    // NOT removes the explicit all-ones mask expression.
    obfuscated: true,
    id: "optimization/prefer-not",
    category: "optimization",
    defaultSeverity: "suggestion",
    description: "Prefer NOT for EOR #-1",
    tags: ["asp68k"],
    docs: { source: "ASP68K", example: { source: "\teori.w #-1,d0" } },
  },
  checkLine(ctx, line) {
    if (!isInstruction(line, "eor")) return;
    const imm = immediateOperand(line, 0);
    if (!imm || imm.value.type === "string-literal") return;
    const value = ctx.evaluate(imm.value);
    if (!value.known || value.value !== -1) return;
    const d = sourceOperand(ctx, line, 1);
    const size = instructionSize(line);
    const suffix = size ? `.${size}` : "";
    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence: "certain",
      message: "EOR #-1 can be expressed as NOT",
      loc: line.mnemonic!.loc,
      suggestion: {
        description: "Use NOT",
        replacement: d ? `not${suffix} ${d}` : undefined,
        applicability: "safe",
      },
    });
  },
};
