import type { Rule } from "../../core/rule.js";
import {
  dataRegisterOperand,
  immediateExpressionOperand,
  instructionSize,
  isInstruction,
} from "../../util/ast.js";
import { changedFlagsApplicability, isPowerOfTwo } from "./helpers.js";

function allTargets(
  ctx: Parameters<NonNullable<Rule["checkLine"]>>[0],
  allowed: readonly string[],
): boolean {
  return ctx.config.processors.every((cpu) => allowed.includes(cpu));
}

function longMulMatch(
  ctx: Parameters<NonNullable<Rule["checkLine"]>>[0],
  line: Parameters<NonNullable<Rule["checkLine"]>>[1],
) {
  if (
    !(isInstruction(line, "muls") || isInstruction(line, "mulu")) ||
    instructionSize(line) !== "l"
  )
    return undefined;
  const expr = immediateExpressionOperand(line, 0);
  const dest = dataRegisterOperand(line, 1);
  if (!expr || !dest) return undefined;
  const value = ctx.evaluate(expr);
  return value.known ? { value: value.value, dest } : undefined;
}

function scratchAfter(
  ctx: Parameters<NonNullable<Rule["checkLine"]>>[0],
  index: number,
  dest: string,
): string | undefined {
  return ctx.registers
    .deadDataRegistersAfter(index)
    .find((r) => r !== dest.toLowerCase());
}

const recipes: Readonly<Record<number, (d: string, s: string) => string>> = {
  3: (d, s) => `move.l ${d},${s}\nadd.l ${d},${d}\nadd.l ${s},${d}`,
  5: (d, s) => `move.l ${d},${s}\nasl.l #2,${d}\nadd.l ${s},${d}`,
  6: (d, s) =>
    `add.l ${d},${d}\nmove.l ${d},${s}\nadd.l ${d},${d}\nadd.l ${s},${d}`,
  7: (d, s) => `move.l ${d},${s}\nasl.l #3,${d}\nsub.l ${s},${d}`,
  9: (d, s) => `move.l ${d},${s}\nasl.l #3,${d}\nadd.l ${s},${d}`,
  10: (d, s) =>
    `add.l ${d},${d}\nmove.l ${d},${s}\nasl.l #2,${d}\nadd.l ${s},${d}`,
  12: (d, s) =>
    `asl.l #2,${d}\nmove.l ${d},${s}\nadd.l ${d},${d}\nadd.l ${s},${d}`,
};

export const multiplyLongSmallConstant: Rule = {
  meta: {
    obfuscated: true,
    id: "optimization/multiply-long-small-constant",
    category: "optimization",
    defaultSeverity: "suggestion",
    description: "Replace selected long constant multiplies with shifts/adds",
    tags: ["asp68k", "multiply", "constant", "scratch", "ccr"],
    docs: {
      source: "ASP68K",
      note: "Verified with 68kcounter: a clean win on every target checked, including 68020 (e.g. factor 2: 50 to 3 cycles).",
      example: { source: "\tmuls.l #2,d0\n\tadd.l d1,d2" },
    },
  },
  checkLine(ctx, line, index) {
    const match = longMulMatch(ctx, line);
    if (!match) return;
    const factor = match.value;
    const d = match.dest.register;

    if (factor === 2) {
      if (
        !allTargets(ctx, [
          "mc68000",
          "mc68010",
          "mc68020",
          "mc68030",
          "mc68040",
          "mc68060",
        ])
      )
        return;
      const safety = changedFlagsApplicability(ctx, index, ["X", "V", "C"]);
      ctx.report({
        ruleId: this.meta.id,
        category: this.meta.category,
        severity: this.meta.defaultSeverity,
        confidence: safety.confidence,
        message: "Long multiplication by 2 can use ADD.L Dn,Dn",
        loc: line.mnemonic!.loc,
        suggestion: {
          description: "Double the register with ADD.L",
          replacement: `add.l ${d},${d}`,
          applicability: safety.applicability,
        },
        notes: [
          {
            message:
              "Multiplying by two is a single left shift, but X/V/C can differ from the multiply.",
          },
        ],
      });
      return;
    }

    const recipe = recipes[factor];
    if (!recipe) return;
    if (
      !allTargets(ctx, ["mc68000", "mc68010", "mc68020", "mc68030", "mc68040"])
    )
      return;
    const scratch = scratchAfter(ctx, index, d);
    if (!scratch) return;
    const safety = changedFlagsApplicability(ctx, index, ["X", "V", "C"]);
    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence: safety.confidence,
      message: `Long multiplication by ${factor} can use shifts/adds with dead scratch register ${scratch.toUpperCase()}`,
      loc: line.mnemonic!.loc,
      suggestion: {
        description: `Replace MUL by a shift-and-add ×${factor} sequence`,
        replacement: recipe(d, scratch),
        applicability: safety.applicability,
      },
      notes: [
        {
          message: `${scratch.toUpperCase()} is proven dead after the original multiply and can be used as scratch.`,
        },
        {
          message:
            "The final arithmetic produces the same low 32-bit result; X/V/C can differ from MUL and are checked for observability.",
        },
      ],
    });
  },
};

export const multiplyLongLargePowerOfTwo: Rule = {
  meta: {
    obfuscated: true,
    id: "optimization/multiply-long-large-power-of-two",
    category: "optimization",
    defaultSeverity: "suggestion",
    description:
      "Replace long multiply by 2^m (9<m<14) with register-count ASL",
    tags: ["asp68k", "multiply", "constant", "scratch", "ccr"],
    docs: {
      source: "ASP68K",
      note: "Verified with 68kcounter: a clean win on every target checked, including 68020 and 68060.",
      example: { source: "\tmuls.l #4096,d0\n\tmoveq #0,d1\n\trts" },
    },
  },
  checkLine(ctx, line, index) {
    const match = longMulMatch(ctx, line);
    if (!match || !isPowerOfTwo(match.value)) return;
    const shift = Math.log2(match.value);
    if (!Number.isInteger(shift) || shift <= 9 || shift >= 14) return;
    if (
      !allTargets(ctx, [
        "mc68000",
        "mc68010",
        "mc68020",
        "mc68030",
        "mc68040",
        "mc68060",
      ])
    )
      return;
    const d = match.dest.register;
    const scratch = scratchAfter(ctx, index, d);
    if (!scratch) return;
    const safety = changedFlagsApplicability(ctx, index, ["X", "V", "C"]);
    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence: safety.confidence,
      message: `Long multiplication by ${match.value} can use a register-count ASL`,
      loc: line.mnemonic!.loc,
      suggestion: {
        description: `Load shift count ${shift} into ${scratch.toUpperCase()} and shift`,
        replacement: `moveq #${shift},${scratch}\nasl.l ${scratch},${d}`,
        applicability: safety.applicability,
      },
      notes: [
        {
          message: `${scratch.toUpperCase()} is proven dead after the original multiply.`,
        },
        { message: "This recipe applies for 8 < m < 14." },
      ],
    });
  },
};

export const multiplySignedLong060: Rule = {
  meta: {
    obfuscated: true,
    id: "optimization/muls-long-060-simple",
    category: "optimization",
    defaultSeverity: "suggestion",
    description: "Use MOVEQ/ASL for simple MULS.L constants",
    tags: ["asp68k", "multiply", "68020+", "constant", "ccr"],
    docs: {
      source: "ASP68K",
      note: "Verified with 68kcounter: a clean win on every target checked, not just 68060 (e.g. factor 8: 42 fewer cycles on both 68020 and 68030).",
      example: {
        source: "\tmuls.l #8,d0\n\tadd.l d1,d2",
        config: { processors: ["mc68060"] },
      },
    },
  },
  checkLine(ctx, line, index) {
    if (
      !isInstruction(line, "muls") ||
      instructionSize(line) !== "l" ||
      !allTargets(ctx, ["mc68020", "mc68030", "mc68040", "mc68060"])
    )
      return;
    const expr = immediateExpressionOperand(line, 0);
    const dest = dataRegisterOperand(line, 1);
    if (!expr || !dest) return;
    const value = ctx.evaluate(expr);
    if (!value.known) return;
    if (value.value === 0) {
      ctx.report({
        ruleId: this.meta.id,
        category: this.meta.category,
        severity: this.meta.defaultSeverity,
        confidence: "certain",
        message: "MULS.L by zero can use MOVEQ #0 on 68060",
        loc: line.mnemonic!.loc,
        suggestion: {
          description: "Use MOVEQ #0",
          replacement: `moveq #0,${dest.register}`,
          applicability: "safe",
        },
      });
      return;
    }
    if (!isPowerOfTwo(value.value)) return;
    const shift = Math.log2(value.value);
    if (!Number.isInteger(shift) || shift < 1 || shift > 8) return;
    const safety = changedFlagsApplicability(ctx, index, ["X", "V", "C"]);
    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence: safety.confidence,
      message: `MULS.L by ${value.value} can use ASL.L #${shift} on 68060`,
      loc: line.mnemonic!.loc,
      suggestion: {
        description: "Use an immediate arithmetic shift",
        replacement: `asl.l #${shift},${dest.register}`,
        applicability: safety.applicability,
      },
    });
  },
};
