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
import {
  changedFlagsApplicability,
  containsSymbol,
  embeddedValueText,
  isPowerOfTwo,
  negatedValueText,
} from "./helpers.js";
import {
  shiftInstructions,
  signedCycles,
  signedReciprocals,
  undominated,
  unsignedCycles,
  unsignedReciprocals,
  widest,
  type Reciprocal,
} from "./reciprocal.js";

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
    expression: expr,
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

    // Rounds the same way DIVS.W does, at the cost of a few more instructions
    // that add 2^k-1 to a negative dividend before shifting -- a real,
    // selectable alternative to the plain shift above wherever a register is
    // free for it, not just a caveat about it.
    const exactAlternatives = scratch
      ? exact.map((r) => ({
          ruleId: this.meta.id,
          category: this.meta.category,
          severity: this.meta.defaultSeverity,
          confidence:
            c.upperUse === "unused" ? ("medium" as const) : ("low" as const),
          message: `DIVS.W by ${c.divisor} can round toward zero exactly, the way DIVS.W does${r.bits >= 31 ? "" : `, if the dividend is a sign-extended word (${between(r)})`}`,
          loc: line.mnemonic!.loc,
          suggestion: {
            description: `Round toward zero exactly, clobbers ${scratch.toUpperCase()}${r.bits >= 31 ? "" : ` (exact for a dividend ${between(r)})`}`,
            replacement: render(r, c.dest, scratch, negate),
            applicability: "conditional" as const,
          },
          notes: [
            { message: remainderNote(c.dest, c.upperUse) },
            { message: overflow },
            {
              message: `${scratch.toUpperCase()} is proven dead after the original divide and is used as scratch.`,
            },
            ...(c.xUnknown ? [{ message: xNote }] : []),
          ],
          data: {
            divisor: c.divisor,
            upperWordUse: c.upperUse,
            scratch,
            exactBits: r.bits,
          },
        }))
      : [];

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
          ? []
          : [
              {
                message:
                  "No register is free for the form that rounds toward zero, which adds 2^k-1 to a negative dividend before shifting.",
              },
            ]),
        ...(c.xUnknown ? [{ message: xNote }] : []),
      ],
      data: { divisor: c.divisor, shift, scratch, upperWordUse: c.upperUse },
      alternatives: exactAlternatives,
    });
  },
};

/**
 * DIVS.W by another constant, as a multiply by its reciprocal at a scale chosen
 * for the divisor. A negative dividend needs one added to its quotient to round
 * toward zero, and a negative divisor is the recipe for its magnitude followed
 * by a negation. As for the unsigned rule, a divisor that names something has
 * its multiplier written from the expression, so that it follows the constant.
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
        "Fixed-point reciprocal multiplication: the scale is chosen per divisor, with a correction for negative dividends, and the exact range checked over every dividend",
      note: "Only the quotient is produced, so the remainder in the upper word must be unused. It is not offered when that is provably used, and it is offered with lower confidence when the analysis cannot tell. The reciprocal is `ceil(scale/divisor)`, exact for every dividend in a stated range found by dividing them all; the register analysis cannot prove the dividend stays within it, so this is always a conditional suggestion. A negative divisor is the recipe for its magnitude followed by a negation. When the divisor is a named constant the multiplier is written as an expression in it, so that it follows the constant.",
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
    const negated = c.divisor < 0;
    // A power of two is a shift, which has its own rule; MULS.W's multiplier is a
    // signed word.
    if (magnitude < 3 || magnitude > 0x7fff || isPowerOfTwo(magnitude)) return;

    const candidates = undominated(signedReciprocals(magnitude));
    const primary = widest(candidates);
    if (!primary) return;

    // The recipe uses the low word of a scratch register, and nothing above it.
    const scratch = scratchRegister(ctx, index, c.dest, 0xffff);
    if (!scratch) return;

    // The divisor as the source wrote it, whether a name, a sum or a plain number,
    // as its size and not its sign: the negation is a NEG after the multiply. A
    // negative number is just its magnitude; a negative expression that names
    // something has its sign taken off, so a constant `NEG_DIV` of -10 is divided
    // in as `-NEG_DIV`.
    const written = embeddedValueText(ctx, c.expression, c.divisor);
    const named = containsSymbol(c.expression) && written !== String(c.divisor);
    const size = !negated
      ? written
      : containsSymbol(c.expression) || c.expression.type === "unary-op"
        ? negatedValueText(ctx, c.expression, magnitude)
        : String(magnitude);
    // Anything but a single name or number is parenthesised: `A*2` divided into
    // a scale is `SCALE/(A*2)`, not `SCALE/A*2`.
    // The divisor as written is already bracketed where it needs to be; a sign
    // taken off it may not be.
    const sizeText = !negated || /^[\w.$]+$/.test(size) ? size : `(${size})`;
    const scaleText = (r: Reciprocal) =>
      `$${(2 ** (16 + r.shift)).toString(16)}`;
    // The scale over the divisor: a number like 26215 says nothing about where it
    // came from, and this says how it was made, and follows the constant if there
    // is one.
    const multiplier = (r: Reciprocal) => `${scaleText(r)}/${sizeText}+1`;
    const neg = negated ? [`neg.w ${c.dest}`] : [];
    const code = (r: Reciprocal) =>
      [
        `move.w ${c.dest},${scratch}`,
        `muls.w #${multiplier(r)},${c.dest}`,
        `swap ${c.dest}`,
        ...shiftInstructions("asr", c.dest, r.shift),
        `add.w ${scratch},${scratch}`,
        `clr.w ${scratch}`,
        `addx.w ${scratch},${c.dest}`,
        ...neg,
      ].join("\n");
    const range = (r: Reciprocal) => `from ${r.min} to ${r.max}`;
    const primaryCycles = signedCycles(primary, negated);
    // A smaller scale saves the shift, but its multiplier can have more changes
    // between bits and cost more than that, so it is only offered if it is
    // cheaper. Each one left after that is a genuine tradeoff, same as the
    // unsigned rule.
    const cheaper = candidates.filter(
      (r) =>
        r.shift < primary.shift && signedCycles(r, negated) < primaryCycles,
    );

    /** The caveats specific to one candidate: what it is exact for, and its cost. */
    const candidateNotes = (r: Reciprocal) => [
      {
        message: `Scale ${scaleText(r)}, multiplier ceil(${scaleText(r)}/${magnitude}) = ${r.multiplier}, plus one for a negative dividend so that it rounds toward zero: exact for every dividend ${range(r)}, found by dividing them all. This is only correct if the dividend in ${c.dest.toUpperCase()} stays within that, so it fits a signed word and the quotient cannot overflow. That cannot be proven here; check it.`,
      },
      { message: remainderNote(c.dest, c.upperUse) },
      {
        message: `The low word of ${scratch.toUpperCase()} is proven dead and is used as scratch.`,
      },
      ...(c.xUnknown ? [{ message: xNote }] : []),
    ];
    const confidence =
      c.upperUse === "unused" ? ("medium" as const) : ("low" as const);
    // Widest and cheapest first, same as the unsigned rule.
    const alternatives = cheaper
      .slice()
      .reverse()
      .map((r) => ({
        ruleId: this.meta.id,
        category: this.meta.category,
        severity: this.meta.defaultSeverity,
        confidence,
        message: `DIVS.W ${named ? `by ${written}` : `#${c.divisor}`},${c.dest.toUpperCase()} can use a smaller-scale reciprocal multiply if the dividend is ${range(r)}`,
        loc: line.mnemonic!.loc,
        suggestion: {
          description: `Multiply by the reciprocal of ${named ? written : c.divisor}, smaller scale (exact for dividends ${range(r)})`,
          replacement: code(r),
          applicability: "conditional" as const,
        },
        notes: candidateNotes(r),
        data: {
          divisor: c.divisor,
          upperWordUse: c.upperUse,
          scratch,
          dividendRange: [r.min, r.max],
          named,
        },
      }));

    // A dividend that is never negative does not need the correction for
    // rounding toward zero, and the unsigned recipe is cheaper. It has to stay
    // within a non-negative word.
    const unsignedPrimary = widest(undominated(unsignedReciprocals(magnitude)));
    const notNegative =
      unsignedPrimary && unsignedPrimary.max >= 255
        ? unsignedPrimary
        : undefined;

    // Recipes made for this value, which cannot follow a named constant: a
    // multiplier with fewer set bits, or shifts and adds. They clobber the whole
    // of a scratch register if they use one.
    const wholeScratch = ctx.registers
      .deadDataRegistersAfter(index)
      .find((r) => r !== c.dest.toLowerCase());
    const negation = negated ? NEGATE_CYCLES.w : 0;
    const specific = named
      ? []
      : (divsRecipes[magnitude] ?? []).filter(
          (r) =>
            Math.min(2 ** r.bits, 2 ** 15) <=
              Math.min(-primary.min, primary.max + 1) &&
            cyclesOf(r, negated ? "w" : undefined) < primaryCycles,
        );
    const specificUnsigned = named
      ? []
      : (divideRecipes[magnitude] ?? []).filter(
          (r) =>
            r.bits <= 15 &&
            (!r.scratch || wholeScratch) &&
            cyclesOf(r, negated ? "w" : undefined) < primaryCycles,
        );

    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence,
      message: `DIVS.W ${named ? `by ${written}` : `#${c.divisor}`},${c.dest.toUpperCase()} can be a reciprocal multiply if the dividend is ${range(primary)}`,
      loc: line.mnemonic!.loc,
      suggestion: {
        description: `Multiply by the reciprocal of ${named ? written : c.divisor} (exact for dividends ${range(primary)})`,
        replacement: code(primary),
        applicability: "conditional",
      },
      notes: [
        ...candidateNotes(primary),
        ...(named
          ? [
              {
                message: `The multiplier is worked out by the assembler from ${size}, so it follows the constant. That was checked for ${written} = ${c.divisor} only: a value that is a power of two, one that needs a multiplier over 32767, or one that shrinks the range above would not be caught.`,
              },
            ]
          : []),
        ...(notNegative
          ? [
              {
                message: `If the dividend is also never negative and no more than ${Math.min(notNegative.max, 32767)}, no correction is needed: ${oneLine(
                  [
                    `mulu.w #${scaleText(notNegative)}/${sizeText}+1,${c.dest}`,
                    `swap ${c.dest}`,
                    ...shiftInstructions("lsr", c.dest, notNegative.shift),
                    ...neg,
                  ].join("\n"),
                )} (${unsignedCycles(notNegative) + negation} cycles).`,
              },
            ]
          : []),
        ...specific
          .slice()
          .reverse()
          .map((r) => ({
            message: `Made for ${magnitude} and not written from an expression, if the dividend is ${between(r)}: ${oneLine(render(r, c.dest, scratch, negated ? "w" : undefined))} (${cyclesOf(r, negated ? "w" : undefined)} cycles).`,
          })),
        ...specificUnsigned
          .slice()
          .reverse()
          .map((r) => ({
            message: `Made for ${magnitude} and not written from an expression, if the dividend is also never negative and below ${2 ** r.bits}: ${oneLine(render(r, c.dest, wholeScratch, negated ? "w" : undefined))} (${cyclesOf(r, negated ? "w" : undefined)} cycles${r.scratch ? `, clobbers ${wholeScratch?.toUpperCase()}` : ""}).`,
          })),
      ],
      data: {
        divisor: c.divisor,
        upperWordUse: c.upperUse,
        scratch,
        dividendRange: [primary.min, primary.max],
        named,
      },
      alternatives,
    });
  },
};
