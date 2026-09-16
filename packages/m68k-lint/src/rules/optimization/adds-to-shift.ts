import type { Rule } from "../../core/rule.js";
import {
  dataRegisterOperand,
  instructionSize,
  isInstruction,
} from "../../util/ast.js";
import { changedFlagsApplicability, hasLabelBetween } from "./helpers.js";

/**
 * The reverse of `optimization/shift-two-adds`, for size-focused runs.
 *
 * Doubling a register twice is the same as shifting it left by two, and costs
 * two bytes more to save two cycles. Which of those is worth having is the
 * question `--goal` answers, so this rule serves `size` and the rule it undoes
 * serves `speed`; only one of the pair is ever live. Without that they would
 * feed each other, and a fixer applying safe rewrites to a fixpoint would
 * never terminate.
 */
export const addsToShift: Rule = {
  meta: {
    id: "optimization/adds-to-shift",
    category: "optimization",
    defaultSeverity: "suggestion",
    description: "Replace a register doubled twice with a two-bit left shift",
    tags: ["asp68k", "ccr"],
    serves: "size",
    inverseOf: "optimization/shift-two-adds",
    docs: {
      source: "ASP68K",
      note: "The inverse of optimization/shift-two-adds, which trades the two bytes back for two cycles.",
      example: {
        source: "\tadd.b d0,d0\n\tadd.b d0,d0\n\tadd.l d2,d3",
        config: { goal: "size" },
      },
    },
  },

  checkLine(ctx, line, index) {
    if (!isInstruction(line, "add")) return;
    const size = instructionSize(line);
    if (size !== "b" && size !== "w") return;

    const source = dataRegisterOperand(line, 0);
    const dest = dataRegisterOperand(line, 1);
    if (
      !source ||
      !dest ||
      source.register.toLowerCase() !== dest.register.toLowerCase()
    )
      return;

    const next = ctx.nextInstruction(index);
    if (!next || hasLabelBetween(ctx, index, next.index)) return;
    if (!isInstruction(next.line, "add") || instructionSize(next.line) !== size)
      return;

    const nextSource = dataRegisterOperand(next.line, 0);
    const nextDest = dataRegisterOperand(next.line, 1);
    const register = dest.register.toLowerCase();
    if (
      nextSource?.register.toLowerCase() !== register ||
      nextDest?.register.toLowerCase() !== register
    )
      return;

    const shift = `lsl.${size} #2,${dest.register}`;
    const safety = changedFlagsApplicability(ctx, next.index, [
      "X",
      "N",
      "Z",
      "V",
      "C",
    ]);
    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence: safety.confidence,
      message: `${dest.register.toUpperCase()} is doubled twice, which is a two-bit left shift`,
      loc: line.mnemonic!.loc,
      suggestion: {
        description: `Use ${shift.toUpperCase()}`,
        replacement: shift,
        applicability: safety.applicability,
      },
      notes: [
        ...(safety.applicability === "safe"
          ? []
          : [
              {
                message:
                  "Repeated ADD and a multi-bit shift do not leave the same flags; review CCR use.",
              },
            ]),
      ],
      data: { secondInstructionIndex: next.index },
    });
  },
};
