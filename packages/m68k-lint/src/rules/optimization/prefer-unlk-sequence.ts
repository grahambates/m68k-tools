import type { ParsedLine } from "m68k-parser";
import type { Rule } from "../../core/rule.js";
import {
  addressRegisterOperand,
  instructionSize,
  isInstruction,
  operand,
} from "../../util/ast.js";

function isSpRegister(line: ParsedLine, operandIndex: number): boolean {
  const op = addressRegisterOperand(line, operandIndex);
  return !!op && ["sp", "a7"].includes(op.register.toLowerCase());
}

function isSpPostinc(line: ParsedLine, operandIndex: number): boolean {
  const op = operand(line, operandIndex);
  return (
    op?.type === "address-register-indirect-postinc" &&
    op.register.type === "address-register" &&
    ["sp", "a7"].includes(op.register.register.toLowerCase())
  );
}

export const preferUnlkSequence: Rule = {
  meta: {
    id: "optimization/prefer-unlk-sequence",
    category: "optimization",
    defaultSeverity: "suggestion",
    description: "Use UNLK for a standard two-instruction frame teardown",
    tags: ["asp68k", "stack", "peephole"],
    docs: { source: "ASP68K" },
  },
  checkLine(ctx, line, index) {
    if (!isInstruction(line, "movea") || instructionSize(line) !== "l") return;
    const frame = addressRegisterOperand(line, 0);
    if (!frame || !isSpRegister(line, 1)) return;

    const next = ctx.nextInstruction(index);
    if (
      !next ||
      !isInstruction(next.line, "movea") ||
      instructionSize(next.line) !== "l"
    )
      return;
    if (!isSpPostinc(next.line, 0)) return;
    const restored = addressRegisterOperand(next.line, 1);
    if (
      !restored ||
      restored.register.toLowerCase() !== frame.register.toLowerCase()
    )
      return;

    const manual = !!next.line.label;
    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence: manual ? "high" : "certain",
      message: "Standard frame teardown can use UNLK",
      loc: line.mnemonic!.loc,
      suggestion: {
        description: `Replace the pair with UNLK ${frame.register}`,
        replacement: manual ? undefined : `unlk ${frame.register}`,
        applicability: manual ? "manual" : "safe",
      },
      notes: [
        ...(manual
          ? [
              {
                message:
                  "The second instruction has a label; preserve externally reachable control-flow when rewriting.",
              },
            ]
          : []),
      ],
      data: { secondInstructionIndex: next.index },
    });
  },
};
