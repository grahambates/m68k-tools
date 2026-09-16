import type { Rule } from "../../core/rule.js";
import {
  dataRegisterOperand,
  immediateExpressionOperand,
  instructionSize,
  isInstruction,
} from "../../util/ast.js";
import { normalizeRegister } from "../../semantics/registers.js";
import { canonicalMnemonic } from "../../semantics/mnemonics.js";
import { hasLabelBetween, sourceOperand, valueText } from "./helpers.js";

function isConditionalBranch(
  line: Parameters<NonNullable<Rule["checkLine"]>>[1],
): boolean {
  const m = canonicalMnemonic(line) ?? "";
  return m.startsWith("b") && !["bra", "bsr"].includes(m);
}

export const destructiveSmallCompareBranch: Rule = {
  meta: {
    id: "optimization/destructive-small-compare-branch",
    category: "optimization",
    defaultSeverity: "suggestion",
    description:
      "Use SUBQ for a small compare when the compared register is disposable",
    tags: ["tricks-and-traps", "68000", "compare", "branch", "ccr"],
    docs: {
      source: "Mike Morton, 68000 Tricks and Traps (BYTE, Sep 1986)",
      example: {
        source:
          "\tcmp.w #4,d0\n\tbeq target\ntarget:\n\tmoveq #0,d0\n\tadd.l d1,d2",
      },
    },
  },
  checkLine(ctx, line, index) {
    if (!isInstruction(line, "cmp")) return;
    const size = instructionSize(line);
    if (size !== "w" && size !== "l") return;
    const expr = immediateExpressionOperand(line, 0);
    const dst = dataRegisterOperand(line, 1);
    if (!expr || !dst) return;
    const value = ctx.evaluate(expr);
    if (!value.known || value.value < 1 || value.value > 8) return;
    const reg = normalizeRegister(dst.register);
    if (!reg) return;
    const next = ctx.nextInstruction(index);
    if (
      !next ||
      !isConditionalBranch(next.line) ||
      hasLabelBetween(ctx, index, next.index)
    )
      return;
    if (ctx.registers.isLiveAfter(next.index, reg) !== "dead") return;
    if (ctx.flags.isLiveAfter(next.index, "X") !== "dead") return;
    const branch = canonicalMnemonic(next.line)!;
    const branchTarget = sourceOperand(ctx, next.line, 0);
    if (!branchTarget) return;
    const branchSize = instructionSize(next.line);
    const suffix = branchSize ? `.${branchSize}` : "";

    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence: "certain",
      message: `CMP.${size.toUpperCase()} #${value.value},${reg.toUpperCase()} followed by ${branch.toUpperCase()} can use destructive SUBQ`,
      loc: line.mnemonic!.loc,
      suggestion: {
        description:
          "Use SUBQ to set the same NZVC flags because the compared register and X are dead afterwards",
        replacement: `subq.${size} #${valueText(ctx, expr, value.value)},${reg}\n${branch}${suffix} ${branchTarget}`,
        applicability: "safe",
      },
      notes: [
        {
          message:
            "Restricted to positive 1..8 immediates so SUBQ reproduces CMP subtraction flags exactly; negative ADDQ forms need separate carry-condition reasoning.",
        },
      ],
      data: { secondInstructionIndex: next.index },
    });
  },
};
