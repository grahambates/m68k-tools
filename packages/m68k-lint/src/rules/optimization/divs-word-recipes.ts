import type { Rule } from "../../core/rule.js";
import type { RuleContext } from "../../core/context.js";
import { DATA_REGISTERS } from "../../semantics/registers.js";
import {
  dataRegisterOperand,
  immediateExpressionOperand,
  isInstruction,
  wordFormSize,
} from "../../util/ast.js";
import {
  divideRecipes,
  divsPowerOfTwoRecipes,
  divsRecipes,
  type DivideRecipe,
} from "./generated/divide-recipes.js";
import { changedFlagsApplicability } from "./helpers.js";

/** NEG.W Dn and NEG.L Dn on the 68000, from 68kcounter (a test checks them). */
export const NEGATE_CYCLES = { w: 4, l: 6 } as const;

/**
 * Write a recipe for these registers. For a negative divisor the quotient is
 * the negation of the one for its magnitude, since both truncate toward zero,
 * so `negate` appends a NEG at the size the recipe leaves its result.
 */
const render = (
  recipe: DivideRecipe,
  d: string,
  scratch?: string,
  negate?: "w" | "l",
) => {
  const code = recipe.code.replaceAll("%d", d).replaceAll("%s", scratch ?? "");
  return negate ? `${code}\nneg.${negate} ${d}` : code;
};

const cyclesOf = (recipe: DivideRecipe, negate?: "w" | "l") =>
  recipe.cycles + (negate ? NEGATE_CYCLES[negate] : 0);

const oneLine = (code: string) => code.replaceAll("\n", " ; ");

/** The dividends a signed recipe is exact for, as `between -32768 and 32767`. */
const between = (r: DivideRecipe) =>
  r.bits >= 31
    ? "any 32-bit value"
    : `between ${-(2 ** r.bits)} and ${2 ** r.bits - 1}`;

/** A data register, other than `dest`, whose bits in `mask` are dead. */
function scratchRegister(
  ctx: RuleContext,
  index: number,
  dest: string,
  mask: number,
): string | undefined {
  return DATA_REGISTERS.find(
    (r) =>
      r !== dest.toLowerCase() &&
      ctx.registers.registerBitsUseAfter(index, r, mask) === "unused",
  );
}

/**
 * The conditions both signed divides share. Returns the divisor's register and
 * how sure we are the remainder is unused, or undefined if the rule should stay
 * quiet.
 *
 * DIVS.W leaves its remainder in the upper word, sets N, Z, V and C from the
 * quotient, and leaves X alone. Every recipe here sets N and Z differently, and
 * all of them write X, so the flags are checked, not assumed.
 */
function context(
  ctx: RuleContext,
  line: Parameters<NonNullable<Rule["checkLine"]>>[1],
  index: number,
) {
  if (
    !ctx.config.processors.every((cpu) => cpu === "mc68000") ||
    !isInstruction(line, "divs") ||
    wordFormSize(line) !== "w"
  )
    return undefined;
  const expr = immediateExpressionOperand(line, 0);
  const dest = dataRegisterOperand(line, 1);
  if (!expr || !dest) return undefined;
  const divisor = ctx.evaluate(expr);
  if (!divisor.known) return undefined;
  // A known dividend is better folded to its quotient than divided.
  if (ctx.registers.knownConstantBefore(index, dest.register) !== undefined)
    return undefined;
  // If the remainder is provably read, a quotient-only recipe is wrong. If it is
  // merely not known to be unused, it is offered as a review, and says so.
  const upperUse = ctx.registers.upperWordUseAfter(index, dest.register);
  if (upperUse === "used") return undefined;
  const flags = changedFlagsApplicability(ctx, index, ["N", "Z", "V", "C"]);
  if (flags.applicability !== "safe") return undefined;
  // Every recipe writes X, which DIVS.W leaves alone.
  if (ctx.flags.isLiveAfter(index, "X") === "live") return undefined;
  return {
    divisor: divisor.value,
    dest: dest.register,
    upperUse,
    xUnknown: ctx.flags.isLiveAfter(index, "X") === "unknown",
  };
}

const remainderNote = (dest: string, upperUse: string) =>
  upperUse === "unused"
    ? "The upper word (DIVS.W's remainder) is provably unused, and N, Z, V and C are dead, so neither the remainder nor the different flag results matter."
    : `Check that the remainder DIVS.W leaves in the upper word of ${dest.toUpperCase()} is not used: this only produces the quotient, and the analysis cannot tell whether the register is read again. N, Z, V and C are dead.`;

const xNote =
  "These sequences also change X, which DIVS.W leaves alone, and nothing here proves X is unused afterwards.";

/**
 * DIVS.W by a power of two, as an arithmetic shift.
 *
 * The two do not round the same way: DIVS.W truncates toward zero and ASR rounds
 * toward minus infinity, so they differ, by one, for a negative dividend that
 * the divisor does not divide exactly (-3 / 2 is -1, but -3 >> 1 is -2). That is
 * a difference a great deal of code neither notices nor minds, and correcting
 * for it costs three to four times as much as the shift, so the plain shift is
 * what is offered, with the difference stated, and the exact form is listed for
 * when it matters.
 */
export const divsWordPowerOfTwo: Rule = {
  meta: {
    obfuscated: true,
    id: "optimization/divs-word-power-of-two",
    category: "optimization",
    defaultSeverity: "suggestion",
    description:
      "Replace signed word division by a power of two with an arithmetic shift when only the quotient is needed and rounding toward minus infinity is acceptable",
    tags: [
      "divide",
      "shift",
      "signed",
      "generated",
      "remainder",
      "review",
      "68000",
    ],

    docs: {
      source:
        "Generated by scripts/generate-divide-recipes.mjs (the exact forms listed in the notes)",
      note: "This is not an exact replacement. DIVS.W rounds toward zero and ASR rounds toward minus infinity, so a negative dividend that the divisor does not divide exactly gives a result one lower (-3 / 2 is -1 with DIVS.W and -2 with ASR); a non-negative dividend, or a multiple of the divisor, is exact. A negative divisor is handled by negating the result. The notes give the recipes that round the same way as DIVS.W, for when that matters. Only the quotient is produced, so the remainder must not be used, and a quotient that would overflow DIVS.W is not ruled out, so the suggestion is conditional.",
      example: {
        source: "\tdivs.w #4,d0\n\tmove.w d0,d2\n\tmoveq #0,d0\n\trts",
      },
    },
  },

  checkLine(ctx, line, index) {
    const c = context(ctx, line, index);
    if (!c) return;
    const negative = c.divisor < 0;
    const magnitude = Math.abs(c.divisor);
    const overflow =
      "This also assumes the quotient fits a signed word: DIVS.W would otherwise have overflowed and left the register unchanged.";

    // Dividing by -1 is a negation, and exact.
    if (c.divisor === -1) {
      ctx.report({
        ruleId: this.meta.id,
        category: this.meta.category,
        severity: this.meta.defaultSeverity,
        confidence: c.upperUse === "unused" ? "high" : "medium",
        message:
          "DIVS.W by -1 can be a negation if only the quotient is needed",
        loc: line.mnemonic!.loc,
        suggestion: {
          description: "Negate the low word",
          replacement: `neg.w ${c.dest}`,
          applicability: "conditional",
        },
        notes: [
          { message: remainderNote(c.dest, c.upperUse) },
          {
            message:
              "This also assumes the quotient fits a signed word: DIVS.W by -1 overflows for a dividend of -32768 and leaves the register unchanged.",
          },
          ...(c.xUnknown ? [{ message: xNote }] : []),
        ],
        data: { divisor: c.divisor, upperWordUse: c.upperUse },
      });
      return;
    }

    const exact = divsPowerOfTwoRecipes[magnitude];
    if (!exact) return;

    const scratch = ctx.registers
      .deadDataRegistersAfter(index)
      .find((r) => r !== c.dest.toLowerCase());
    const shift = Math.log2(magnitude);
    const negate = negative ? ("l" as const) : undefined;
    const shifts = [
      ...(shift <= 8
        ? [`asr.l #${shift},${c.dest}`]
        : [`asr.l #8,${c.dest}`, `asr.l #${shift - 8},${c.dest}`]),
      ...(negative ? [`neg.l ${c.dest}`] : []),
    ];

    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence: c.upperUse === "unused" ? "medium" : "low",
      message: `DIVS.W by ${c.divisor} can be an arithmetic shift${negative ? " and a negation" : ""} if only the quotient is needed and a negative dividend may round toward ${negative ? "plus" : "minus"} infinity`,
      loc: line.mnemonic!.loc,
      suggestion: {
        description: `Shift right ${shift} places${negative ? ", then negate" : ""}`,
        replacement: shifts.join("\n"),
        applicability: "conditional",
      },
      notes: [
        {
          message: negative
            ? `This rounds differently from DIVS.W for a negative dividend that is not a multiple of ${magnitude}: ASR rounds toward minus infinity where DIVS.W truncates toward zero, so after the negation the result is one higher (-3 / -2 is 1 with DIVS.W and 2 here). A non-negative dividend gives exactly the same result.`
            : `This rounds differently from DIVS.W for a negative dividend that is not a multiple of ${c.divisor}: DIVS.W truncates toward zero and ASR rounds toward minus infinity, so the result is one lower (-3 / 2 is -1 with DIVS.W and -2 with ASR). A non-negative dividend gives exactly the same result.`,
        },
        { message: remainderNote(c.dest, c.upperUse) },
        { message: overflow },
        ...(scratch
          ? exact.map((r) => ({
              message: `To round toward zero as DIVS.W does${r.bits >= 31 ? "" : `, if the dividend is a sign-extended word (${between(r)})`}: ${oneLine(render(r, c.dest, scratch, negate))} (${cyclesOf(r, negate)} cycles, clobbers ${scratch.toUpperCase()}).`,
            }))
          : [
              {
                message:
                  "No register is free for the form that rounds toward zero, which adds 2^k-1 to a negative dividend before shifting.",
              },
            ]),
        ...(c.xUnknown ? [{ message: xNote }] : []),
      ],
      data: { divisor: c.divisor, shift, scratch, upperWordUse: c.upperUse },
    });
  },
};

/**
 * DIVS.W by another constant, as a multiply by its reciprocal. MULS.W's
 * multiplier is a signed word, so fewer divisors are exact over the whole word
 * range than for the unsigned case, and a negative dividend needs one added to
 * its quotient to round toward zero.
 */
export const divsWordByConstant: Rule = {
  meta: {
    obfuscated: true,
    id: "optimization/divs-word-by-constant",
    category: "optimization",
    defaultSeverity: "suggestion",
    description:
      "Replace signed word division by a constant with a multiply by its reciprocal when only the quotient of a small dividend is needed",
    tags: [
      "divide",
      "multiply",
      "reciprocal",
      "signed",
      "generated",
      "remainder",
      "review",
      "68000",
    ],
    serves: "speed",
    docs: {
      source:
        "Generated by scripts/generate-divide-recipes.mjs (signed reciprocal multiplication with a correction for negative dividends)",
      note: "Only the quotient is produced, so the remainder in the upper word must be unused. It is not offered when that is provably used, and it is offered with lower confidence when the analysis cannot tell. Every recipe is exact only for dividends in a stated range, which the register analysis cannot prove, so this is always a conditional suggestion. A negative divisor is the recipe for its magnitude followed by a negation.",
      example: {
        source:
          "\tdivs.w #10,d0\n\tmove.w d0,d2\n\tmoveq #0,d0\n\tmoveq #0,d7\n\trts",
      },
    },
  },

  checkLine(ctx, line, index) {
    const c = context(ctx, line, index);
    if (!c) return;
    // x / -d is -(x / d), and both truncate toward zero, so a negative divisor is
    // the recipe for its magnitude followed by a negation.
    const magnitude = Math.abs(c.divisor);
    const negate = c.divisor < 0 ? ("w" as const) : undefined;
    const recipes = divsRecipes[magnitude];
    if (!recipes) return;

    // The recipes use the low word of a scratch register, and nothing above it.
    const scratch = scratchRegister(ctx, index, c.dest, 0xffff);
    if (!scratch) return;
    const widest = recipes[recipes.length - 1];
    const narrower = recipes.slice(0, -1).reverse();
    // The unsigned shift/add recipes clobber the whole of a scratch register.
    const wholeScratch = ctx.registers
      .deadDataRegistersAfter(index)
      .find((r) => r !== c.dest.toLowerCase());

    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence: c.upperUse === "unused" ? "medium" : "low",
      message: `DIVS.W #${c.divisor},${c.dest.toUpperCase()} can be a reciprocal multiply if the dividend is ${between(widest)}`,
      loc: line.mnemonic!.loc,
      suggestion: {
        description: `Multiply by the reciprocal of ${c.divisor} (valid for dividends ${between(widest)})`,
        replacement: render(widest, c.dest, scratch, negate),
        applicability: "conditional",
      },
      notes: [
        {
          message: `This is only correct if the dividend in ${c.dest.toUpperCase()} is ${between(widest)}, so it fits a signed word and the quotient cannot overflow. That cannot be proven here; check it.`,
        },
        { message: remainderNote(c.dest, c.upperUse) },
        {
          message: `The low word of ${scratch.toUpperCase()} is proven dead and is used as scratch.`,
        },
        ...narrower.map((r) => ({
          message: `If the dividend is ${between(r)}: ${oneLine(render(r, c.dest, scratch, negate))} (${cyclesOf(r, negate)} cycles).`,
        })),
        // A dividend that is never negative does not need the correction for
        // rounding toward zero, and the unsigned recipes are cheaper. It has to
        // be below 32768 to be a non-negative word, and the recipes that use a
        // whole scratch register need one.
        ...(divideRecipes[magnitude] ?? [])
          .filter((r) => r.bits <= 15 && (!r.scratch || wholeScratch))
          .reverse()
          .map((r) => ({
            message: `If the dividend is also never negative and below ${2 ** r.bits}: ${oneLine(render(r, c.dest, wholeScratch, negate))} (${cyclesOf(r, negate)} cycles${r.scratch ? `, clobbers ${wholeScratch?.toUpperCase()}` : ""}).`,
          })),
        ...(c.xUnknown ? [{ message: xNote }] : []),
      ],
      data: {
        divisor: c.divisor,
        upperWordUse: c.upperUse,
        scratch,
      },
    });
  },
};
