import type { Rule } from "../../core/rule.js";
import {
  dataRegisterOperand,
  immediateExpressionOperand,
  instructionSize,
  isInstruction,
  operand,
} from "../../util/ast.js";
import {
  changedFlagsApplicability,
  hasLabelBetween,
  sourceOperand,
  valueText,
} from "./helpers.js";

/**
 * A load followed by a masking AND with a MOVEQ-sized constant is shorter the
 * other way round: seed the register with MOVEQ, which carries its value in the
 * instruction word, then AND the memory operand straight in. The immediate then
 * costs nothing instead of an extension word.
 *
 *   move.l (a0),d0        moveq #$3f,d0
 *   and.l  #$3f,d0   ->   and.l (a0),d0
 */
export const maskViaMoveq: Rule = {
  meta: {
    id: "optimization/mask-via-moveq",
    category: "optimization",
    defaultSeverity: "suggestion",
    description:
      "Seed a MOVEQ mask and AND the source in, rather than loading then masking",
    tags: ["constant", "ccr"],
    docs: { source: "EAB 68000 code optimisations" },
  },

  checkLine(ctx, line, index) {
    if (!isInstruction(line, "move") || instructionSize(line) !== "l") return;
    const loaded = dataRegisterOperand(line, 1);
    const source = operand(line, 0);
    if (!loaded || !source) return;
    // The source has to be re-readable in the AND's place, so an operand with
    // side effects or one that depends on the loaded register is out. A fixed
    // displacement has neither problem -- it addresses the same location the
    // second time as the first.
    if (
      source.type !== "address-register-indirect" &&
      source.type !== "address-register-indirect-displacement" &&
      source.type !== "absolute-address"
    )
      return;

    const next = ctx.nextInstruction(index);
    if (!next || hasLabelBetween(ctx, index, next.index)) return;
    if (!isInstruction(next.line, "and") || instructionSize(next.line) !== "l")
      return;

    const target = dataRegisterOperand(next.line, 1);
    if (
      !target ||
      target.register.toLowerCase() !== loaded.register.toLowerCase()
    )
      return;
    const immediate = immediateExpressionOperand(next.line, 0);
    if (!immediate) return;
    const mask = ctx.evaluate(immediate);
    // MOVEQ carries a signed 8-bit value; outside that the seed needs its own
    // extension word and the exchange gains nothing.
    if (!mask.known || mask.value < -128 || mask.value > 127) return;

    const sourceText = sourceOperand(ctx, line, 0);
    if (!sourceText) return;

    const register = loaded.register;
    const replacement = `moveq #${valueText(ctx, immediate, mask.value)},${register}\nand.l ${sourceText},${register}`;
    // MOVEQ sets N/Z from the seed and clears V/C, then AND sets them from the
    // result, so the final CCR matches. The intermediate state differs, which
    // only matters if something reads flags between the two instructions.
    const safety = changedFlagsApplicability(ctx, index, ["N", "Z", "V", "C"]);

    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence: safety.confidence,
      message: `Loading ${sourceText} then masking with #${mask.value} is shorter as MOVEQ plus AND`,
      loc: line.mnemonic!.loc,
      suggestion: {
        description: `Seed ${register.toUpperCase()} with the mask, then AND ${sourceText} in`,
        replacement,
        applicability: safety.applicability,
      },
      notes: [
        {
          message:
            "The final value and CCR are the same; only the state between the two instructions differs.",
        },
      ],
      data: { mask: mask.value, sourceEndIndex: next.index },
    });
  },
};
