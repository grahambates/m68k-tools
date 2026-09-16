import type { Rule } from "../../core/rule.js";
import {
  immediateOperand,
  instructionSize,
  isAddqDestination,
  isInstructionFamily,
  operand,
} from "../../util/ast.js";
import { changedFlagsApplicability, sourceOperand } from "./helpers.js";

function quickNegative(
  id: string,
  from: "add" | "sub",
  to: "subq" | "addq",
): Rule {
  return {
    meta: {
      id,
      category: "optimization",
      defaultSeverity: "suggestion",
      description: `Use ${to.toUpperCase()} for negative ${from.toUpperCase()} immediates`,
      tags: ["asp68k"],
      docs: {
        source: "ASP68K",
        example: { source: `\t${from}.l #-5,d0\n\tadd.l d1,d2` },
      },
    },
    checkLine(ctx, line, index) {
      if (!isInstructionFamily(line, from)) return;
      const imm = immediateOperand(line, 0);
      const dest = operand(line, 1);
      const size = instructionSize(line);
      if (
        !imm ||
        imm.value.type === "string-literal" ||
        !isAddqDestination(dest, size)
      )
        return;
      const value = ctx.evaluate(imm.value);
      if (!value.known || value.value < -8 || value.value > -1) return;
      // The value is the same either way, but the carry is not: ADD sets C on a
      // carry out where SUB sets it on a borrow, so the two forms leave opposite
      // C and X for the same operands. N, Z and V agree, since negating an
      // immediate in 1..8 cannot itself overflow.
      const safety = changedFlagsApplicability(ctx, index, ["X", "C"]);
      const suffix = size ? `.${size}` : "";
      const d = sourceOperand(ctx, line, 1);
      const magnitude = -value.value;
      ctx.report({
        ruleId: id,
        category: "optimization",
        severity: "suggestion",
        confidence: safety.confidence,
        message: `${from.toUpperCase()} by ${value.value} can use ${to.toUpperCase()} #${magnitude}`,
        loc: line.mnemonic!.loc,
        suggestion: {
          description: `Use ${to.toUpperCase()}`,
          replacement: d ? `${to}${suffix} #${magnitude},${d}` : undefined,
          applicability: safety.applicability,
        },
        notes: [
          {
            message:
              safety.applicability === "safe"
                ? "X and C come out opposite between the two forms, and both are unused here."
                : "X and C come out opposite between the two forms: ADD sets the carry on a carry out, SUB on a borrow.",
          },
        ],
      });
    },
  };
}
export const preferSubqForNegativeAdd = quickNegative(
  "optimization/prefer-subq-negative-add",
  "add",
  "subq",
);
export const preferAddqForNegativeSub = quickNegative(
  "optimization/prefer-addq-negative-sub",
  "sub",
  "addq",
);
