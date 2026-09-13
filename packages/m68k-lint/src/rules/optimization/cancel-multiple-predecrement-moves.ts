import type { Rule } from "../../core/rule.js";
import {
  addressRegisterOperand,
  predecrementAddressRegister,
  immediateExpressionOperand,
  instructionSize,
  isInstruction,
} from "../../util/ast.js";
import {
  normalizeRegister,
  registersReadByOperand,
} from "../../semantics/registers.js";
import { hasLabelBetween, sourceOperand } from "./helpers.js";

function predecrementRegister(
  line: Parameters<NonNullable<Rule["checkLine"]>>[1],
): string | undefined {
  const dst = predecrementAddressRegister(line, 1);
  return dst ? normalizeRegister(dst.register) : undefined;
}

export const cancelMultiplePredecrementMoves: Rule = {
  meta: {
    id: "optimization/cancel-multiple-predecrement-moves",
    category: "optimization",
    defaultSeverity: "suggestion",
    description:
      "Cancel an address ADDQ against two following predecrement stores",
    tags: ["asp68k", "sequence", "address-register"],
    docs: { source: "ASP68K" },
  },
  checkLine(ctx, line, index) {
    if (!isInstruction(line, "addq")) return;
    const qImm = immediateExpressionOperand(line, 0);
    const ar = addressRegisterOperand(line, 1);
    if (!qImm || !ar) return;
    const q = ctx.evaluate(qImm);
    if (!q.known || (q.value !== 6 && q.value !== 8)) return;
    const addr = normalizeRegister(ar.register);
    if (!addr) return;

    const first = ctx.nextInstruction(index);
    if (
      !first ||
      hasLabelBetween(ctx, index, first.index) ||
      !isInstruction(first.line, "move")
    )
      return;
    const second = ctx.nextInstruction(first.index);
    if (
      !second ||
      hasLabelBetween(ctx, first.index, second.index) ||
      !isInstruction(second.line, "move")
    )
      return;

    const s1 = instructionSize(first.line);
    const s2 = instructionSize(second.line);
    const widths = [
      s1 === "w" ? 2 : s1 === "l" ? 4 : 0,
      s2 === "w" ? 2 : s2 === "l" ? 4 : 0,
    ] as const;
    if (!widths[0] || !widths[1] || widths[0] + widths[1] !== q.value) return;
    if (
      predecrementRegister(first.line) !== addr ||
      predecrementRegister(second.line) !== addr
    )
      return;

    // Original ADDQ changes An before either source EA is evaluated. The folded
    // form leaves An unchanged, so both source EAs must be independent of An.
    if (
      registersReadByOperand(first.line.operands?.[0]).has(addr) ||
      registersReadByOperand(second.line.operands?.[0]).has(addr)
    )
      return;

    const src1 = sourceOperand(ctx, first.line, 0);
    const src2 = sourceOperand(ctx, second.line, 0);
    if (!src1 || !src2) return;

    const firstOffset = widths[1];
    const firstDst = `${firstOffset}(${ar.register})`;
    const replacement = `move.${s1} ${src1},${firstDst}\nmove.${s2} ${src2},(${ar.register})`;

    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence: "certain",
      message: `ADDQ #${q.value},${ar.register.toUpperCase()} is cancelled by the following ${widths[0]}+${widths[1]} byte predecrements`,
      loc: line.mnemonic!.loc,
      suggestion: {
        description:
          "Use fixed displacements and remove the cancelling address updates",
        replacement,
        applicability: "safe",
      },
      notes: [
        {
          message:
            "Both source effective addresses are independent of the adjusted address register, which the fold requires.",
        },
      ],
      data: {
        secondInstructionIndex: first.index,
        thirdInstructionIndex: second.index,
      },
    });
  },
};
