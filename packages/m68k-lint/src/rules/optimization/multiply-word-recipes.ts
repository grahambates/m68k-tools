import type { Diagnostic } from "../../core/diagnostic.js";
import type { Rule } from "../../core/rule.js";
import {
  dataRegisterOperand,
  immediateExpressionOperand,
  wordFormSize,
  isInstruction,
} from "../../util/ast.js";
import {
  changedFlagsApplicability,
  isPowerOfTwo,
  weakerConfidence,
} from "./helpers.js";
import { DATA_REGISTERS } from "../../semantics/registers.js";
import {
  mulsWordFullResultRecipes,
  mulsWordLowWordRecipes,
  muluWordLowWordRecipes,
  type MultiplyRecipe,
} from "./generated/multiply-recipes.js";
import { shiftInstructions, wordShiftCycles } from "./reciprocal.js";

/**
 * A power of two's word-only recipe, synthesized rather than looked up: it is
 * just an immediate LSL.W (or two, split at 8 places the same as any other
 * word shift), so it needs no search and has no upper bound at the generated
 * tables' 256 -- only DIVU.W/MULU.W's own 15-bit shift range. Fills a gap in
 * the generated low-word tables above that bound; below it, the generated
 * entry (identical in effect) is used instead.
 */
function powerOfTwoLowWordRecipe(
  magnitude: number,
): MultiplyRecipe | undefined {
  if (!isPowerOfTwo(magnitude)) return undefined;
  const shift = Math.log2(magnitude);
  if (shift < 1 || shift > 15) return undefined;
  return {
    cycles: wordShiftCycles(shift),
    scratch: false,
    code: shiftInstructions("lsl", "%d", shift).join("\n"),
  };
}

/**
 * A MULS.W immediate is a signed word, so a pattern above 32767 is negative:
 * \`#$fff5\` and \`#65525\` encode the same as \`#-11\`.
 */
const signedWord = (value: number) =>
  value >= 0x8000 && value <= 0xffff ? value - 0x10000 : value;

/**
 * Write a generated recipe for these registers. Signed multiplies read better
 * with arithmetic shifts, which do the same thing here.
 */
function render(
  recipe: MultiplyRecipe,
  d: string,
  s: string | undefined,
  signed: boolean,
): string {
  const code = recipe.code.replaceAll("%d", d).replaceAll("%s", s ?? "");
  return signed ? code.replace(/^lsl\./gm, "asl.") : code;
}

function m68000Only(
  ctx: Parameters<NonNullable<Rule["checkLine"]>>[0],
): boolean {
  return ctx.config.processors.every((cpu) => cpu === "mc68000");
}

/**
 * A data register the replacement may use as scratch.
 *
 * `mask` says how much of it the recipe touches. The word-only recipes write
 * the scratch with word operations, so a register whose low word is dead
 * qualifies even where its upper half carries something: that is the usual
 * case, since the code being replaced typically writes the same register with
 * a word move a moment later. The full-result recipes copy a long into it and
 * need the whole register dead.
 */
function deadScratch(
  ctx: Parameters<NonNullable<Rule["checkLine"]>>[0],
  index: number,
  dest: string,
  mask?: number,
): string | undefined {
  const skip = dest.toLowerCase();
  if (mask === undefined)
    return ctx.registers.deadDataRegistersAfter(index).find((r) => r !== skip);
  return DATA_REGISTERS.find(
    (r) =>
      r !== skip &&
      ctx.registers.registerBitsUseAfter(index, r, mask) === "unused",
  );
}

export const flamewingMulsWordFullResultConstants: Rule = {
  meta: {
    obfuscated: true,
    id: "optimization/muls-word-full-result-constants",
    category: "optimization",
    defaultSeverity: "suggestion",
    description:
      "Replace additional MULS.W constants with verified 68000 shift/add sequences",
    tags: ["flamewing", "68000", "multiply", "constant", "scratch", "ccr"],
    serves: "speed",
    docs: {
      source: "Flamewing M68000 Peephole Optimizations",
      example: { source: "\tmuls.w #11,d0\n\tmove.l d0,d2\n\trts" },
    },
  },
  checkLine(ctx, line, index) {
    if (
      !m68000Only(ctx) ||
      !isInstruction(line, "muls") ||
      wordFormSize(line) !== "w"
    )
      return;
    const expr = immediateExpressionOperand(line, 0);
    const dest = dataRegisterOperand(line, 1);
    if (!expr || !dest) return;
    const value = ctx.evaluate(expr);
    if (!value.known) return;
    const factor = signedWord(value.value);
    const recipe = mulsWordFullResultRecipes[factor];
    if (!recipe) return;
    // When the upper word is not proven used the word-only recipe is much
    // cheaper, so leave the constant to muls-word-low-word-only, which now
    // offers it there too (at lower confidence when merely unknown).
    const lowWord =
      mulsWordLowWordRecipes[factor] ?? powerOfTwoLowWordRecipe(factor);
    if (
      lowWord &&
      ctx.registers.upperWordUseAfter(index, dest.register) !== "used" &&
      (!lowWord.scratch || deadScratch(ctx, index, dest.register, 0xffff))
    )
      return;

    const scratch = recipe.scratch
      ? deadScratch(ctx, index, dest.register)
      : undefined;
    if (recipe.scratch && !scratch) return;
    // Final N/Z reflect the same 32-bit result and MULS clears V/C while preserving X.
    // The arithmetic recipe can produce different X/V/C.
    const safety = changedFlagsApplicability(ctx, index, ["X", "V", "C"]);
    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence: safety.confidence,
      message: `MULS.W #${factor},${dest.register.toUpperCase()} has a faster verified 68000 shift/add sequence`,
      loc: line.mnemonic!.loc,
      suggestion: {
        description: scratch
          ? `Replace MULS.W #${factor} using dead scratch ${scratch.toUpperCase()}`
          : `Replace MULS.W #${factor}`,
        replacement: render(recipe, dest.register, scratch, true),
        applicability: safety.applicability,
      },
      notes: [
        ...(scratch
          ? [
              {
                message: `${scratch.toUpperCase()} is proven dead after the original multiply and may be clobbered.`,
              },
            ]
          : []),
        ...(safety.applicability === "safe"
          ? []
          : [
              {
                message:
                  "X/V/C can differ from MULS.W and must not be observed.",
              },
            ]),
      ],
      data: { factor, scratch, provenance: "generated" },
    });
  },
};

const MULS_LOW_WORD_ONLY_ID = "optimization/muls-word-low-word-only";

/**
 * The MULS.W low-word-only replacement for this line, if one applies --
 * shared between the rule that offers it on its own account and
 * muls-word-power-of-two/muls-word-high-power-of-two, which offer it as a
 * cheaper alternative to their own (always-correct, always-available) full
 * extension. A power-of-two factor is left to those: this only computes it
 * for them to attach, and does not report it as its own finding for one, so
 * the two never double up on the same instruction.
 */
export function mulsLowWordOnlyDiagnostic(
  ctx: Parameters<NonNullable<Rule["checkLine"]>>[0],
  line: Parameters<NonNullable<Rule["checkLine"]>>[1],
  index: number,
): Diagnostic | undefined {
  if (
    !m68000Only(ctx) ||
    !isInstruction(line, "muls") ||
    wordFormSize(line) !== "w"
  )
    return undefined;
  const expr = immediateExpressionOperand(line, 0);
  const dest = dataRegisterOperand(line, 1);
  if (!expr || !dest) return undefined;
  const value = ctx.evaluate(expr);
  if (!value.known) return undefined;
  const factor = signedWord(value.value);
  const recipe =
    mulsWordLowWordRecipes[factor] ?? powerOfTwoLowWordRecipe(factor);
  if (!recipe) return undefined;

  // Proven unused is the clean case; merely unknown (nothing later reads Dn's
  // old upper word, but it might still be this routine's return value, say)
  // is still offered, at lower confidence and as a review.
  const upperWordUse = ctx.registers.upperWordUseAfter(index, dest.register);
  if (upperWordUse === "used") return undefined;
  const scratch = recipe.scratch
    ? deadScratch(ctx, index, dest.register, 0xffff)
    : undefined;
  if (recipe.scratch && !scratch) return undefined;
  const safety = changedFlagsApplicability(ctx, index, [
    "X",
    "N",
    "Z",
    "V",
    "C",
  ]);
  const confidence = weakerConfidence(
    safety.confidence,
    upperWordUse === "unused" ? "high" : "medium",
  );
  const applicability =
    upperWordUse === "unused" ? safety.applicability : "conditional";
  return {
    ruleId: MULS_LOW_WORD_ONLY_ID,
    category: "optimization",
    severity: "suggestion",
    confidence,
    message:
      upperWordUse === "unused"
        ? `Only the low word of ${dest.register.toUpperCase()} is observed after MULS.W #${factor}; a shorter word-only sequence suffices`
        : `MULS.W #${factor},${dest.register.toUpperCase()} can use a shorter word-only sequence if its old upper word is not used afterward`,
    loc: line.mnemonic!.loc,
    suggestion: {
      description: `Replace MULS.W #${factor} with a word-only sequence`,
      replacement: render(recipe, dest.register, scratch, true),
      applicability,
    },
    notes: [
      {
        message:
          upperWordUse === "unused"
            ? `The analyser proves the old upper word of ${dest.register.toUpperCase()} is discarded before it is read.`
            : `The analyser cannot prove the old upper word of ${dest.register.toUpperCase()} is unused afterward -- for instance, it may be read past a branch this file does not resolve, or as this routine's return value; confirm it before applying this.`,
      },
      ...(scratch
        ? [
            {
              message: `The low word of ${scratch.toUpperCase()} is proven dead and can be used as scratch.`,
            },
          ]
        : []),
      ...(safety.applicability === "safe" && upperWordUse === "unused"
        ? []
        : [
            {
              message:
                "The word-only arithmetic sequence has different CCR behaviour from MULS.W.",
            },
          ]),
    ],
    data: {
      factor,
      scratch,
      upperWordUse,
      provenance: "generated",
    },
  };
}

export const flamewingMulsWordLowWordOnly: Rule = {
  meta: {
    obfuscated: true,
    id: MULS_LOW_WORD_ONLY_ID,
    category: "optimization",
    defaultSeverity: "suggestion",
    description:
      "Use shorter MULS.W recipes when the result's upper word is unobserved",
    tags: [
      "flamewing",
      "68000",
      "multiply",
      "constant",
      "partial-register",
      "scratch",
      "ccr",
    ],
    serves: "speed",
    docs: {
      source: "Flamewing M68000 Peephole Optimizations",
      example: {
        source:
          "\tmuls.w #7,d0\n\tmove.w d0,d2\n\tmoveq #0,d0\n\tmove.l d3,d4\n\trts",
      },
    },
  },
  checkLine(ctx, line, index) {
    const expr = immediateExpressionOperand(line, 0);
    const value = expr && ctx.evaluate(expr);
    // A power of two (2 and up; muls-word-by-one owns 1) is
    // muls-word-power-of-two's and its high-power sibling's to report, which
    // offer this same replacement as their own alternative.
    if (value?.known) {
      const factor = signedWord(value.value);
      if (factor >= 2 && isPowerOfTwo(factor)) return;
    }
    const diagnostic = mulsLowWordOnlyDiagnostic(ctx, line, index);
    if (diagnostic) ctx.report(diagnostic);
  },
};

const MULU_LOW_WORD_ONLY_ID = "optimization/mulu-word-low-word-only";

/**
 * The MULU.W low-word-only replacement for this line, if one applies -- the
 * unsigned twin of `mulsLowWordOnlyDiagnostic`.
 */
export function muluLowWordOnlyDiagnostic(
  ctx: Parameters<NonNullable<Rule["checkLine"]>>[0],
  line: Parameters<NonNullable<Rule["checkLine"]>>[1],
  index: number,
): Diagnostic | undefined {
  if (
    !m68000Only(ctx) ||
    !isInstruction(line, "mulu") ||
    wordFormSize(line) !== "w"
  )
    return undefined;
  const expr = immediateExpressionOperand(line, 0);
  const dest = dataRegisterOperand(line, 1);
  if (!expr || !dest) return undefined;
  const value = ctx.evaluate(expr);
  if (!value.known) return undefined;
  // Multiplying by one changes nothing, whatever the upper word holds.
  const recipe =
    value.value === 1
      ? { cycles: 0, scratch: false, code: "" }
      : (muluWordLowWordRecipes[value.value] ??
        powerOfTwoLowWordRecipe(value.value));
  if (!recipe) return undefined;

  // Proven unused is the clean case; merely unknown (nothing later reads Dn's
  // old upper word, but it might still be this routine's return value, say)
  // is still offered, at lower confidence and as a review.
  const upperWordUse = ctx.registers.registerBitsUseAfter(
    index,
    dest.register,
    0xffff0000,
  );
  if (upperWordUse === "used") return undefined;

  const scratch = recipe.scratch
    ? deadScratch(ctx, index, dest.register, 0xffff)
    : undefined;
  if (recipe.scratch && !scratch) return undefined;

  // MULU.W writes a 32-bit result and sets N/Z from that long result while
  // clearing V/C and preserving X.  A word-only sequence has different CCR
  // semantics even though its low 16-bit product is identical.
  const safety = changedFlagsApplicability(ctx, index, [
    "X",
    "N",
    "Z",
    "V",
    "C",
  ]);
  const confidence = weakerConfidence(
    safety.confidence,
    upperWordUse === "unused" ? "high" : "medium",
  );
  const applicability =
    upperWordUse === "unused" ? safety.applicability : "conditional";
  const replacement = render(recipe, dest.register, scratch, false);
  return {
    ruleId: MULU_LOW_WORD_ONLY_ID,
    category: "optimization",
    severity: "suggestion",
    confidence,
    message:
      upperWordUse === "unused"
        ? `Only the low word of ${dest.register.toUpperCase()} is observed after MULU.W #${value.value}; a shorter word-only form suffices`
        : `MULU.W #${value.value},${dest.register.toUpperCase()} can use a shorter word-only form if its old upper word is not used afterward`,
    loc: line.mnemonic!.loc,
    suggestion: {
      description:
        value.value === 1
          ? "Remove the multiply"
          : `Replace MULU.W #${value.value} with word arithmetic`,
      replacement,
      applicability,
    },
    notes: [
      {
        message:
          upperWordUse === "unused"
            ? `The analyser proves bits 16-31 of ${dest.register.toUpperCase()} are discarded before any read.`
            : `The analyser cannot prove bits 16-31 of ${dest.register.toUpperCase()} are unused afterward -- for instance, they may be read past a branch this file does not resolve, or as this routine's return value; confirm it before applying this.`,
      },
      ...(scratch
        ? [
            {
              message: `The low word of ${scratch.toUpperCase()} is proven dead and may be clobbered.`,
            },
          ]
        : []),
      ...(safety.applicability === "safe" && upperWordUse === "unused"
        ? []
        : [
            {
              message:
                "The word-only replacement has different CCR behaviour from MULU.W.",
            },
          ]),
    ],
    data: {
      factor: value.value,
      scratch,
      differingBits: "16-31",
      upperWordUse,
      provenance: "generated",
    },
  };
}

export const flamewingMuluWordLowWordOnly: Rule = {
  meta: {
    obfuscated: true,
    id: MULU_LOW_WORD_ONLY_ID,
    category: "optimization",
    defaultSeverity: "suggestion",
    description:
      "Use shorter MULU.W recipes when only the low word is observed",
    tags: [
      "flamewing",
      "68000",
      "multiply",
      "constant",
      "partial-register",
      "ccr",
    ],
    serves: "speed",
    docs: {
      source: "Flamewing M68000 Peephole Optimizations",
      example: {
        source: "\tmulu.w #9,d0\n\tmove.w d0,d2\n\tmoveq #0,d0\n\trts",
      },
    },
  },
  checkLine(ctx, line, index) {
    const expr = immediateExpressionOperand(line, 0);
    const value = expr && ctx.evaluate(expr);
    // A power of two (2 and up; mulu-word-by-one owns 1) is
    // mulu-word-power-of-two's and its high-power sibling's to report, which
    // offer this same replacement as their own alternative.
    if (value?.known && value.value >= 2 && isPowerOfTwo(value.value)) return;
    const diagnostic = muluLowWordOnlyDiagnostic(ctx, line, index);
    if (diagnostic) ctx.report(diagnostic);
  },
};
