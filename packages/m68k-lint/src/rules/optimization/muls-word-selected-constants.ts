import type { Rule } from "../../core/rule.js";
import {
  dataRegisterOperand,
  immediateExpressionOperand,
  instructionSize,
  isInstruction,
} from "../../util/ast.js";
import { changedFlagsApplicability } from "./helpers.js";

function usefulTargets(
  ctx: Parameters<NonNullable<Rule["checkLine"]>>[0],
): boolean {
  return ctx.config.processors.every((cpu) =>
    ["mc68000", "mc68010", "mc68030", "mc68040"].includes(cpu),
  );
}

const recipes: Readonly<Record<number, (d: string, s: string) => string>> = {
  3: (d, s) => `ext.l ${d}\nmove.l ${d},${s}\nadd.l ${d},${d}\nadd.l ${s},${d}`,
  5: (d, s) => `ext.l ${d}\nmove.l ${d},${s}\nasl.l #2,${d}\nadd.l ${s},${d}`,
  6: (d, s) =>
    `ext.l ${d}\nadd.l ${d},${d}\nmove.l ${d},${s}\nadd.l ${s},${d}\nadd.l ${s},${d}`,
  7: (d, s) => `ext.l ${d}\nmove.l ${d},${s}\nasl.l #3,${d}\nsub.l ${s},${d}`,
  9: (d, s) => `ext.l ${d}\nmove.l ${d},${s}\nasl.l #3,${d}\nadd.l ${s},${d}`,
  10: (d, s) =>
    `ext.l ${d}\nadd.l ${d},${d}\nmove.l ${d},${s}\nasl.l #2,${d}\nadd.l ${s},${d}`,
  12: (d, s) =>
    `ext.l ${d}\nasl.l #2,${d}\nmove.l ${d},${s}\nadd.l ${d},${d}\nadd.l ${s},${d}`,
};

export const multiplySignedWordSelectedConstants: Rule = {
  meta: {
    obfuscated: true,
    id: "optimization/muls-word-selected-constants",
    category: "optimization",
    defaultSeverity: "suggestion",
    description: "Replace selected MULS.W constants with EXT/shifts/adds",
    tags: ["asp68k", "multiply", "constant", "scratch", "ccr"],
    serves: "speed",
    docs: {
      source: "ASP68K",
      example: { source: "\tmuls.w #2,d0\n\tadd.l d1,d2" },
    },
  },
  checkLine(ctx, line, index) {
    if (
      !isInstruction(line, "muls") ||
      instructionSize(line) !== "w" ||
      !usefulTargets(ctx)
    )
      return;
    const expr = immediateExpressionOperand(line, 0);
    const dest = dataRegisterOperand(line, 1);
    if (!expr || !dest) return;
    const result = ctx.evaluate(expr);
    if (!result.known) return;
    const factor = result.value;
    const d = dest.register;
    const safety = changedFlagsApplicability(ctx, index, ["X", "V", "C"]);
    if (
      [3, 5, 7, 9].includes(factor) &&
      ctx.registers.upperWordUseAfter(index, d) === "unused"
    )
      return;

    if (factor === 2) {
      ctx.report({
        ruleId: this.meta.id,
        category: this.meta.category,
        severity: this.meta.defaultSeverity,
        confidence: safety.confidence,
        message: "MULS.W #2 can use EXT.L followed by ADD.L Dn,Dn",
        loc: line.mnemonic!.loc,
        suggestion: {
          description: "Sign-extend then double",
          replacement: `ext.l ${d}\nadd.l ${d},${d}`,
          applicability: safety.applicability,
        },
        notes: [
          {
            message:
              "The value is the same either way; X/V/C can differ, so their liveness is checked.",
          },
        ],
      });
      return;
    }

    const recipe = recipes[factor];
    if (!recipe) return;
    const scratch = ctx.registers
      .deadDataRegistersAfter(index)
      .find((r) => r !== d.toLowerCase());
    if (!scratch) return;
    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence: safety.confidence,
      message: `MULS.W #${factor} can use an EXT/shift/add sequence with dead scratch ${scratch.toUpperCase()}`,
      loc: line.mnemonic!.loc,
      suggestion: {
        description: `Replace MULS.W #${factor}`,
        replacement: recipe(d, scratch),
        applicability: safety.applicability,
      },
      notes: [
        {
          message: `${scratch.toUpperCase()} is proven dead after the original multiply.`,
        },
        {
          message:
            "The replacement computes the same signed 16×constant low-32-bit result; X/V/C can differ from MULS.",
        },
      ],
    });
  },
};
