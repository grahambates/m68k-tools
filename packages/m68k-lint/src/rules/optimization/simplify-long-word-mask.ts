import type { Rule } from "../../core/rule.js";
import {
  dataRegisterOperand,
  immediateExpressionOperand,
  instructionSize,
  isInstruction,
} from "../../util/ast.js";
import { changedFlagsApplicability } from "./helpers.js";

function m68000Only(
  ctx: Parameters<NonNullable<Rule["checkLine"]>>[0],
): boolean {
  return ctx.config.processors.every((cpu) => cpu === "mc68000");
}

export const simplifyLongWordMasks: Rule = {
  meta: {
    id: "optimization/simplify-long-word-mask",
    category: "optimization",
    defaultSeverity: "suggestion",
    description: "Simplify common 32-bit word masks on 68000",
    tags: ["flamewing", "68000", "mask", "ccr"],
    docs: { source: "Flamewing M68000 Peephole Optimizations" },
  },
  checkLine(ctx, line, index) {
    if (
      !m68000Only(ctx) ||
      !isInstruction(line, "and") ||
      instructionSize(line) !== "l"
    )
      return;
    const expr = immediateExpressionOperand(line, 0);
    const dst = dataRegisterOperand(line, 1);
    if (!expr || !dst) return;
    const result = ctx.evaluate(expr);
    if (!result.known) return;
    const mask = result.value >>> 0;
    if (mask !== 0x0000ffff && mask !== 0xffff0000) return;

    const safety = changedFlagsApplicability(ctx, index, ["N", "Z", "V", "C"]);
    const replacement =
      mask === 0x0000ffff
        ? `swap ${dst.register}\nclr.w ${dst.register}\nswap ${dst.register}`
        : `clr.w ${dst.register}`;
    const sizeDelta = mask === 0x0000ffff ? 0 : -4;

    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence: safety.confidence,
      message:
        mask === 0x0000ffff
          ? "AND.L #$FFFF,Dn can clear the upper word without a long immediate"
          : "AND.L #$FFFF0000,Dn is equivalent to clearing the low word",
      loc: line.mnemonic!.loc,
      suggestion: {
        description: "Use the word-oriented mask sequence",
        replacement,
        applicability: safety.applicability,
        impact: { sizeBytes: { delta: sizeDelta, confidence: "source" } },
      },
      notes: [
        ...(safety.applicability === "safe"
          ? []
          : [
              {
                message:
                  "The condition codes differ from the original; review CCR use before applying.",
              },
            ]),
      ],
    });
  },
};
