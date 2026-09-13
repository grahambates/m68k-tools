import type { Rule } from "../../core/rule.js";
import {
  addressRegisterOperand,
  dataRegisterOperand,
  instructionSize,
} from "../../util/ast.js";
import type { RuleContext } from "../../core/context.js";
import { hasLabelBetween, sourceOperand, valueText } from "./helpers.js";
import { semanticMnemonic } from "../../semantics/mnemonics.js";

/**
 * Adding an index to an address register purely to dereference it is what the
 * indexed addressing mode already does:
 *
 *   add.w  d4,a0          move.l (a0,d4.w),a1
 *   move.l (a0),a1   ->
 *
 * Only valid when the adjusted address register is dead afterwards, since the
 * fold leaves it unchanged.
 *
 * Gated by target. The indexed mode is the cheaper form on the 68000 family and
 * the 68060, and exact auditing measures that. On the 68020 and 68040 the
 * preference reverses: precomputing the address into the register is faster
 * there, so folding would be a pessimisation.
 */
const INDEXED_IS_FASTER = ["mc68000", "mc68010", "mc68060"];

function targetPrefersIndexed(ctx: RuleContext): boolean {
  return ctx.config.processors.every((cpu) => INDEXED_IS_FASTER.includes(cpu));
}
export const foldIndexIntoEffectiveAddress: Rule = {
  meta: {
    id: "optimization/fold-index-into-effective-address",
    category: "optimization",
    defaultSeverity: "suggestion",
    description:
      "Fold an address-register index addition into the indexed addressing mode",
    tags: ["addressing", "address-register", "sequence"],
    docs: { source: "EAB 68000 code optimisations" },
  },

  checkLine(ctx, line, index) {
    if (!targetPrefersIndexed(ctx)) return;
    // ADD/ADDA with a data-register source and address-register destination.
    if (semanticMnemonic(line) !== "adda") return;
    const size = instructionSize(line);
    if (size !== "w" && size !== "l") return;
    const indexRegister = dataRegisterOperand(line, 0);
    const base = addressRegisterOperand(line, 1);
    if (!indexRegister || !base) return;

    const next = ctx.nextInstruction(index);
    if (!next || hasLabelBetween(ctx, index, next.index)) return;

    // The very next instruction must dereference the adjusted register, either
    // with no displacement or a fixed one -- both are the form the indexed
    // mode replaces, just carrying the displacement along.
    const operands = next.line.operands ?? [];
    const uses = operands.findIndex(
      (op) =>
        (op.type === "address-register-indirect" ||
          op.type === "address-register-indirect-displacement") &&
        op.register.type === "address-register" &&
        op.register.register.toLowerCase() === base.register.toLowerCase(),
    );
    if (uses < 0) return;
    const matched = operands[uses];

    // The fold never updates the base, so anything that reads it afterwards
    // would see a different value.
    if (ctx.registers.isLiveAfter(next.index, base.register) !== "dead") return;
    // The index register has to survive to the point of use, which it does
    // here, but it must not be the destination of the dereferencing move.
    const written = dataRegisterOperand(next.line, 1);
    if (
      written &&
      written.register.toLowerCase() === indexRegister.register.toLowerCase()
    )
      return;

    const operandText = sourceOperand(ctx, next.line, uses);
    if (!operandText) return;
    let displacement = "";
    if (matched.type === "address-register-indirect-displacement") {
      const result = ctx.evaluate(matched.displacement);
      if (!result.known || result.value !== 0)
        displacement = valueText(
          ctx,
          matched.displacement,
          result.known ? result.value : 0,
        );
    }
    const replacementOperand = `${displacement}(${base.register},${indexRegister.register}.${size})`;
    const rest = (next.line.operands ?? []).map((_, i) =>
      i === uses ? replacementOperand : sourceOperand(ctx, next.line, i),
    );
    if (rest.some((text) => text === undefined)) return;

    const mnemonicText =
      next.line.mnemonic?.type === "instruction"
        ? next.line.mnemonic.instruction
        : undefined;
    if (!mnemonicText) return;
    const suffix = instructionSize(next.line);
    const replacement = `${mnemonicText.toLowerCase()}${suffix ? `.${suffix}` : ""} ${rest.join(",")}`;

    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence: "high",
      message: `${base.register.toUpperCase()} is only adjusted to be dereferenced, which the indexed mode does directly`,
      loc: line.mnemonic!.loc,
      suggestion: {
        description: `Use ${replacementOperand} and drop the separate addition`,
        replacement,
        applicability: "safe",
      },
      notes: [
        {
          message: `${base.register.toUpperCase()} keeps its original value afterwards, which is proven unused here. ADDA does not affect the condition codes, so none are lost.`,
        },
        {
          message:
            "Only offered for the 68000 family and 68060. On the 68020 and 68040 precomputing the address into the register is the faster form.",
        },
      ],
      data: {
        base: base.register,
        index: indexRegister.register,
        sourceEndIndex: next.index,
      },
    });
  },
};
