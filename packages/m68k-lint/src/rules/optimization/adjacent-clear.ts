import type { Rule } from "../../core/rule.js";
import { instructionSize, isInstruction, operand } from "../../util/ast.js";
import { isAdjacentLocation, locationOf } from "./adjacent-location.js";
import { sourceOperand } from "./helpers.js";

function hasInterveningLabel(
  ctx: Parameters<NonNullable<Rule["checkLine"]>>[0],
  from: number,
  to: number,
): boolean {
  for (let i = from + 1; i <= to; i++) if (ctx.line(i)?.label) return true;
  return false;
}

function clearPair(
  fromSize: "b" | "w",
  toSize: "w" | "l",
  delta: number,
  id: string,
): Rule {
  return {
    meta: {
      // The wider clear hides the second destination and its field boundary.
      obfuscated: true,
      id,
      category: "optimization",
      defaultSeverity: "suggestion",
      description: `Combine adjacent CLR.${fromSize.toUpperCase()} writes`,
      tags: ["asp68k", "peephole", "memory"],
      docs: { source: "ASP68K" },
    },
    checkLine(ctx, line, index) {
      if (!isInstruction(line, "clr") || instructionSize(line) !== fromSize)
        return;
      const first = operand(line, 0);
      const a = locationOf(ctx, first);
      if (a === undefined) return;
      const next = ctx.nextInstruction(index);
      if (
        !next ||
        hasInterveningLabel(ctx, index, next.index) ||
        !isInstruction(next.line, "clr") ||
        instructionSize(next.line) !== fromSize
      )
        return;
      const b = locationOf(ctx, operand(next.line, 0));
      if (!b || !isAdjacentLocation(a, b, delta)) return;
      const rendered = sourceOperand(ctx, line, 0);
      if (!rendered) return;

      ctx.report({
        ruleId: id,
        category: "optimization",
        severity: "suggestion",
        confidence: "high",
        message: `Adjacent CLR.${fromSize.toUpperCase()} writes can be combined into CLR.${toSize.toUpperCase()}`,
        loc: line.mnemonic!.loc,
        suggestion: {
          description: `Use CLR.${toSize} ${rendered}`,
          replacement: `clr.${toSize} ${rendered}`,
          applicability: "conditional",
        },
        notes: [
          {
            message:
              "Manual review required: combining bus accesses can change behaviour for memory-mapped I/O, device registers, or fault boundaries.",
          },
        ],
        data: { secondInstructionIndex: next.index },
      });
    },
  };
}

export const combineAdjacentClrBytes = clearPair(
  "b",
  "w",
  1,
  "optimization/combine-adjacent-clr-bytes",
);
export const combineAdjacentClrWords = clearPair(
  "w",
  "l",
  2,
  "optimization/combine-adjacent-clr-words",
);
