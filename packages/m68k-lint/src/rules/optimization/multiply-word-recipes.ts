import type { Rule } from "../../core/rule.js";
import {
  dataRegisterOperand,
  immediateExpressionOperand,
  instructionSize,
  isInstruction,
} from "../../util/ast.js";
import { changedFlagsApplicability } from "./helpers.js";
import { DATA_REGISTERS } from "../../semantics/registers.js";

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

/**
 * Flamewing's signed-word constant-multiply recipes whose full 32-bit result is
 * preserved.  Factors already covered by the ASP68K-derived rules are omitted.
 * Each recipe was independently checked as an integer coefficient identity
 * after the initial EXT.L sign extension.
 */
const fullResultRecipes: Readonly<
  Record<number, (d: string, s: string) => string>
> = {
  11: (d, s) =>
    `ext.l ${d}\nmove.l ${d},${s}\nadd.l ${s},${d}\nadd.l ${s},${d}\nasl.l #2,${d}\nsub.l ${s},${d}`,
  13: (d, s) =>
    `ext.l ${d}\nmove.l ${d},${s}\nadd.l ${s},${d}\nadd.l ${s},${d}\nasl.l #2,${d}\nadd.l ${s},${d}`,
  14: (d, s) =>
    `ext.l ${d}\nmove.l ${d},${s}\nasl.l #3,${d}\nsub.l ${s},${d}\nadd.l ${d},${d}`,
  15: (d, s) => `ext.l ${d}\nmove.l ${d},${s}\nasl.l #4,${d}\nsub.l ${s},${d}`,
  17: (d, s) => `ext.l ${d}\nmove.l ${d},${s}\nasl.l #4,${d}\nadd.l ${s},${d}`,
  18: (d, s) =>
    `ext.l ${d}\nadd.l ${d},${d}\nmove.l ${d},${s}\nasl.l #3,${d}\nadd.l ${s},${d}`,
  19: (d, s) =>
    `ext.l ${d}\nmove.l ${d},${s}\nasl.l #3,${d}\nadd.l ${s},${d}\nadd.l ${d},${d}\nadd.l ${s},${d}`,
  20: (d, s) =>
    `ext.l ${d}\nmove.l ${d},${s}\nasl.l #2,${d}\nadd.l ${s},${d}\nasl.l #2,${d}`,
  21: (d, s) =>
    `ext.l ${d}\nmove.l ${d},${s}\nasl.l #2,${d}\nadd.l ${s},${d}\nasl.l #2,${d}\nadd.l ${s},${d}`,
  22: (d, s) =>
    `ext.l ${d}\nadd.l ${d},${d}\nmove.l ${d},${s}\nadd.l ${s},${d}\nadd.l ${s},${d}\nasl.l #2,${d}\nsub.l ${s},${d}`,
  23: (d, s) =>
    `ext.l ${d}\nmove.l ${d},${s}\nadd.l ${s},${d}\nadd.l ${s},${d}\nasl.l #3,${d}\nsub.l ${s},${d}`,
  24: (d, s) =>
    `ext.l ${d}\nmove.l ${d},${s}\nadd.l ${s},${d}\nadd.l ${s},${d}\nasl.l #3,${d}`,
  25: (d, s) =>
    `ext.l ${d}\nmove.l ${d},${s}\nadd.l ${s},${d}\nadd.l ${s},${d}\nasl.l #3,${d}\nadd.l ${s},${d}`,
  26: (d, s) =>
    `ext.l ${d}\nmove.l ${d},${s}\nadd.l ${s},${s}\nadd.l ${s},${d}\nasl.l #3,${d}\nadd.l ${s},${d}`,
  29: (d, s) =>
    `ext.l ${d}\nmove.l ${d},${s}\nasl.l #5,${d}\nsub.l ${s},${d}\nsub.l ${s},${d}\nsub.l ${s},${d}`,
  30: (d, s) =>
    `ext.l ${d}\nmove.l ${d},${s}\nasl.l #5,${d}\nsub.l ${s},${d}\nsub.l ${s},${d}`,
  31: (d, s) => `ext.l ${d}\nmove.l ${d},${s}\nasl.l #5,${d}\nsub.l ${s},${d}`,
  33: (d, s) => `ext.l ${d}\nmove.l ${d},${s}\nasl.l #5,${d}\nadd.l ${s},${d}`,
  34: (d, s) =>
    `ext.l ${d}\nmove.l ${d},${s}\nasl.l #5,${d}\nadd.l ${s},${d}\nadd.l ${s},${d}`,
  35: (d, s) =>
    `ext.l ${d}\nmove.l ${d},${s}\nasl.l #5,${d}\nadd.l ${s},${d}\nadd.l ${s},${d}\nadd.l ${s},${d}`,
};

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
      instructionSize(line) !== "w"
    )
      return;
    const expr = immediateExpressionOperand(line, 0);
    const dest = dataRegisterOperand(line, 1);
    if (!expr || !dest) return;
    const value = ctx.evaluate(expr);
    if (!value.known) return;
    const recipe = fullResultRecipes[value.value];
    if (!recipe) return;
    if (
      [15, 17, 31].includes(value.value) &&
      ctx.registers.upperWordUseAfter(index, dest.register) === "unused"
    )
      return;

    const scratch = deadScratch(ctx, index, dest.register);
    if (!scratch) return;
    // Final N/Z reflect the same 32-bit result and MULS clears V/C while preserving X.
    // The arithmetic recipe can produce different X/V/C.
    const safety = changedFlagsApplicability(ctx, index, ["X", "V", "C"]);
    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence: safety.confidence,
      message: `MULS.W #${value.value},${dest.register.toUpperCase()} has a faster verified 68000 shift/add sequence`,
      loc: line.mnemonic!.loc,
      suggestion: {
        description: `Replace MULS.W #${value.value} using dead scratch ${scratch.toUpperCase()}`,
        replacement: recipe(dest.register, scratch),
        applicability: safety.applicability,
      },
      notes: [
        {
          message: `${scratch.toUpperCase()} is proven dead after the original multiply and may be clobbered.`,
        },
        ...(safety.applicability === "safe"
          ? []
          : [
              {
                message:
                  "X/V/C can differ from MULS.W and must not be observed.",
              },
            ]),
      ],
      data: { factor: value.value, scratch, provenance: "flamewing" },
    });
  },
};

/**
 * Flamewing also lists much shorter word-only multiply recipes when the old
 * high word of Dn is irrelevant.  Our existing upper-word use analysis is
 * sufficient to prove that precondition for a useful initial subset.
 */
const lowWordRecipes: Readonly<
  Record<number, (d: string, s: string) => string>
> = {
  3: (d, s) => `move.w ${d},${s}\nadd.w ${d},${d}\nadd.w ${s},${d}`,
  5: (d, s) =>
    `move.w ${d},${s}\nadd.w ${d},${d}\nadd.w ${d},${d}\nadd.w ${s},${d}`,
  7: (d, s) => `move.w ${d},${s}\nasl.w #3,${d}\nsub.w ${s},${d}`,
  9: (d, s) => `move.w ${d},${s}\nasl.w #3,${d}\nadd.w ${s},${d}`,
  15: (d, s) => `move.w ${d},${s}\nasl.w #4,${d}\nsub.w ${s},${d}`,
  17: (d, s) => `move.w ${d},${s}\nasl.w #4,${d}\nadd.w ${s},${d}`,
  31: (d, s) => `move.w ${d},${s}\nasl.w #5,${d}\nsub.w ${s},${d}`,
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
      instructionSize(line) !== "w"
    )
      return;
    const expr = immediateExpressionOperand(line, 0);
    const dest = dataRegisterOperand(line, 1);
    if (!expr || !dest) return;
    const value = ctx.evaluate(expr);
    if (!value.known) return;
    const recipe = lowWordRecipes[value.value];
    if (!recipe) return;

    const upperWordUse = ctx.registers.upperWordUseAfter(index, dest.register);
    if (upperWordUse !== "unused") return;
    const scratch = deadScratch(ctx, index, dest.register, 0xffff);
    if (!scratch) return;
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
      message: `Only the low word of ${dest.register.toUpperCase()} is observed after MULS.W #${value.value}; a shorter word-only sequence suffices`,
      loc: line.mnemonic!.loc,
      suggestion: {
        description: `Replace MULS.W #${value.value} with a word-only sequence`,
        replacement: recipe(dest.register, scratch),
        applicability: safety.applicability,
      },
      notes: [
        {
          message: `The analyser proves the old upper word of ${dest.register.toUpperCase()} is discarded before it is read.`,
        },
        {
          message: `${scratch.toUpperCase()} is proven dead and can be used as scratch.`,
        },
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
        factor: value.value,
        scratch,
        upperWordUse,
        provenance: "flamewing",
      },
    });
  },
};

/**
 * Flamewing's unsigned word-only multiply recipes.  These preserve the low
 * 16-bit product but, unlike MULU.W, do not produce the full zero-extended
 * 32-bit result.  They are therefore only valid when bits 16..31 of Dn are
 * proven unobserved before a definite overwrite.
 */
const muluLowWordRecipes: Readonly<
  Record<number, (d: string, s?: string) => string>
> = {
  1: () => "",
  2: (d) => `add.w ${d},${d}`,
  3: (d, s) => `move.w ${d},${s}\nadd.w ${d},${d}\nadd.w ${s},${d}`,
  4: (d) => `add.w ${d},${d}\nadd.w ${d},${d}`,
  5: (d, s) =>
    `move.w ${d},${s}\nadd.w ${d},${d}\nadd.w ${d},${d}\nadd.w ${s},${d}`,
  7: (d, s) => `move.w ${d},${s}\nlsl.w #3,${d}\nsub.w ${s},${d}`,
  8: (d) => `lsl.w #3,${d}`,
  9: (d, s) => `move.w ${d},${s}\nlsl.w #3,${d}\nadd.w ${s},${d}`,
  15: (d, s) => `move.w ${d},${s}\nlsl.w #4,${d}\nsub.w ${s},${d}`,
  16: (d) => `lsl.w #4,${d}`,
  17: (d, s) => `move.w ${d},${s}\nlsl.w #4,${d}\nadd.w ${s},${d}`,
  31: (d, s) => `move.w ${d},${s}\nlsl.w #5,${d}\nsub.w ${s},${d}`,
  32: (d) => `lsl.w #5,${d}`,
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
      instructionSize(line) !== "w"
    )
      return;
    const expr = immediateExpressionOperand(line, 0);
    const dest = dataRegisterOperand(line, 1);
    if (!expr || !dest) return;
    const value = ctx.evaluate(expr);
    if (!value.known) return;
    const recipe = muluLowWordRecipes[value.value];
    if (!recipe) return;

    if (
      ctx.registers.registerBitsUseAfter(index, dest.register, 0xffff0000) !==
      "unused"
    )
      return;

    const needsScratch = ![1, 2, 4, 8, 16, 32].includes(value.value);
    const scratch = needsScratch
      ? deadScratch(ctx, index, dest.register, 0xffff)
      : undefined;
    if (needsScratch && !scratch) return;

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
    const replacement = recipe(dest.register, scratch);
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
                message: `${scratch.toUpperCase()} is proven dead and may be clobbered.`,
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
        provenance: "flamewing",
      },
    });
  },
};
