import type { Rule } from "../../core/rule.js";
import {
  addressRegisterOperand,
  dataRegisterOperand,
  immediateExpressionOperand,
  instructionSize,
  isInstruction,
} from "../../util/ast.js";
import { hasLabelBetween } from "./helpers.js";

function sameRegister(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * ASP68K rows 899/905:
 *   move.l Ax,Az
 *   add/sub.[wl] #n,Az
 *   add.[wl] Dx,Az
 * becomes one indexed LEA.
 *
 * The source writes MOVE.x, but MOVEA.W sign-extends Ax's low word and is not
 * equivalent to using the complete Ax value as an LEA base. We therefore only
 * accept the full-width copy.
 */
export const foldAddressExpressionToLea: Rule = {
  meta: {
    // The folded displacement no longer shows the original expression.
    obfuscated: true,
    id: "optimization/address-expression-to-lea",
    category: "optimization",
    defaultSeverity: "suggestion",
    description:
      "Fold an address-register copy plus constant/index additions into LEA",
    tags: ["asp68k", "address-register", "sequence", "lea"],
    docs: { source: "ASP68K" },
  },
  checkLine(ctx, line, index) {
    if (!isInstruction(line, "movea") || instructionSize(line) !== "l") return;
    const base = addressRegisterOperand(line, 0);
    const dest = addressRegisterOperand(line, 1);
    if (!base || !dest) return;

    const second = ctx.nextInstruction(index);
    if (!second || hasLabelBetween(ctx, index, second.index)) return;
    const secondMnemonic = isInstruction(second.line, "adda")
      ? "add"
      : isInstruction(second.line, "suba")
        ? "sub"
        : undefined;
    if (!secondMnemonic) return;
    const immediate = immediateExpressionOperand(second.line, 0);
    const secondDest = addressRegisterOperand(second.line, 1);
    const secondSize = instructionSize(second.line);
    if (
      !immediate ||
      !secondDest ||
      !sameRegister(secondDest.register, dest.register)
    )
      return;
    if (secondSize !== "w" && secondSize !== "l") return;
    const value = ctx.evaluate(immediate);
    if (!value.known || value.value < -32768 || value.value > 32767) return;
    const displacement = secondMnemonic === "add" ? value.value : -value.value;
    if (displacement < -32768 || displacement > 32767) return;

    const third = ctx.nextInstruction(second.index);
    if (!third || hasLabelBetween(ctx, second.index, third.index)) return;
    if (!isInstruction(third.line, "adda")) return;
    const dataIndex = dataRegisterOperand(third.line, 0);
    const addressIndex = addressRegisterOperand(third.line, 0);
    const indexRegister = dataIndex?.register ?? addressIndex?.register;
    const thirdDest = addressRegisterOperand(third.line, 1);
    const indexSize = instructionSize(third.line);
    if (
      !indexRegister ||
      !thirdDest ||
      !sameRegister(thirdDest.register, dest.register)
    )
      return;
    if (indexSize !== "w" && indexSize !== "l") return;
    // The index EA is computed before An is written back, but LEA's indexed
    // mode reads An as part of forming its own result -- using An as its own
    // index here would observe the wrong (pre-fold) value.
    if (sameRegister(indexRegister, dest.register)) return;

    const disp = displacement === 0 ? "" : `${displacement}`;
    const replacement = `lea ${disp}(${base.register},${indexRegister}.${indexSize}),${dest.register}`;
    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence: "certain",
      message:
        "This address copy and two additions can be folded into one indexed LEA",
      loc: line.mnemonic!.loc,
      suggestion: {
        description: "Use one indexed LEA",
        replacement,
        applicability: "safe",
      },
      notes: [],
      data: {
        secondInstructionIndex: second.index,
        thirdInstructionIndex: third.index,
      },
    });
  },
};
