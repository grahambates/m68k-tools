import type { Rule } from "../../core/rule.js";
import { isInstruction } from "../../util/ast.js";
import { hasLabelBetween, sourceOperand } from "./helpers.js";

function makeTailCallRule(
  id: string,
  from: "jsr" | "bsr",
  to: "jmp" | "bra",
): Rule {
  return {
    meta: {
      id,
      category: "optimization",
      defaultSeverity: "suggestion",
      description: `Replace ${from.toUpperCase()} followed by RTS with ${to.toUpperCase()}`,
      tags: ["asp68k", "control-flow", "tail-call"],
      docs: {
        source: "ASP68K",
        example: { source: `\t${from} Sub\n\trts` },
      },
    },

    checkLine(ctx, line, index) {
      if (!isInstruction(line, from)) return;
      const next = ctx.nextInstruction(index);
      if (!next || !isInstruction(next.line, "rts")) return;

      const target = sourceOperand(ctx, line, 0);
      if (!target) return;

      // A label anywhere in the pair may be branched to from elsewhere, and
      // folding them away would take it with them. There is no single rewrite
      // that preserves such an entry point, so it stays a manual judgement;
      // everything else is the ordinary tail call, whose only catch is a
      // condition we can state. The label is often on its own line above the
      // RTS rather than sharing it, so the whole span has to be checked.
      const labelled = hasLabelBetween(ctx, index, next.index);

      ctx.report({
        ruleId: id,
        category: "optimization",
        severity: "suggestion",
        confidence: "high",
        message: `${from.toUpperCase()} followed by RTS is a tail-call candidate`,
        loc: line.mnemonic!.loc,
        suggestion: {
          description: `Replace the pair with ${to.toUpperCase()} ${target}`,
          replacement: labelled ? undefined : `${to} ${target}`,
          applicability: labelled ? "manual" : "conditional",
        },
        notes: [
          {
            message: `${to.toUpperCase()} leaves one fewer return address on the stack than ${from.toUpperCase()} + RTS, so the callee must not read arguments relative to SP or otherwise depend on the depth.`,
          },
          ...(labelled
            ? [
                {
                  message:
                    "A label inside the pair may be an externally reachable entry point; preserve it when rewriting.",
                },
              ]
            : []),
        ],
        data: { secondInstructionIndex: next.index },
      });
    },
  };
}

export const jsrRtsTailCall = makeTailCallRule(
  "optimization/jsr-rts-tail-call",
  "jsr",
  "jmp",
);
export const bsrRtsTailCall = makeTailCallRule(
  "optimization/bsr-rts-tail-call",
  "bsr",
  "bra",
);
