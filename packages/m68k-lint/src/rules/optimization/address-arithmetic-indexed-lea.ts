import type { Rule } from "../../core/rule.js";
import {
  addressRegisterOperand,
  dataRegisterOperand,
  immediateExpressionOperand,
  instructionSize,
  isInstruction,
} from "../../util/ast.js";

function sameRegister(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function hasInterveningLabel(
  ctx: Parameters<NonNullable<Rule["checkLine"]>>[0],
  from: number,
  to: number,
): boolean {
  for (let i = from + 1; i <= to; i++) if (ctx.line(i)?.label) return true;
  return false;
}

/**
 * Flamewing address-register sequence:
 *   adda.w #disp,An / suba.w #disp,An
 *   adda.{w|l} Xn,An
 * -> lea signedDisp(An,Xn.{w|l}),An
 *
 * 68000 brief indexed addressing has an 8-bit displacement. The index may be
 * a data or address register, but it must not be the destination An because
 * the original second instruction would observe An after the first update.
 */
export const foldAddressArithmeticToIndexedLea: Rule = {
  meta: {
    // The displacement is evaluated, losing the original expression.
    obfuscated: true,
    id: "optimization/address-arithmetic-indexed-lea",
    category: "optimization",
    defaultSeverity: "suggestion",
    description:
      "Fold address immediate arithmetic plus indexed addition into LEA",
    tags: ["flamewing", "68000", "address-register", "lea", "sequence"],
    docs: { source: "Flamewing M68000 Peephole Optimizations" },
  },
  checkLine(ctx, line, index) {
    if (!ctx.config.processors.every((cpu) => cpu === "mc68000")) return;
    const add = isInstruction(line, "adda");
    const sub = isInstruction(line, "suba");
    if ((!add && !sub) || instructionSize(line) !== "w") return;

    const immediate = immediateExpressionOperand(line, 0);
    const dest = addressRegisterOperand(line, 1);
    if (!immediate || !dest) return;
    const value = ctx.evaluate(immediate);
    if (!value.known) return;
    const displacement = add ? value.value : -value.value;
    if (displacement < -128 || displacement > 127) return;

    const next = ctx.nextInstruction(index);
    if (
      !next ||
      hasInterveningLabel(ctx, index, next.index) ||
      !isInstruction(next.line, "adda")
    )
      return;
    const nextDest = addressRegisterOperand(next.line, 1);
    const indexSize = instructionSize(next.line);
    if (
      !nextDest ||
      !sameRegister(nextDest.register, dest.register) ||
      (indexSize !== "w" && indexSize !== "l")
    )
      return;

    const dataIndex = dataRegisterOperand(next.line, 0);
    const addressIndex = addressRegisterOperand(next.line, 0);
    const indexRegister = dataIndex?.register ?? addressIndex?.register;
    if (!indexRegister || sameRegister(indexRegister, dest.register)) return;

    const disp = displacement === 0 ? "" : `${displacement}`;
    const replacement = `lea ${disp}(${dest.register},${indexRegister}.${indexSize}),${dest.register}`;
    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence: "certain",
      message:
        "This address immediate adjustment and indexed addition can be folded into one LEA",
      loc: line.mnemonic!.loc,
      suggestion: {
        description: "Use one indexed LEA",
        replacement,
        applicability: "safe",
      },
      notes: [
        {
          message:
            "The signed displacement fits the 68000 brief indexed addressing range (-128..127).",
        },
      ],
      data: { secondInstructionIndex: next.index },
    });
  },
};
