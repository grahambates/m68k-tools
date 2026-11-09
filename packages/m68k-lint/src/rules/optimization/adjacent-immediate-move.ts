import type { ExpressionNode } from "m68k-parser";
import type { Rule } from "../../core/rule.js";
import {
  immediateOperand,
  instructionSize,
  isInstruction,
  operand,
} from "../../util/ast.js";
import { isAdjacentLocation, locationOf } from "./adjacent-location.js";
import {
  embeddedValueText,
  isAuthoredExpression,
  sourceOperand,
} from "./helpers.js";
import { hex } from "../../util/format.js";

type Ctx = Parameters<NonNullable<Rule["checkLine"]>>[0];

interface Immediate {
  value: number;
  expression: ExpressionNode;
}

function immediate(
  ctx: Ctx,
  line: Parameters<NonNullable<Rule["checkLine"]>>[1],
): Immediate | undefined {
  const op = immediateOperand(line, 0);
  if (!op) return undefined;
  const result = ctx.evaluate(op.value);
  return result.known
    ? { value: result.value, expression: op.value }
    : undefined;
}

/**
 * One half of the combined immediate, as written, ready to be OR-ed in.
 *
 * Masked only when its value does not fit the half, as a negative `-1` would
 * otherwise set every bit of the other half too.
 */
function halfText(
  ctx: Ctx,
  half: Immediate,
  mask: number,
  hexWidth: number,
): string {
  const text = embeddedValueText(ctx, half.expression, half.value);
  return half.value >= 0 && half.value <= mask
    ? text
    : `(${text}&${hex(mask, hexWidth, { uppercase: false })})`;
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
      const combined =
        ((hi.value & mask) * 2 ** shift + (lo.value & mask)) >>> 0;
      const hexWidth = toSize === "w" ? 4 : 8;
      // Built from the two values as written when either is a name or an
      // expression, so `move.w #C2P_G*4` pairs keep tracking the constant
      // rather than freezing into a packed number. A half that is a bare zero
      // adds nothing and is left out.
      const symbolic =
        isAuthoredExpression(hi.expression) ||
        isAuthoredExpression(lo.expression);
      const keep = (half: Immediate) =>
        half.value !== 0 || isAuthoredExpression(half.expression);
      const halfWidth = hexWidth / 2;
      const parts = [
        ...(keep(hi)
          ? [`(${halfText(ctx, hi, mask, halfWidth)}<<${shift})`]
          : []),
        ...(keep(lo) ? [halfText(ctx, lo, mask, halfWidth)] : []),
      ];
      const literal = symbolic
        ? parts.length === 1 && parts[0].startsWith("(")
          ? parts[0].slice(1, -1)
          : parts.join("|")
        : hex(combined, hexWidth, { uppercase: false });

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
