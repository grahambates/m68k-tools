import type { Rule } from "../../core/rule.js";
import {
  dataRegisterOperand,
  immediateExpressionOperand,
  isInstruction,
  wordFormSize,
} from "../../util/ast.js";
import {
  divideRecipes,
  type DivideRecipe,
} from "./generated/divide-recipes.js";
import {
  changedFlagsApplicability,
  containsSymbol,
  embeddedValueText,
  isPowerOfTwo,
} from "./helpers.js";
import {
  shiftInstructions,
  unsignedCycles,
  undominated,
  unsignedReciprocals,
  widest,
  type Reciprocal,
} from "./reciprocal.js";

/** The scale of a reciprocal as it is written in a source: `$10000`, `$80000`. */
const scaleText = (r: Reciprocal) => `$${(2 ** (16 + r.shift)).toString(16)}`;

/** MULU and SWAP leave X alone; the LSR that follows at a larger scale sets it. */
const writesX = (r: Reciprocal) => r.shift > 0;

/**
 * DIVU.W by a constant costs 144 cycles at worst. Multiplying by the reciprocal
 * is much cheaper, but it only gives the quotient, and only for dividends up to
 * a bound that depends on the divisor and the scale. The bound is worked out
 * exactly, but whether the dividend stays within it cannot be proven from the
 * code, so it is the user's to confirm; the remainder and the flags are checked.
 *
 * The multiplier is written from the divisor's expression when it names
 * something, so that it follows the constant if it changes: a number worked out
 * from `MY_DIV` and written in place of it would be wrong the day `MY_DIV`
 * changes. The recipes that cannot be written that way (a shift or a sequence
 * chosen for one particular value) are not offered for a named divisor.
 */
export const divuWordByConstant: Rule = {
  meta: {
    obfuscated: true,
    id: "optimization/divu-word-by-constant",
    category: "optimization",
    defaultSeverity: "suggestion",
    description:
      "Replace unsigned word division by a constant with a multiply by its reciprocal when only the quotient of a small dividend is needed",
    tags: [
      "divide",
      "multiply",
      "reciprocal",
      "generated",
      "remainder",
      "review",
      "68000",
    ],
    serves: "speed",
    docs: {
      source:
        "Fixed-point reciprocal multiplication: the scale is chosen per divisor, and the exact range checked over every dividend",
      note: "Only the quotient is produced, so the remainder in the upper word of the register must be unused: it is not offered when that is provably used, and it is offered with lower confidence when the analysis cannot tell. The reciprocal is `ceil(scale/divisor)`, exact for every dividend up to a stated bound that was found by dividing them all; the register analysis cannot prove the dividend stays within it, so this is always a conditional suggestion. When the divisor is a named constant the multiplier is written as an expression in it, so that it follows the constant.",
      example: {
        source: "\tdivu.w #10,d0\n\tmove.w d0,d2\n\tmoveq #0,d0\n\trts",
      },
    },
  },

  checkLine(ctx, line, index) {
    if (
      !ctx.config.processors.every((cpu) => cpu === "mc68000") ||
      !isInstruction(line, "divu") ||
      wordFormSize(line) !== "w"
    )
      return;
    const expr = immediateExpressionOperand(line, 0);
    const dest = dataRegisterOperand(line, 1);
    if (!expr || !dest) return;
    const divisor = ctx.evaluate(expr);
    if (!divisor.known) return;
    const d = divisor.value;
    // A power of two is a shift, which has its own rule; DIVU.W's divisor is a word.
    if (d < 3 || d > 0xffff || isPowerOfTwo(d)) return;

    // A known dividend is better folded to its quotient than divided.
    if (ctx.registers.knownConstantBefore(index, dest.register) !== undefined)
      return;
    // DIVU.W leaves the remainder in the upper word; the recipes leave junk
    // there. If it is provably read, that is the end of it. If it is merely not
    // known to be unused, the suggestion is still offered, as a review, and says so.
    const upperUse = ctx.registers.upperWordUseAfter(index, dest.register);
    if (upperUse === "used") return;
    // Every recipe sets N, Z, V and C differently from DIVU.W. A divide is often
    // followed by a test of the quotient, so this is not guessed at.
    const flags = changedFlagsApplicability(ctx, index, ["N", "Z", "V", "C"]);
    if (flags.applicability !== "safe") return;
    // X is only written by a recipe with a shift, and DIVU.W leaves it alone. If
    // it is read afterwards those are out; if it is merely not known to be dead
    // they are offered with a warning.
    const xState = ctx.flags.isLiveAfter(index, "X");

    const candidates = undominated(
      unsignedReciprocals(d).filter((r) => xState !== "live" || !writesX(r)),
    );
    const primary = widest(candidates);
    if (!primary) return;

    // The multiplier is written as the scale over the divisor as the source wrote
    // it, whether that is a name, a sum or a plain number: `#$80000/MY_DIV+1`,
    // `#$80000/10+1`. A number like 52429 says nothing about where it came from,
    // and this says how it was made, and follows the constant if there is one.
    const written = embeddedValueText(ctx, expr, d);
    const named = containsSymbol(expr) && written !== String(d);
    const multiplier = (r: Reciprocal) => `${scaleText(r)}/${written}+1`;
    const code = (r: Reciprocal) =>
      [
        `mulu.w #${multiplier(r)},${dest.register}`,
        `swap ${dest.register}`,
        ...shiftInstructions("lsr", dest.register, r.shift),
      ].join("\n");
    // A smaller scale saves the shift, but its multiplier can have more set bits
    // and cost more than that, so it is only offered if it is cheaper. Each one
    // left after that is a genuine tradeoff -- undominated already discarded any
    // scale that is not both cheaper and narrower than some other candidate --
    // so every survivor is a real choice for the reader, not noise.
    const cheaper = candidates.filter(
      (r) =>
        r.shift < primary.shift && unsignedCycles(r) < unsignedCycles(primary),
    );

    /** The caveats specific to one candidate: what it is exact for, and its cost. */
    const candidateNotes = (r: Reciprocal) => [
      {
        message: `Scale ${scaleText(r)}, multiplier ceil(${scaleText(r)}/${d}) = ${r.multiplier}: exact for every dividend from 0 to ${r.max}, found by dividing them all. This is only correct if the dividend in ${dest.register.toUpperCase()} stays within that, so its upper word is zero and the quotient cannot overflow. That cannot be proven here; check it.`,
      },
      {
        message:
          upperUse === "unused"
            ? "The upper word (DIVU.W's remainder) is provably unused, and N, Z, V and C are dead, so neither the remainder nor the different flag results matter."
            : `Check that the remainder DIVU.W leaves in the upper word of ${dest.register.toUpperCase()} is not used: this only produces the quotient, and the analysis cannot tell whether the register is read again. N, Z, V and C are dead.`,
      },
      ...(xState === "unknown" && writesX(r)
        ? [
            {
              message:
                "A recipe with a shift also changes X, which DIVU.W leaves alone, and nothing here proves X is unused afterwards.",
            },
          ]
        : []),
    ];
    const confidence =
      upperUse === "unused" ? ("medium" as const) : ("low" as const);
    // Cheapest and widest first: the one most readers will actually want.
    const alternatives = cheaper
      .slice()
      .reverse()
      .map((r) => ({
        ruleId: this.meta.id,
        category: this.meta.category,
        severity: this.meta.defaultSeverity,
        confidence,
        message: `DIVU.W ${named ? `by ${written}` : `#${d}`},${dest.register.toUpperCase()} can use a smaller-scale reciprocal multiply if the dividend is no more than ${r.max}`,
        loc: line.mnemonic!.loc,
        suggestion: {
          description: `Multiply by the reciprocal of ${named ? written : d}, smaller scale (exact for dividends up to ${r.max})`,
          replacement: code(r),
          applicability: "conditional" as const,
        },
        notes: candidateNotes(r),
        data: {
          divisor: d,
          dividendAtMost: r.max,
          upperWordUse: upperUse,
          named,
        },
      }));

    // Cheaper recipes for a smaller dividend that are made for this value: a
    // multiplier with fewer set bits, or shifts and adds. They cannot follow a
    // named constant, so they are not offered for one at all -- unlike a
    // smaller scale, there is no way to write one that would still be correct
    // the day the constant changes.
    const scratch = ctx.registers
      .deadDataRegistersAfter(index)
      .find((r) => r !== dest.register.toLowerCase());
    const specific: DivideRecipe[] = named
      ? []
      : (divideRecipes[d] ?? []).filter(
          (r) =>
            2 ** r.bits - 1 < primary.max &&
            r.cycles < unsignedCycles(primary) &&
            (!r.scratch || scratch),
        );
    // Widest and cheapest first, same as the scale alternatives.
    const specificAlternatives = specific
      .slice()
      .reverse()
      .map((r) => ({
        ruleId: this.meta.id,
        category: this.meta.category,
        severity: this.meta.defaultSeverity,
        confidence,
        message: `DIVU.W #${d},${dest.register.toUpperCase()} has a sequence made for this value if the dividend is below ${2 ** r.bits}`,
        loc: line.mnemonic!.loc,
        suggestion: {
          description: `Made for ${d}${r.scratch ? `, clobbers ${scratch?.toUpperCase()}` : ""} (exact for dividends below ${2 ** r.bits})`,
          replacement: r.code
            .replaceAll("%d", dest.register)
            .replaceAll("%s", scratch ?? ""),
          applicability: "conditional" as const,
        },
        notes: [
          {
            message: `Made directly for ${d}, not from an expression: it will not follow this constant if it changes, and it is only exact for a dividend below ${2 ** r.bits}, found by dividing them all.`,
          },
          {
            message:
              upperUse === "unused"
                ? "The upper word (DIVU.W's remainder) is provably unused, and N, Z, V and C are dead, so neither the remainder nor the different flag results matter."
                : `Check that the remainder DIVU.W leaves in the upper word of ${dest.register.toUpperCase()} is not used: this only produces the quotient, and the analysis cannot tell whether the register is read again. N, Z, V and C are dead.`,
          },
          ...(r.scratch
            ? [
                {
                  message: `${scratch?.toUpperCase()} is proven dead after the original divide and may be clobbered.`,
                },
              ]
            : []),
          ...(xState === "unknown"
            ? [
                {
                  message:
                    "This sequence also changes X, which DIVU.W leaves alone, and nothing here proves X is unused afterwards.",
                },
              ]
            : []),
        ],
        data: {
          divisor: d,
          dividendAtMost: 2 ** r.bits - 1,
          upperWordUse: upperUse,
          named: false,
          madeFor: d,
        },
      }));

    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence,
      message: `DIVU.W ${named ? `by ${written}` : `#${d}`},${dest.register.toUpperCase()} can be a reciprocal multiply if the dividend is no more than ${primary.max}`,
      loc: line.mnemonic!.loc,
      suggestion: {
        description: `Multiply by the reciprocal of ${named ? written : d} (exact for dividends up to ${primary.max})`,
        replacement: code(primary),
        applicability: "conditional",
      },
      notes: [
        ...candidateNotes(primary),
        ...(named
          ? [
              {
                message: `The multiplier is worked out by the assembler from ${written}, so it follows the constant. That was checked for ${written} = ${d} only: a value that is a power of two, one that needs a multiplier over 65535, or one that shrinks the range above would not be caught.`,
              },
            ]
          : []),
      ],
      data: {
        divisor: d,
        dividendAtMost: primary.max,
        upperWordUse: upperUse,
        named,
      },
      alternatives: [...alternatives, ...specificAlternatives],
    });
  },
};
