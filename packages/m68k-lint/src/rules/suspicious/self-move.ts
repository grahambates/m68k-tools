import type { OperandNode } from "m68k-parser";
import type { Rule } from "../../core/rule.js";
import { isInstructionFamily, operand } from "../../util/ast.js";
import { semanticMnemonic } from "../../semantics/mnemonics.js";

function sameRegister(
  a: OperandNode | undefined,
  b: OperandNode | undefined,
): string | undefined {
  if (!a || !b || a.type !== b.type) return undefined;

  if (
    a.type === "data-register" &&
    b.type === "data-register" &&
    a.register === b.register
  ) {
    return a.register;
  }

  if (
    a.type === "address-register" &&
    b.type === "address-register" &&
    a.register === b.register
  ) {
    return a.register;
  }

  return undefined;
}

export const selfMove: Rule = {
  meta: {
    id: "suspicious/self-move",
    category: "suspicious",
    defaultSeverity: "warning",
    description:
      "Flag MOVE operations whose source and destination are the same register",
    tags: ["likely-typo", "registers", "ccr"],
  },

  checkLine(ctx, line) {
    if (!isInstructionFamily(line, "move")) return;

    const semantic = semanticMnemonic(line);

    const register = sameRegister(operand(line, 0), operand(line, 1));
    if (!register) return;

    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence: "high",
      message: `MOVE uses ${register.toUpperCase()} as both source and destination`,
      loc: line.mnemonic!.loc,
      suggestion:
        semantic === "movea"
          ? {
              description: "Remove the redundant address-register self-move",
              replacement: "",
              applicability: "safe",
            }
          : {
              description: "Review whether this self-move is intentional",
              applicability: "manual",
            },
      notes:
        semantic === "movea"
          ? [
              {
                message:
                  "MOVEA preserves CCR, so a direct address-register self-move has no architectural effect.",
              },
            ]
          : [
              {
                message:
                  "MOVE updates condition codes, so this is not always safe to remove; it may be intentionally refreshing N/Z/V/C.",
              },
            ],
    });
  },
};
