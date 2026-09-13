import type { ParsedLine } from "m68k-parser";
import type { Rule } from "../../core/rule.js";
import {
  addressRegisterOperand,
  immediateOperand,
  instructionSize,
  isInstruction,
  operand,
} from "../../util/ast.js";
import { changedFlagsApplicability, valueText } from "./helpers.js";

function isSpRegister(line: ParsedLine, operandIndex: number): boolean {
  const op = addressRegisterOperand(line, operandIndex);
  return !!op && ["sp", "a7"].includes(op.register.toLowerCase());
}

function isSpPredec(line: ParsedLine, operandIndex: number): boolean {
  const op = operand(line, operandIndex);
  return (
    op?.type === "address-register-indirect-predec" &&
    op.register.type === "address-register" &&
    ["sp", "a7"].includes(op.register.register.toLowerCase())
  );
}

export const preferLinkSequence: Rule = {
  meta: {
    id: "optimization/prefer-link-sequence",
    category: "optimization",
    defaultSeverity: "suggestion",
    description: "Use LINK for a standard frame setup sequence",
    tags: ["asp68k", "stack", "peephole"],
    docs: { source: "ASP68K" },
  },
  checkLine(ctx, line, index) {
    if (!isInstruction(line, "move") || instructionSize(line) !== "l") return;
    const frame = addressRegisterOperand(line, 0);
    if (!frame || !isSpPredec(line, 1)) return;

    const second = ctx.nextInstruction(index);
    if (
      !second ||
      !isInstruction(second.line, "movea") ||
      instructionSize(second.line) !== "l"
    )
      return;
    if (!isSpRegister(second.line, 0)) return;
    const frameDest = addressRegisterOperand(second.line, 1);
    if (
      !frameDest ||
      frameDest.register.toLowerCase() !== frame.register.toLowerCase()
    )
      return;

    const third = ctx.nextInstruction(second.index);
    if (
      !third ||
      (!isInstruction(third.line, "add") &&
        !isInstruction(third.line, "adda") &&
        !isInstruction(third.line, "addq"))
    )
      return;
    const thirdSize = instructionSize(third.line);
    if (
      (thirdSize !== "w" && thirdSize !== "l") ||
      !isSpRegister(third.line, 1)
    )
      return;
    const imm = immediateOperand(third.line, 0);
    if (!imm || imm.value.type === "string-literal") return;
    const value = ctx.evaluate(imm.value);
    if (!value.known || value.value < -32768 || value.value > 32767) return;

    // LINK sets no condition codes. The sequence it replaces does: the opening
    // MOVE.L of the frame pointer to -(SP) sets N and Z from the value pushed
    // and clears V and C. (The MOVEA and the ADDA are flag-free, so they
    // contribute nothing.) X is preserved either way. So the rewrite is only
    // unconditionally safe where those four are dead; the differential checker
    // caught this claiming `safe` with no check at all.
    const safety = changedFlagsApplicability(ctx, third.index, [
      "N",
      "Z",
      "V",
      "C",
    ]);

    const manual = !!second.line.label || !!third.line.label;
    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence: manual ? "high" : safety.confidence,
      message: "Standard stack-frame setup can use LINK",
      loc: line.mnemonic!.loc,
      suggestion: {
        description: `Replace the three instructions with LINK ${frame.register},#${value.value}`,
        replacement: manual
          ? undefined
          : `link ${frame.register},#${valueText(ctx, imm.value, value.value)}`,
        applicability: manual ? "manual" : safety.applicability,
      },
      notes: [
        ...(safety.applicability === "safe"
          ? []
          : [
              {
                message:
                  "LINK leaves the condition codes untouched where the MOVE sets N and Z; review later CCR use.",
              },
            ]),
        ...(manual
          ? [
              {
                message:
                  "A later instruction in the matched sequence has a label; preserve any externally reachable entry point.",
              },
            ]
          : []),
      ],
      data: {
        secondInstructionIndex: second.index,
        thirdInstructionIndex: third.index,
      },
    });
  },
};
