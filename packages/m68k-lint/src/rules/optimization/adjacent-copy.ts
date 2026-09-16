import type { Rule } from "../../core/rule.js";
import { instructionSize, isInstruction, operand } from "../../util/ast.js";
import {
  isAdjacentLocation,
  locationOf,
  type Location,
} from "./adjacent-location.js";
import { hasLabelBetween, sourceOperand } from "./helpers.js";

/**
 * Whether two locations could be the same memory through the same register --
 * a source and destination sharing a register (fixed or auto-increment,
 * either side) is a self-referencing copy whose combined behaviour is not
 * worth proving out here, so it is left alone rather than folded.
 */
function sameRegister(a: Location, b: Location): boolean {
  return "register" in a && "register" in b && a.register === b.register;
}

function copyPair(
  fromSize: "b" | "w",
  toSize: "w" | "l",
  delta: number,
  id: string,
): Rule {
  return {
    meta: {
      // The wider transfer hides the separate source/destination fields.
      obfuscated: true,
      id,
      category: "optimization",
      defaultSeverity: "suggestion",
      description: `Combine adjacent MOVE.${fromSize.toUpperCase()} transfers`,
      tags: ["peephole", "memory"],
      docs: {
        note: "Two MOVE instructions that each copy a value between memory (not an immediate, and not a register-list MOVEM candidate) at adjacent addresses on both sides can be replaced by one wider MOVE, the same trick used for pairs of immediate stores.",
      },
    },
    checkLine(ctx, line, index) {
      if (!isInstruction(line, "move") || instructionSize(line) !== fromSize)
        return;
      const srcA = locationOf(ctx, operand(line, 0));
      const dstA = locationOf(ctx, operand(line, 1));
      if (!srcA || !dstA || sameRegister(srcA, dstA)) return;

      const next = ctx.nextInstruction(index);
      if (
        !next ||
        hasLabelBetween(ctx, index, next.index) ||
        !isInstruction(next.line, "move") ||
        instructionSize(next.line) !== fromSize
      )
        return;

      const srcB = locationOf(ctx, operand(next.line, 0));
      const dstB = locationOf(ctx, operand(next.line, 1));
      if (!srcB || !dstB) return;
      if (
        !isAdjacentLocation(srcA, srcB, delta) ||
        !isAdjacentLocation(dstA, dstB, delta)
      )
        return;

      const src = sourceOperand(ctx, line, 0);
      const dst = sourceOperand(ctx, line, 1);
      if (!src || !dst) return;

      ctx.report({
        ruleId: id,
        category: "optimization",
        severity: "suggestion",
        confidence: "high",
        message: `Adjacent MOVE.${fromSize.toUpperCase()} transfers can be combined into MOVE.${toSize.toUpperCase()}`,
        loc: line.mnemonic!.loc,
        suggestion: {
          description: `Use MOVE.${toSize} ${src},${dst}`,
          replacement: `move.${toSize} ${src},${dst}`,
          applicability: "conditional",
        },
        notes: [
          {
            message:
              "Manual review required: wider memory accesses can change behaviour for memory-mapped I/O, device registers, or fault boundaries.",
          },
        ],
        data: { secondInstructionIndex: next.index },
      });
    },
  };
}

export const combineAdjacentCopyBytes = copyPair(
  "b",
  "w",
  1,
  "optimization/combine-adjacent-copy-bytes",
);
export const combineAdjacentCopyWords = copyPair(
  "w",
  "l",
  2,
  "optimization/combine-adjacent-copy-words",
);
