import type { Rule } from "../../core/rule.js";
import {
  immediateOperand,
  instructionSize,
  isInstruction,
  operand,
} from "../../util/ast.js";
import { isAdjacentLocation, locationOf } from "./adjacent-location.js";
import { sourceOperand } from "./helpers.js";
import { hex } from "../../util/format.js";

function immediate(
  ctx: Parameters<NonNullable<Rule["checkLine"]>>[0],
  line: Parameters<NonNullable<Rule["checkLine"]>>[1],
): number | undefined {
  const op = immediateOperand(line, 0);
  if (!op) return undefined;
  const result = ctx.evaluate(op.value);
  return result.known ? result.value : undefined;
}

function hasInterveningLabel(
  ctx: Parameters<NonNullable<Rule["checkLine"]>>[0],
  from: number,
  to: number,
): boolean {
  for (let i = from + 1; i <= to; i++) if (ctx.line(i)?.label) return true;
  return false;
}

function movePair(
  fromSize: "b" | "w",
  toSize: "w" | "l",
  delta: number,
  mask: number,
  shift: number,
  id: string,
): Rule {
  return {
    meta: {
      // Packing the immediates loses their individual values and expressions.
      obfuscated: true,
      id,
      category: "optimization",
      defaultSeverity: "suggestion",
      description: `Combine adjacent MOVE.${fromSize.toUpperCase()} immediate stores`,
      tags: ["asp68k", "peephole", "memory"],
      docs: {
        source: "ASP68K",
        example: {
          source: `\tmove.${fromSize} #1,0(a0)\n\tmove.${fromSize} #2,${delta}(a0)`,
        },
      },
    },
    checkLine(ctx, line, index) {
      if (!isInstruction(line, "move") || instructionSize(line) !== fromSize)
        return;
      const a = locationOf(ctx, operand(line, 1));
      const x = immediate(ctx, line);
      if (a === undefined || x === undefined) return;
      const next = ctx.nextInstruction(index);
      if (
        !next ||
        hasInterveningLabel(ctx, index, next.index) ||
        !isInstruction(next.line, "move") ||
        instructionSize(next.line) !== fromSize
      )
        return;
      const b = locationOf(ctx, operand(next.line, 1));
      const y = immediate(ctx, next.line);
      if (!b || !isAdjacentLocation(a, b, delta) || y === undefined) return;
      const dest = sourceOperand(ctx, line, 1);
      if (!dest) return;
      // Predecrement stores the *later* write at the lower address: two
      // `move #x,-(An)` / `move #y,-(An)` leave x at the higher address (it was
      // written first, before the pointer moved as far) and y at the lower one,
      // the reverse of every other addressing mode here, where the first write
      // ends up at the lower address. So the combined value's high half is
      // whichever operand actually landed at the lower address.
      const [hi, lo] = a.kind === "predec" ? [y, x] : [x, y];
      const combined = ((hi & mask) * 2 ** shift + (lo & mask)) >>> 0;
      const hexWidth = toSize === "w" ? 4 : 8;
      const literal = hex(combined, hexWidth, { uppercase: false });

      ctx.report({
        ruleId: id,
        category: "optimization",
        severity: "suggestion",
        confidence: "high",
        message: `Adjacent immediate MOVE.${fromSize.toUpperCase()} stores can be combined into MOVE.${toSize.toUpperCase()}`,
        loc: line.mnemonic!.loc,
        suggestion: {
          description: `Use MOVE.${toSize} #${literal},${dest}`,
          replacement: `move.${toSize} #${literal},${dest}`,
          applicability: "conditional",
        },
        notes: [
          {
            message:
              "Manual review required: wider memory accesses can change behaviour for memory-mapped I/O, device registers, or fault boundaries.",
          },
        ],
        data: { secondInstructionIndex: next.index, combinedValue: combined },
      });
    },
  };
}

export const combineAdjacentMoveBytes = movePair(
  "b",
  "w",
  1,
  0xff,
  8,
  "optimization/combine-adjacent-move-bytes",
);
export const combineAdjacentMoveWords = movePair(
  "w",
  "l",
  2,
  0xffff,
  16,
  "optimization/combine-adjacent-move-words",
);
