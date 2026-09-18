import type { Rule } from "../../core/rule.js";
import { findStackImbalances } from "../../analysis/stack-depth.js";

const bytes = (n: number) => `${n} ${n === 1 ? "byte" : "bytes"}`;

/**
 * A routine that returns with something still on the stack, or reaches one
 * point with different amounts pushed depending on the path.
 *
 * RTS pops whatever is on top as the return address, so a leftover push sends
 * execution to the wrong place. The other form -- paths that disagree -- is
 * the same mistake waiting for whichever path runs second.
 */
export const unbalancedStack: Rule = {
  meta: {
    id: "suspicious/unbalanced-stack",
    category: "suspicious",
    defaultSeverity: "warning",
    description:
      "Flag a routine that returns with pushed data still on the stack, or reaches a point with different stack depths",
    tags: ["stack", "control-flow"],
    docs: {
      note: "Follows pushes and pops through -(sp), (sp)+, MOVEM, PEA, LINK/UNLK and adjustments of SP. Each global label starts a routine with nothing pushed. Calls and traps are assumed to leave the stack as they found it. Stays silent once anything it cannot follow, such as a macro or an unmodelled write to SP, has been reached. Popping more than was pushed is not reported, since removing caller-pushed arguments is a valid convention.",
    },
  },

  checkFile(ctx) {
    const findings = findStackImbalances(ctx.file, (expr) => {
      const result = ctx.evaluate(expr);
      return result.known ? result.value : undefined;
    });

    for (const finding of findings) {
      const line = ctx.line(finding.index);
      if (!line?.mnemonic) continue;

      if (finding.kind === "leftover") {
        ctx.report({
          ruleId: this.meta.id,
          category: this.meta.category,
          severity: this.meta.defaultSeverity,
          confidence: "high",
          message: `${line.mnemonic.type === "instruction" ? line.mnemonic.instruction.toUpperCase() : "Return"} with ${bytes(finding.depth)} still pushed on the stack`,
          loc: line.mnemonic.loc,
          notes: [
            {
              message:
                "The return address is taken from the top of the stack, so the routine returns to the wrong place. Pop what was pushed before returning.",
            },
          ],
          suggestion: {
            description: `Remove ${bytes(finding.depth)} from the stack before returning`,
            applicability: "manual",
          },
          data: { depth: finding.depth },
        });
      } else {
        const [first, second] = finding.depths;
        ctx.report({
          ruleId: this.meta.id,
          category: this.meta.category,
          severity: this.meta.defaultSeverity,
          confidence: "medium",
          message: `Paths reaching here disagree about the stack: ${bytes(first)} pushed on one, ${bytes(second)} on another`,
          loc: line.mnemonic.loc,
          notes: [
            {
              message:
                "One path pushes or pops something the other does not, so whatever pops or returns after this point is right for only one of them.",
            },
          ],
          suggestion: {
            description: "Make every path leave the same amount on the stack",
            applicability: "manual",
          },
          data: { depths: finding.depths },
        });
      }
    }
  },
};
