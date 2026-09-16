import type { Rule } from "../../core/rule.js";
import {
  addressRegisterOperand,
  immediateOperand,
  instructionSize,
  isInstruction,
} from "../../util/ast.js";
import { valueText } from "./helpers.js";

export const preferMoveWordAddress: Rule = {
  meta: {
    id: "optimization/prefer-move-word-address",
    category: "optimization",
    defaultSeverity: "suggestion",
    description:
      "Use a word immediate when loading a signed 16-bit address-register constant",
    tags: ["asp68k"],
    docs: { source: "ASP68K", example: { source: "\tmovea.l #100,a0" } },
  },
  checkLine(ctx, line) {
    if (!isInstruction(line, "movea") || instructionSize(line) !== "l") return;
    const imm = immediateOperand(line, 0);
    const dest = addressRegisterOperand(line, 1);
    if (!imm || imm.value.type === "string-literal" || !dest) return;
    const value = ctx.evaluate(imm.value);
    if (
      !value.known ||
      value.value === 0 ||
      value.value < -32768 ||
      value.value > 32767
    )
      return;

    const written = valueText(ctx, imm.value, value.value);

    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence: "certain",
      message:
        "This address-register immediate fits the sign-extended word form",
      loc: line.mnemonic!.loc,
      suggestion: {
        description: `Use MOVEA.W #${written},${dest.register}`,
        replacement: `movea.w #${written},${dest.register}`,
        applicability: "safe",
      },
    });
  },
};
