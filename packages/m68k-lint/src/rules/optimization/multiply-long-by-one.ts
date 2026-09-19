import type { Rule } from "../../core/rule.js";
import {
  dataRegisterOperand,
  immediateOperand,
  instructionSize,
  isInstruction,
} from "../../util/ast.js";
import { changedFlagsApplicability } from "./helpers.js";
import { targetsOnly } from "../../core/config.js";

export const multiplyLongByOne: Rule = {
  meta: {
    id: "optimization/multiply-long-by-one",
    category: "optimization",
    defaultSeverity: "suggestion",
    description: "Remove a long multiply by one",
    tags: ["asp68k", "multiply", "68020+"],
    docs: {
      source: "ASP68K",
      note: "MULS.L/MULU.L only exist from 68020 on. Verified with 68kcounter: removing it entirely saves cycles on every target checked -- 68020 (50), 68030 (48), 68040 (20), 68060 (3) -- not just 68060.",
      example: {
        source: "\tmuls.l #1,d0\n\tadd.l d1,d2",
        config: { processors: ["mc68060"] },
      },
    },
  },
  checkLine(ctx, line, index) {
    if (
      ctx.config.processors.length === 0 ||
      !targetsOnly(ctx.config, ["mc68020", "mc68030", "mc68040", "mc68060"])
    )
      return;
    if (
      (!isInstruction(line, "muls") && !isInstruction(line, "mulu")) ||
      instructionSize(line) !== "l"
    )
      return;
    const imm = immediateOperand(line, 0);
    const dest = dataRegisterOperand(line, 1);
    if (!imm || !dest) return;
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
