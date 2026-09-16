import type { OperandNode } from "m68k-parser";
import type { Rule } from "../../core/rule.js";
import {
  immediateOperand,
  instructionSize,
  isInstruction,
  operand,
} from "../../util/ast.js";
import { changedFlagsApplicability, sourceOperand } from "./helpers.js";

function isStDestination(op: OperandNode | undefined): boolean {
  if (!op) return false;
  switch (op.type) {
    case "data-register":
    case "address-register-indirect":
    case "address-register-indirect-postinc":
    case "address-register-indirect-predec":
    case "address-register-indirect-displacement":
    case "address-register-indirect-index":
    case "memory-indirect":
    case "absolute-address":
      return true;
    default:
      return false;
  }
}

export const preferStMinusOne: Rule = {
  meta: {
    // ST removes the explicit value or expression being stored.
    obfuscated: true,
    id: "optimization/prefer-st-minus-one",
    category: "optimization",
    defaultSeverity: "suggestion",
    description: "Prefer ST for MOVE.B #-1",
    tags: ["asp68k", "ccr"],
    docs: {
      source: "ASP68K",
      example: { source: "\tmove.b #-1,d0\n\tadd.l d1,d2" },
    },
  },
  checkLine(ctx, line, index) {
    if (!isInstruction(line, "move") || instructionSize(line) !== "b") return;
    const imm = immediateOperand(line, 0);
    const dest = operand(line, 1);
    if (!imm || imm.value.type === "string-literal" || !isStDestination(dest))
      return;
    const value = ctx.evaluate(imm.value);
    if (!value.known || value.value !== -1) return;

    const rendered = sourceOperand(ctx, line, 1);
    if (!rendered) return;
    const safety = changedFlagsApplicability(ctx, index, ["N", "Z", "V", "C"]);

    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence: safety.confidence,
      message: "MOVE.B #-1 can be encoded more compactly as ST",
      loc: line.mnemonic!.loc,
      suggestion: {
        description: `Use ST ${rendered}`,
        replacement: `st ${rendered}`,
        applicability: safety.applicability,
      },
      notes: [
        ...(safety.applicability === "safe"
          ? []
          : [
              {
                message:
                  "ST preserves CCR while MOVE.B writes N/Z/V/C; review subsequent flag use.",
              },
            ]),
      ],
    });
  },
};
