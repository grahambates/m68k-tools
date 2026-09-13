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

export const normalizeByteRotate: Rule = {
  meta: {
    id: "optimization/normalize-byte-rotate-direction",
    category: "optimization",
    defaultSeverity: "suggestion",
    description: "Use the shorter-direction immediate byte rotate on 68000",
    tags: ["flamewing", "68000", "rotate", "ccr"],
    docs: { source: "Flamewing M68000 Peephole Optimizations" },
  },
  checkLine(ctx, line, index) {
    if (!m68000Only(ctx) || instructionSize(line) !== "b") return;
    const direction = isInstruction(line, "rol")
      ? "rol"
      : isInstruction(line, "ror")
        ? "ror"
        : undefined;
    if (!direction) return;
    const expr = immediateExpressionOperand(line, 0);
    const dst = dataRegisterOperand(line, 1);
    if (!expr || !dst) return;
    const count = ctx.evaluate(expr);
    if (!count.known || count.value < 5 || count.value > 7) return;

    const opposite = direction === "rol" ? "ror" : "rol";
    const replacementCount = 8 - count.value;
    const safety = changedFlagsApplicability(ctx, index, ["C"]);

    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence: safety.confidence,
      message: `${direction.toUpperCase()}.B #${count.value} is the same byte rotation as ${opposite.toUpperCase()}.B #${replacementCount}`,
      loc: line.mnemonic!.loc,
      suggestion: {
        description: `Rotate the shorter direction`,
        replacement: `${opposite}.b #${replacementCount},${dst.register}`,
        applicability: safety.applicability,
      },
      notes: [
        ...(safety.applicability === "safe"
          ? []
          : [
              {
                message:
                  "The equivalent opposite-direction rotate can leave a different C flag; review carry use before applying.",
              },
            ]),
      ],
    });
  },
};
