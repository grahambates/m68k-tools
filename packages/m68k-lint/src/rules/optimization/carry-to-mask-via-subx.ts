import type { Rule } from "../../core/rule.js";
import { dataRegisterOperand, instructionSize } from "../../util/ast.js";
import { hasLabelBetween } from "./helpers.js";
import { semanticMnemonic } from "../../semantics/mnemonics.js";
import type { RuleContext } from "../../core/context.js";

/**
 * Turning the carry into an all-ones mask is a single SUBX:
 *
 *   scs   dn         subx.l dn,dn
 *   ext.w dn    ->
 *   ext.l dn
 *
 * `SUBX.L Dn,Dn` computes `Dn - Dn - X`, which is `0` or `-1`.
 *
 * The catch is that SCS reads C while SUBX reads X, and the two are not
 * interchangeable: CMP sets C and leaves X alone, so after a comparison the X
 * flag is stale. The rule therefore only fires when a single instruction is the
 * reaching definition of both flags, which is exactly the case where it set
 * them together and they agree.
 */
function sharedFlagDefinition(ctx: RuleContext, index: number): boolean {
  const carry = ctx.flags.reachingDefinitionsBefore(index, "C");
  const extend = ctx.flags.reachingDefinitionsBefore(index, "X");
  if (carry.length !== 1 || extend.length !== 1) return false;
  const [c] = carry;
  const [x] = extend;
  return (
    c.kind === "instruction" && x.kind === "instruction" && c.index === x.index
  );
}

export const carryToMaskViaSubx: Rule = {
  meta: {
    obfuscated: true,
    id: "optimization/carry-to-mask-via-subx",
    category: "optimization",
    defaultSeverity: "suggestion",
    description: "Use SUBX to turn the carry into an all-ones mask",
    tags: ["peephole", "ccr"],
    docs: { source: "EAB 68000 code optimisations" },
  },

  checkLine(ctx, line, index) {
    if (semanticMnemonic(line) !== "scs") return;
    const register = dataRegisterOperand(line, 0);
    if (!register) return;
    const name = register.register.toLowerCase();

    // SCS produces a byte, so it takes both extensions to reach a full long.
    const word = ctx.nextInstruction(index);
    if (!word || hasLabelBetween(ctx, index, word.index)) return;
    if (
      semanticMnemonic(word.line) !== "ext" ||
      instructionSize(word.line) !== "w"
    )
      return;
    if (dataRegisterOperand(word.line, 0)?.register.toLowerCase() !== name)
      return;

    const long = ctx.nextInstruction(word.index);
    if (!long || hasLabelBetween(ctx, word.index, long.index)) return;
    if (
      semanticMnemonic(long.line) !== "ext" ||
      instructionSize(long.line) !== "l"
    )
      return;
    if (dataRegisterOperand(long.line, 0)?.register.toLowerCase() !== name)
      return;

    if (!sharedFlagDefinition(ctx, index)) return;

    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence: "high",
      message: `Spreading the carry across ${register.register.toUpperCase()} is a single SUBX`,
      loc: line.mnemonic!.loc,
      suggestion: {
        description: `Use subx.l ${register.register},${register.register}`,
        replacement: `subx.l ${register.register},${register.register}`,
        applicability: "safe",
      },
      notes: [
        {
          message:
            "SCS reads C while SUBX reads X, and those differ after a CMP, which leaves X untouched. Here one instruction sets both, so they agree.",
        },
        {
          message:
            "SUBX also updates the condition codes, where SCC and EXT leave X alone and set N and Z.",
        },
      ],
      data: { register: register.register, sourceEndIndex: long.index },
    });
  },
};
