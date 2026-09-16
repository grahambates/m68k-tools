import type { ExpressionNode } from "m68k-parser";
import type { Rule } from "../../core/rule.js";
import { isInstruction, operand } from "../../util/ast.js";

function targetSymbol(expr: ExpressionNode): string | undefined {
  if (expr.type === "symbol") return expr.name;
  if (expr.type === "group") return targetSymbol(expr.expression);
  return undefined;
}

function branchTarget(
  line: Parameters<NonNullable<Rule["checkLine"]>>[1],
): string | undefined {
  const target = operand(line, 0);
  if (!target) return undefined;

  switch (target.type) {
    case "absolute-address":
      return targetSymbol(target.address);
    case "value":
      return targetSymbol(target.value);
    default:
      return undefined;
  }
}

export const nullBranch: Rule = {
  meta: {
    id: "optimization/null-branch",
    category: "optimization",
    defaultSeverity: "suggestion",
    description:
      "Remove an unconditional branch to the immediately following label",
    tags: ["asp68k", "control-flow"],
    docs: { source: "ASP68K", example: { source: "\tbra next\nnext:\n\trts" } },
  },

  checkLine(ctx, line, index) {
    if (!isInstruction(line, "bra")) return;

    const target = branchTarget(line);
    if (!target) return;

    const normalizedTarget = target.toLowerCase();

    for (let i = index + 1; i < ctx.file.lines.length; i++) {
      const candidate = ctx.file.lines[i];
      if (!candidate) break;

      if (candidate.label?.label.toLowerCase() === normalizedTarget) {
        const canDeleteWholeLine = !line.label && !line.comment;
        ctx.report({
          ruleId: this.meta.id,
          category: this.meta.category,
          severity: this.meta.defaultSeverity,
          confidence: "certain",
          message: `BRA targets the immediately following label '${target}'`,
          loc: line.mnemonic!.loc,
          suggestion: {
            description: canDeleteWholeLine
              ? "Remove the null branch"
              : "Remove the branch instruction while preserving its label/comment",
            replacement: canDeleteWholeLine ? "" : undefined,
            applicability: canDeleteWholeLine ? "safe" : "manual",
          },
          notes: [
            {
              message:
                "The branch goes to the next instruction, so it has no effect. Keep the label: other code may target it.",
            },
          ],
        });
        return;
      }

      // Blank/comment-only lines do not break adjacency. Any statement before
      // the target means the branch is doing real control-flow work.
      if (candidate.mnemonic) return;
    }
  },
};
