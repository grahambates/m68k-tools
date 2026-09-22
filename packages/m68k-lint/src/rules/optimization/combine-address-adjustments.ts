import type { ExpressionNode, ParsedLine } from "m68k-parser";
import type { RuleContext } from "../../core/context.js";
import type { Rule } from "../../core/rule.js";
import {
  immediateOperand,
  instructionSize,
  isInstruction,
  operand,
} from "../../util/ast.js";
import {
  additiveTermText,
  hasLabelBetween,
  isAuthoredExpression,
  negatedValueText,
  sourceOperand,
  sumText,
} from "./helpers.js";

/** LEA's displacement, and ADDA.W's immediate, are signed 16-bit. */
const WORD_MIN = -0x8000;
const WORD_MAX = 0x7fff;

interface Adjustment {
  /** Canonical register name, so `sp` and `a7` are the same register. */
  register: string;
  /** Signed change to the register. */
  delta: number;
  /** ADDQ.L, which combine-consecutive-addq already folds. */
  quickLong: boolean;
  /**
   * The change as the author wrote it, and its negation, when that was more
   * than a number: a name, or a sum such as `4*2`. Absent for a bare number.
   */
  written?: { plus: string; minus: string };
}

function registerName(name: string): string {
  const lower = name.toLowerCase();
  return lower === "sp" ? "a7" : lower;
}

/**
 * A line that only adds a literal constant to an address register: ADDQ/SUBQ,
 * ADD/ADDA/SUB/SUBA with an immediate, or LEA d(An),An onto the same register.
 * A value the author wrote as an expression keeps that expression in the fold.
 */
function adjustment(
  ctx: RuleContext,
  line: ParsedLine,
): Adjustment | undefined {
  const dest = operand(line, 1);
  if (dest?.type !== "address-register") return undefined;
  const register = registerName(dest.register);

  if (isInstruction(line, "lea")) {
    const source = operand(line, 0);
    if (
      source?.type === "address-register-indirect" &&
      source.register.type === "address-register" &&
      registerName(source.register.register) === register
    )
      return { register, delta: 0, quickLong: false };
    if (
      source?.type !== "address-register-indirect-displacement" ||
      source.displacementSize ||
      source.register.type !== "address-register" ||
      registerName(source.register.register) !== register
    )
      return undefined;
    const value = ctx.evaluate(source.displacement);
    if (!value.known || value.value < WORD_MIN || value.value > WORD_MAX)
      return undefined;
    return {
      register,
      delta: value.value,
      quickLong: false,
      written: writtenChange(ctx, source.displacement, value.value, false),
    };
  }

  const subtract =
    isInstruction(line, "subq") ||
    isInstruction(line, "suba") ||
    isInstruction(line, "sub");
  const add =
    isInstruction(line, "addq") ||
    isInstruction(line, "adda") ||
    isInstruction(line, "add");
  if (!add && !subtract) return undefined;

  // Unsized forms are left to the assembler's default rather than guessed at.
  const size = instructionSize(line);
  if (size !== "w" && size !== "l") return undefined;
  const immediate = immediateOperand(line, 0);
  if (!immediate) return undefined;
  const value = ctx.evaluate(immediate.value);
  if (!value.known) return undefined;

  const quick = isInstruction(line, "addq") || isInstruction(line, "subq");
  if (quick && (value.value < 1 || value.value > 8)) return undefined;
  // A word operand is sign-extended to 32 bits before it is added, so only
  // values that survive that round trip say what they appear to.
  if (size === "w" && (value.value < WORD_MIN || value.value > WORD_MAX))
    return undefined;
  if (size === "l" && (value.value < -0x7fffffff || value.value > 0x7fffffff))
    return undefined;

  return {
    register,
    delta: subtract ? -value.value : value.value,
    quickLong: isInstruction(line, "addq") && size === "l",
    written: writtenChange(ctx, immediate.value, value.value, subtract),
  };
}

/** How an adjustment reads as the author wrote it, if that is more than a number. */
function writtenChange(
  ctx: RuleContext,
  expression: ExpressionNode | undefined,
  value: number,
  subtract: boolean,
): Adjustment["written"] {
  if (!isAuthoredExpression(expression)) return undefined;
  const added = additiveTermText(ctx, expression, value);
  const taken = negatedValueText(ctx, expression, -value);
  return subtract
    ? { plus: taken, minus: added }
    : { plus: added, minus: taken };
}

/**
 * The cheapest single instruction that adds `delta`, within LEA's reach. When
 * the author wrote any of the values as an expression, `written` is the sum
 * they wrote, to use in place of the number.
 */
function combined(
  delta: number,
  dest: string,
  written?: { plus: string; minus: string },
): string {
  if (delta >= 1 && delta <= 8)
    return `addq.l #${written?.plus ?? delta},${dest}`;
  if (delta <= -1 && delta >= -8)
    return `subq.l #${written?.minus ?? -delta},${dest}`;
  // A displacement that opens with a bracket reads like an addressing mode.
  const text = written?.plus ?? String(delta);
  return `lea ${text.startsWith("(") ? `0+${text}` : text}(${dest}),${dest}`;
}

export const combineAddressAdjustments: Rule = {
  meta: {
    // The total can hide the separate steps and what each was for.
    obfuscated: true,
    id: "optimization/combine-address-adjustments",
    category: "optimization",
    defaultSeverity: "suggestion",
    description:
      "Combine consecutive constant adjustments of the same address register",
    tags: ["sequence", "address-register", "lea", "addq"],
    docs: {
      source:
        "Exhaustive search over 68000 instruction pairs, checked against Musashi",
      note: "Address registers have no flags, so the fold is always safe. A pair that cancels out is left alone: it is more likely a mistake than something to remove.",
      example: { source: "\tlea 32(a0),a0\n\tlea 32(a0),a0\n\tmove.l d0,(a0)" },
    },
  },

  checkLine(ctx, line, index) {
    const first = adjustment(ctx, line);
    if (!first) return;
    const next = ctx.nextInstruction(index);
    if (!next || hasLabelBetween(ctx, index, next.index)) return;
    const second = adjustment(ctx, next.line);
    if (!second || second.register !== first.register) return;

    const total = first.delta + second.delta;
    // Two adjustments that undo each other are worth a second look, not a
    // silent deletion.
    if (total === 0) return;
    if (total < WORD_MIN || total > WORD_MAX) return;
    // Two ADDQ.Ls that stay in quick range are combine-consecutive-addq's.
    if (first.quickLong && second.quickLong && total <= 8) return;

    const dest = sourceOperand(ctx, line, 1);
    if (!dest) return;
    // Each side's own text, when either was written as an expression. A side
    // that was a bare number stands for itself.
    const side = (a: Adjustment) =>
      a.written ??
      (a.delta === 0
        ? { plus: "", minus: "" }
        : { plus: String(a.delta), minus: String(-a.delta) });
    const written =
      first.written || second.written
        ? {
            plus: sumText([side(first).plus, side(second).plus]),
            minus: sumText([side(first).minus, side(second).minus]),
          }
        : undefined;
    const replacement = combined(total, dest, written);

    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence: "certain",
      message: `Two adjustments of ${first.register.toUpperCase()} can be combined into one`,
      loc: line.mnemonic!.loc,
      suggestion: {
        description: `Replace both instructions with ${replacement}`,
        replacement,
        applicability: "safe",
      },
      notes: [
        {
          message: `The two adjustments add ${total > 0 ? "+" : ""}${total} in total. Address registers have no condition codes, so nothing else changes.`,
        },
      ],
      data: { sourceEndIndex: next.index },
    });
  },
};
