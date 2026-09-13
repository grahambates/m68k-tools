import type { Rule } from "../../core/rule.js";
import {
  immediateOperand,
  instructionSize,
  isInstruction,
  operand,
} from "../../util/ast.js";
import { changedFlagsApplicability, valueText } from "./helpers.js";

export const pushImmediatePea: Rule = {
  meta: {
    id: "optimization/push-immediate-pea",
    category: "optimization",
    defaultSeverity: "suggestion",
    description: "Use PEA for a signed-16-bit immediate longword push",
    tags: ["asp68k", "stack", "ccr", "68000", "68010"],
    docs: { source: "ASP68K" },
  },
  checkLine(ctx, line, index) {
    if (!isInstruction(line, "move") || instructionSize(line) !== "l") return;
    const source = immediateOperand(line, 0);
    const dest = operand(line, 1);
    if (
      !source ||
      source.value.type === "string-literal" ||
      !dest ||
      dest.type !== "address-register-indirect-predec"
    )
      return;
    if (
      dest.register.type !== "address-register" ||
      !["a7", "sp"].includes(dest.register.register.toLowerCase())
    )
      return;
    const value = ctx.evaluate(source.value);
    if (!value.known || value.value < -32768 || value.value > 32767) return;
    if (
      !ctx.config.processors.every(
        (cpu) => cpu === "mc68000" || cpu === "mc68010",
      )
    )
      return;

    const safety = changedFlagsApplicability(ctx, index, ["N", "Z", "V", "C"]);
    const written = valueText(ctx, source.value, value.value);

    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence: safety.confidence,
      message:
        "Immediate longword push can use PEA with an absolute-short effective address",
      loc: line.mnemonic!.loc,
      suggestion: {
        description: `Use PEA ${written}.w`,
        replacement: `pea ${written}.w`,
        applicability: safety.applicability,
      },
      notes: [
        ...(safety.applicability === "safe"
          ? []
          : [
              {
                message:
                  "MOVE updates N/Z/V/C while PEA preserves CCR; review later flag use.",
              },
            ]),
      ],
    });
  },
};
