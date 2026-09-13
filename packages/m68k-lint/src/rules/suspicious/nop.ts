import type { RuleContext } from "../../core/context.js";
import type { Rule } from "../../core/rule.js";
import { isInstruction } from "../../util/ast.js";

/**
 * A NOP immediately before RTE is a deliberate synchronisation delay, not
 * leftover padding. On Amiga, clearing the interrupt request has to reach the
 * chipset before the RTE, or a fast CPU returns while the level is still
 * asserted and the interrupt fires again; the NOP buys that time. Some handlers
 * use more than one, so a contiguous run counts.
 *
 * A label between the two is unusual but harmless: the NOP still falls through
 * to the RTE. An intervening instruction is not, since the delay then no longer
 * sits against the return.
 *
 * Not gated on `--platform amiga`. The idiom appears in Amiga sources that are
 * linted without a platform selected, and a NOP placed immediately before an
 * interrupt return is deliberate on any target. RTR is deliberately excluded.
 */
function precedesInterruptReturn(ctx: RuleContext, index: number): boolean {
  let next = ctx.nextInstruction(index);
  while (next && isInstruction(next.line, "nop"))
    next = ctx.nextInstruction(next.index);
  return next !== undefined && isInstruction(next.line, "rte");
}

export const suspiciousNop: Rule = {
  meta: {
    id: "suspicious/nop",
    category: "suspicious",
    defaultSeverity: "info",
    enabledByDefault: false,
    description: "Flag NOP instructions for review",
    tags: ["timing", "padding", "likely-intentional"],
    docs: {
      note: "A NOP immediately before RTE is exempt: it is the standard delay that lets an interrupt-request clear reach the hardware before the return.",
    },
  },

  checkLine(ctx, line, index) {
    if (!isInstruction(line, "nop")) return;
    if (precedesInterruptReturn(ctx, index)) return;

    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence: "low",
      message:
        "NOP may be intentional for timing, patching, alignment, or debugging",
      loc: line.mnemonic!.loc,
      suggestion: {
        description: "Review whether the NOP is still required",
        applicability: "manual",
      },
    });
  },
};
