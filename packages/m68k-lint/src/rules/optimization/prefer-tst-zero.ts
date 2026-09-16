import type { Rule } from "../../core/rule.js";
import {
  immediateOperand,
  instructionSize,
  isInstruction,
  operand,
} from "../../util/ast.js";
import { sourceOperand } from "./helpers.js";
export const preferTstZero: Rule = {
  meta: {
    // TST removes the explicit comparison value or expression.
    obfuscated: true,
    id: "optimization/prefer-tst-zero",
    category: "optimization",
    defaultSeverity: "suggestion",
    description: "Prefer TST for CMP #0",
    tags: ["asp68k"],
    docs: { source: "ASP68K" },
  },
  checkLine(ctx, line) {
    if (!isInstruction(line, "cmp")) return;
    const imm = immediateOperand(line, 0);
    if (!imm || imm.value.type === "string-literal") return;
    const value = ctx.evaluate(imm.value);
    if (!value.known || value.value !== 0) return;
    const dest = operand(line, 1);
    if (
      !dest ||
      ![
        "data-register",
        "address-register-indirect",
        "address-register-indirect-postinc",
        "address-register-indirect-predec",
        "address-register-indirect-displacement",
        "address-register-indirect-index",
        "memory-indirect",
        "absolute-address",
      ].includes(dest.type)
    )
      return;
    const d = sourceOperand(ctx, line, 1);
    const size = instructionSize(line);
    const suffix = size ? `.${size}` : "";
    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence: "certain",
      message: "Comparison with zero can use TST",
      loc: line.mnemonic!.loc,
      suggestion: {
        description: "Use TST",
        replacement: d ? `tst${suffix} ${d}` : undefined,
        applicability: "safe",
      },
    });
  },
};
