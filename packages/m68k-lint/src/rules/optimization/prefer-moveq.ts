import type { Rule } from "../../core/rule.js";
import {
  dataRegisterOperand,
  immediateOperand,
  instructionSize,
  isInstruction,
} from "../../util/ast.js";
import { valueText } from "./helpers.js";

/**
 * The immediate as a signed long, or undefined if it does not fit in one.
 *
 * MOVE.L's immediate is 32 bits, so `$ffffff80` and `-128` name the same
 * value, and evaluation already wraps to 32 bits as the assembler does. A value
 * that has not wrapped, from a caller that does not, is folded here too.
 */
function signedLong(value: number): number | undefined {
  if (value >= -0x80000000 && value <= 0x7fffffff) return value;
  if (value > 0x7fffffff && value <= 0xffffffff) return value - 0x100000000;
  return undefined;
}

export const preferMoveq: Rule = {
  meta: {
    id: "optimization/prefer-moveq",
    category: "optimization",
    defaultSeverity: "suggestion",
    description: "Prefer MOVEQ for long immediates in the signed 8-bit range",
    tags: ["asp68k", "68000"],
    docs: { source: "ASP68K", example: { source: "\tmove.l #42,d3" } },
  },

  checkLine(ctx, line) {
    if (!isInstruction(line, "move")) return;
    if (instructionSize(line) !== "l") return;

    const source = immediateOperand(line, 0);
    const dest = dataRegisterOperand(line, 1);
    if (!source || !dest) return;

    const value = ctx.evaluate(source.value);
    if (!value.known) return;
    const signed = signedLong(value.value);
    if (signed === undefined || signed < -128 || signed > 127) return;

    // MOVEQ's operand field is a signed byte. vasm takes `$ffffff80` for -128,
    // as it wraps to 32 bits, but the signed form is the one every assembler
    // takes and the one that says what is meant, so a literal written the
    // unsigned way is given as a signed number, losing nothing but the spelling.
    const spelledUnsigned =
      source.value.type === "numeric-literal" && source.value.value !== signed;
    const written =
      signed === value.value && !spelledUnsigned
        ? valueText(ctx, source.value, value.value)
        : String(signed);

    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence: "certain",
      message: `Immediate ${signed} fits the MOVEQ signed 8-bit range`,
      loc: line.mnemonic!.loc,
      suggestion: {
        description: `Use moveq #${written},${dest.register}`,
        replacement: `moveq #${written},${dest.register}`,
        applicability: "safe",
      },
    });
  },
};
