import type { Rule } from "../../core/rule.js";
import {
  dataRegisterOperand,
  immediateOperand,
  instructionSize,
  isInstruction,
} from "../../util/ast.js";
import { changedFlagsApplicability } from "./helpers.js";

export const multiplyLongByOne: Rule = {
  meta: {
    id: "optimization/multiply-long-by-one",
    category: "optimization",
    defaultSeverity: "suggestion",
    description: "Remove a long multiply by one on 68060",
    tags: ["asp68k", "multiply", "68060"],
    docs: { source: "ASP68K" },
  },
  checkLine(ctx, line, index) {
    if (
      ctx.config.processors.length === 0 ||
      !ctx.config.processors.every((cpu) => cpu === "mc68060")
    )
      return;
    if (
      (!isInstruction(line, "muls") && !isInstruction(line, "mulu")) ||
      instructionSize(line) !== "l"
    )
      return;
    const imm = immediateOperand(line, 0);
    const dest = dataRegisterOperand(line, 1);
    if (!imm || !dest || imm.value.type === "string-literal") return;
    const value = ctx.evaluate(imm.value);
    if (!value.known || value.value !== 1) return;

    const ccr = changedFlagsApplicability(ctx, index, ["N", "Z", "V", "C"]);
    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence: ccr.confidence,
      message: `Multiplying ${dest.register.toUpperCase()} by one leaves its value unchanged`,
      loc: line.mnemonic!.loc,
      suggestion: {
        description: "Remove the multiply",
        replacement: "",
        applicability: ccr.applicability,
      },
      notes: [
        {
          message:
            "The replacement encodes in fewer words and avoids the multiply entirely.",
        },
        ...(ccr.applicability === "safe"
          ? []
          : [
              {
                message:
                  "Removing MUL preserves the previous CCR instead of writing the multiply result flags.",
              },
            ]),
      ],
    });
  },
};
