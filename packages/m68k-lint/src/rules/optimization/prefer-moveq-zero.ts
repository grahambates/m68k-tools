import type { Rule } from "../../core/rule.js";
import {
  dataRegisterOperand,
  instructionSize,
  isInstruction,
} from "../../util/ast.js";

export const preferMoveqZero: Rule = {
  meta: {
    id: "optimization/prefer-moveq-zero",
    category: "optimization",
    defaultSeverity: "suggestion",
    description: "Prefer MOVEQ #0 to CLR.L on early 68k targets",
    tags: ["asp68k", "68000", "68010"],
    docs: { source: "ASP68K" },
  },
  checkLine(ctx, line) {
    if (!isInstruction(line, "clr") || instructionSize(line) !== "l") return;
    const dest = dataRegisterOperand(line, 0);
    if (!dest) return;

    // ASP68K marks this as a win on 68000/68010, but not 68030+.
    if (
      !ctx.config.processors.every(
        (cpu) => cpu === "mc68000" || cpu === "mc68010",
      )
    )
      return;

    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence: "certain",
      message: "CLR.L of a data register can use MOVEQ #0 on this target",
      loc: line.mnemonic!.loc,
      suggestion: {
        description: `Use MOVEQ #0,${dest.register}`,
        replacement: `moveq #0,${dest.register}`,
        applicability: "safe",
      },
    });
  },
};
