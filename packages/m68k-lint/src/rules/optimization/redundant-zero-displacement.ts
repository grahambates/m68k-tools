import type { Rule } from "../../core/rule.js";
import { operand } from "../../util/ast.js";
import { replaceOperandInLine, sourceOperand } from "./helpers.js";

export const redundantZeroDisplacement: Rule = {
  meta: {
    // A zero displacement can be a named field offset or expression.
    obfuscated: true,
    id: "optimization/redundant-zero-displacement",
    category: "optimization",
    defaultSeverity: "suggestion",
    enabledByDefault: false,
    presets: ["style"],
    description: "Omit a zero address-register displacement",
    tags: ["asp68k", "addressing"],
    docs: {
      source: "ASP68K",
      note: "Off by default, because vasm drops the zero displacement under its default optimisations, so for the common case the measured saving is in the written form rather than the output, and a displacement of zero is sometimes written on purpose to match the non-zero cases around it. Enable it if your assembler leaves the extension word in, whether because optimisations are off or because it does not fold the operand at all: the saving is then real.",
      example: {
        source: "\tmove.l 0(a0),d0",
        config: { presets: ["style"] },
      },
    },
  },
  checkLine(ctx, line) {
    for (let i = 0; i < (line.operands?.length ?? 0); i++) {
      const op = operand(line, i);
      if (!op || op.type !== "address-register-indirect-displacement") continue;
      if (op.register.type !== "address-register") continue;
      const displacement = ctx.evaluate(op.displacement);
      if (!displacement.known || displacement.value !== 0) continue;

      const original = sourceOperand(ctx, line, i);
      const operandText = `(${op.register.register})`;
      // Replacements are line-scoped, so rewrite the operand within the full line.
      const replacement = replaceOperandInLine(ctx, line, i, operandText);
      if (!replacement) continue;
      ctx.report({
        ruleId: this.meta.id,
        category: this.meta.category,
        severity: this.meta.defaultSeverity,
        confidence: "certain",
        message: `Zero displacement ${original ?? `0(${op.register.register})`} can use ${operandText}`,
        loc: op.loc,
        suggestion: {
          description: `Use ${operandText}`,
          replacement,
          applicability: "safe",
        },
        notes: [
          {
            message:
              "Both spellings address the same location. vasm folds the zero displacement away under its default optimisations, in which case these bytes are those of the written form rather than of the output. An assembler that does not fold it, or vasm with optimisations off, emits the extension word and the saving is real.",
          },
        ],
        data: { operandIndex: i },
      });
    }
  },
};
