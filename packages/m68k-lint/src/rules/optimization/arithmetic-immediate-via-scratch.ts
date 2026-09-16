import type { Rule } from "../../core/rule.js";
import {
  dataRegisterOperand,
  immediateOperand,
  instructionSize,
} from "../../util/ast.js";
import { semanticMnemonic } from "../../semantics/mnemonics.js";
import { valueText } from "./helpers.js";

/**
 * A long immediate in the MOVEQ range costs two extension words; MOVEQ carries
 * it in the instruction word instead, so routing it through a dead scratch
 * register is both shorter and quicker:
 *
 *   add.l #20,d1   ->   moveq #20,d0
 *                       add.l d0,d1
 *
 * The 68040 prefers the immediate form, so the rule is gated to the targets
 * where the exchange is a win.
 *
 * ADDQ and SUBQ already cover 1..8 in a single word, so those are left alone.
 * AND/OR/EOR have no quick-immediate counterpart at any magnitude, so every
 * value in the MOVEQ range is worth rerouting for them -- confirmed with
 * 68kcounter, which shows the same win at #1 as at #100.
 */
const SCRATCH_IS_FASTER = [
  "mc68000",
  "mc68010",
  "mc68020",
  "mc68030",
  "mc68060",
  "cpu32",
];
const MNEMONICS = ["add", "sub", "and", "or", "eor"] as const;
type ScratchMnemonic = (typeof MNEMONICS)[number];

function isScratchMnemonic(
  value: string | undefined,
): value is ScratchMnemonic {
  return !!value && (MNEMONICS as readonly string[]).includes(value);
}

export const arithmeticImmediateViaScratch: Rule = {
  meta: {
    id: "optimization/arithmetic-immediate-via-scratch",
    category: "optimization",
    defaultSeverity: "suggestion",
    description:
      "Materialize a small long immediate with MOVEQ before combining it",
    tags: ["register-analysis", "scratch-register", "moveq"],
    docs: {
      source: "EAB 68000 code optimisations; Optimizing 680x0 Applications",
      example: { source: "\tand.l #100,d1\n\tmoveq #0,d0\n\trts" },
    },
  },

  checkLine(ctx, line, index) {
    const mnemonic = semanticMnemonic(line);
    if (!isScratchMnemonic(mnemonic)) return;
    if (instructionSize(line) !== "l") return;
    if (!ctx.config.processors.every((cpu) => SCRATCH_IS_FASTER.includes(cpu)))
      return;

    const immediate = immediateOperand(line, 0);
    const destination = dataRegisterOperand(line, 1);
    if (!immediate || immediate.value.type === "string-literal" || !destination)
      return;

    const value = ctx.evaluate(immediate.value);
    if (!value.known || value.value < -128 || value.value > 127) return;
    // The quick forms already reach 1..8 in one word, and the negated quick
    // forms cover -8..-1, so only the wider range is worth rerouting for
    // ADD/SUB. AND/OR/EOR have no such quick form to defer to.
    if (
      (mnemonic === "add" || mnemonic === "sub") &&
      Math.abs(value.value) <= 8
    )
      return;

    const target = destination.register.toLowerCase();
    const scratch = ctx.registers
      .deadDataRegistersAfter(index)
      .find((register) => register.toLowerCase() !== target);
    if (!scratch) return;

    const replacement = `moveq #${valueText(ctx, immediate.value, value.value)},${scratch}\n${mnemonic}.l ${scratch},${destination.register}`;

    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence: "certain",
      message: `Immediate ${value.value} fits MOVEQ, so ${scratch.toUpperCase()} can carry it instead of an extension word`,
      loc: line.mnemonic!.loc,
      suggestion: {
        description: `Load ${value.value} into ${scratch.toUpperCase()} with MOVEQ, then ${mnemonic.toUpperCase()} register to register`,
        replacement,
        applicability: "safe",
      },
      notes: [
        {
          message: `${scratch.toUpperCase()} is proven dead here, and the condition codes after the pair are the same as the original sets.`,
        },
      ],
      data: { value: value.value, scratch },
    });
  },
};
