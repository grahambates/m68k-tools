import type { Rule } from "../../core/rule.js";
import {
  addressRegisterOperand,
  immediateOperand,
  instructionSize,
  isInstruction,
} from "../../util/ast.js";

export const zeroAddressRegister: Rule = {
  meta: {
    // Self-subtraction hides the original zero expression.
    obfuscated: true,
    id: "optimization/zero-address-register",
    category: "optimization",
    defaultSeverity: "suggestion",
    description: "Zero an address register with SUBA An,An",
    tags: ["asp68k"],
    docs: { source: "ASP68K" },
  },
  checkLine(ctx, line) {
    if (!isInstruction(line, "movea")) return;
    const size = instructionSize(line);
    if (size !== "w" && size !== "l") return;
    const imm = immediateOperand(line, 0);
    const dest = addressRegisterOperand(line, 1);
    if (!imm || imm.value.type === "string-literal" || !dest) return;
    const value = ctx.evaluate(imm.value);
    if (!value.known || value.value !== 0) return;

    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence: "certain",
      message:
        "Zero address-register immediate can be replaced by self-subtraction",
      loc: line.mnemonic!.loc,
      suggestion: {
        description: `Use SUBA.L ${dest.register},${dest.register}`,
        replacement: `suba.l ${dest.register},${dest.register}`,
        applicability: "safe",
      },
    });
  },
};
