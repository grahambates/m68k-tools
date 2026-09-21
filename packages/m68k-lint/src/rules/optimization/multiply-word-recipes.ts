import type { Rule } from "../../core/rule.js";
import {
  dataRegisterOperand,
  immediateExpressionOperand,
  wordFormSize,
  isInstruction,
} from "../../util/ast.js";
import { changedFlagsApplicability } from "./helpers.js";
import { DATA_REGISTERS } from "../../semantics/registers.js";
import {
  mulsWordFullResultRecipes,
  mulsWordLowWordRecipes,
  muluWordLowWordRecipes,
  type MultiplyRecipe,
} from "./generated/multiply-recipes.js";

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
    // When the upper word is unobserved the word-only recipe is much cheaper,
    // so leave the constant to muls-word-low-word-only where that can apply.
    const lowWord = mulsWordLowWordRecipes[factor];
    if (
      lowWord &&
      ctx.registers.upperWordUseAfter(index, dest.register) === "unused" &&
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

export const flamewingMulsWordLowWordOnly: Rule = {
  meta: {
    obfuscated: true,
    id: "optimization/muls-word-low-word-only",
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
    const recipe = mulsWordLowWordRecipes[factor];
    if (!recipe) return;

    const upperWordUse = ctx.registers.upperWordUseAfter(index, dest.register);
    if (upperWordUse !== "unused") return;
    const scratch = recipe.scratch
      ? deadScratch(ctx, index, dest.register, 0xffff)
      : undefined;
    if (recipe.scratch && !scratch) return;
    const safety = changedFlagsApplicability(ctx, index, [
      "X",
      "N",
      "Z",
      "V",
      "C",
    ]);
    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence: safety.confidence,
      message: `Only the low word of ${dest.register.toUpperCase()} is observed after MULS.W #${factor}; a shorter word-only sequence suffices`,
      loc: line.mnemonic!.loc,
      suggestion: {
        description: `Replace MULS.W #${factor} with a word-only sequence`,
        replacement: render(recipe, dest.register, scratch, true),
        applicability: safety.applicability,
      },
      notes: [
        {
          message: `The analyser proves the old upper word of ${dest.register.toUpperCase()} is discarded before it is read.`,
        },
        ...(scratch
          ? [
              {
                message: `The low word of ${scratch.toUpperCase()} is proven dead and can be used as scratch.`,
              },
            ]
          : []),
        ...(safety.applicability === "safe"
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
    });
  },
};

export const flamewingMuluWordLowWordOnly: Rule = {
  meta: {
    obfuscated: true,
    id: "optimization/mulu-word-low-word-only",
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
    if (
      !m68000Only(ctx) ||
      !isInstruction(line, "mulu") ||
      wordFormSize(line) !== "w"
    )
      return;
    const expr = immediateExpressionOperand(line, 0);
    const dest = dataRegisterOperand(line, 1);
    if (!expr || !dest) return;
    const value = ctx.evaluate(expr);
    if (!value.known) return;
    // Multiplying by one changes nothing, whatever the upper word holds.
    const recipe =
      value.value === 1
        ? { cycles: 0, scratch: false, code: "" }
        : muluWordLowWordRecipes[value.value];
    if (!recipe) return;

    if (
      ctx.registers.registerBitsUseAfter(index, dest.register, 0xffff0000) !==
      "unused"
    )
      return;

    const scratch = recipe.scratch
      ? deadScratch(ctx, index, dest.register, 0xffff)
      : undefined;
    if (recipe.scratch && !scratch) return;

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
    const replacement = render(recipe, dest.register, scratch, false);
    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence: safety.confidence,
      message: `Only the low word of ${dest.register.toUpperCase()} is observed after MULU.W #${value.value}; a shorter word-only form suffices`,
      loc: line.mnemonic!.loc,
      suggestion: {
        description:
          value.value === 1
            ? "Remove the multiply"
            : `Replace MULU.W #${value.value} with word arithmetic`,
        replacement,
        applicability: safety.applicability,
      },
      notes: [
        {
          message: `The analyser proves bits 16-31 of ${dest.register.toUpperCase()} are discarded before any read.`,
        },
        ...(scratch
          ? [
              {
                message: `The low word of ${scratch.toUpperCase()} is proven dead and may be clobbered.`,
              },
            ]
          : []),
        ...(safety.applicability === "safe"
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
        provenance: "generated",
      },
    });
  },
};
