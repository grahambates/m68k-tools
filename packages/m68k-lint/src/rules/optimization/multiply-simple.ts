import type { Rule } from "../../core/rule.js";
import {
  dataRegisterOperand,
  immediateOperand,
  wordFormSize,
  isInstruction,
} from "../../util/ast.js";
import { changedFlagsApplicability, isPowerOfTwo } from "./helpers.js";
import { targetsOnly } from "../../core/config.js";

// Verified with 68kcounter: MULS.W/MULU.W by 0 or 1 costs the same fixed 31
// cycles on 68020 regardless of the immediate, so removing/replacing it is
// still a clean win there; cpu32 is unverified and stays excluded.
function sourceTimingKnown(
  ctx: Parameters<NonNullable<Rule["checkLine"]>>[0],
): boolean {
  return ctx.config.processors.every((cpu) => cpu !== "cpu32");
}

function powerOfTwoTimingUseful(
  ctx: Parameters<NonNullable<Rule["checkLine"]>>[0],
): boolean {
  return ctx.config.processors.every((cpu) =>
    ["mc68000", "mc68010", "mc68030", "mc68040"].includes(cpu),
  );
}

function strictly68000(
  ctx: Parameters<NonNullable<Rule["checkLine"]>>[0],
): boolean {
  return ctx.config.processors.every((cpu) => cpu === "mc68000");
}

export const multiplyWordByZero: Rule = {
  meta: {
    obfuscated: true,
    id: "optimization/multiply-word-by-zero",
    category: "optimization",
    defaultSeverity: "suggestion",
    description: "Replace MULS.W/MULU.W by zero with MOVEQ #0",
    tags: ["asp68k", "multiply", "constant"],
    docs: { source: "ASP68K", example: { source: "\tmuls.w #0,d0" } },
  },
  checkLine(ctx, line) {
    if (!(isInstruction(line, "muls") || isInstruction(line, "mulu"))) return;
    if (wordFormSize(line) !== "w" || !sourceTimingKnown(ctx)) return;
    const imm = immediateOperand(line, 0);
    const dest = dataRegisterOperand(line, 1);
    if (!imm || !dest) return;
    const value = ctx.evaluate(imm.value);
    if (!value.known || value.value !== 0) return;

    const replacement = `moveq #0,${dest.register}`;
    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence: "certain",
      message: `${line.mnemonic!.type === "instruction" ? line.mnemonic!.instruction.toUpperCase() : "MUL"}.W by zero always produces zero`,
      loc: line.mnemonic!.loc,
      suggestion: {
        description: `Use ${replacement.toUpperCase()}`,
        replacement,
        applicability: "safe",
      },
    });
  },
};

export const multiplySignedWordByOne: Rule = {
  meta: {
    obfuscated: true,
    id: "optimization/muls-word-by-one",
    category: "optimization",
    defaultSeverity: "suggestion",
    description: "Replace MULS.W #1 with EXT.L",
    tags: ["asp68k", "multiply", "constant"],
    docs: { source: "ASP68K", example: { source: "\tmuls.w #1,d0" } },
  },
  checkLine(ctx, line) {
    if (
      !isInstruction(line, "muls") ||
      wordFormSize(line) !== "w" ||
      !sourceTimingKnown(ctx)
    )
      return;
    const imm = immediateOperand(line, 0);
    const dest = dataRegisterOperand(line, 1);
    if (!imm || !dest) return;
    const value = ctx.evaluate(imm.value);
    if (!value.known || value.value !== 1) return;

    const replacement = `ext.l ${dest.register}`;
    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence: "certain",
      message:
        "Signed word multiplication by one is just sign extension to long",
      loc: line.mnemonic!.loc,
      suggestion: {
        description: `Use ${replacement.toUpperCase()}`,
        replacement,
        applicability: "safe",
      },
    });
  },
};

export const multiplyUnsignedWordByOne: Rule = {
  meta: {
    obfuscated: true,
    id: "optimization/mulu-word-by-one",
    category: "optimization",
    defaultSeverity: "suggestion",
    description: "Replace MULU.W #1 with a zero-extension sequence",
    tags: ["asp68k", "multiply", "constant"],
    serves: "speed",
    docs: { source: "ASP68K", example: { source: "\tmulu.w #1,d0" } },
  },
  checkLine(ctx, line) {
    if (!isInstruction(line, "mulu") || wordFormSize(line) !== "w") return;
    if (!targetsOnly(ctx.config, ["mc68000", "mc68010", "mc68030", "mc68040"]))
      return;
    const imm = immediateOperand(line, 0);
    const dest = dataRegisterOperand(line, 1);
    if (!imm || !dest) return;
    const value = ctx.evaluate(imm.value);
    if (!value.known || value.value !== 1) return;

    const r = dest.register;
    const replacement = `swap ${r}\nclr.w ${r}\nswap ${r}`;
    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence: "certain",
      message:
        "Unsigned word multiplication by one only zero-extends the low word",
      loc: line.mnemonic!.loc,
      suggestion: {
        description: `Zero-extend ${r.toUpperCase()} without MULU`,
        replacement,
        applicability: "safe",
      },
    });
  },
};

export const multiplySignedWordPowerOfTwo: Rule = {
  meta: {
    obfuscated: true,
    id: "optimization/muls-word-power-of-two",
    category: "optimization",
    defaultSeverity: "suggestion",
    description:
      "Replace signed word multiply by a small power of two with EXT plus ASL",
    tags: ["asp68k", "multiply", "constant", "ccr"],
    docs: {
      source: "ASP68K",
      note: "Unlike its MULU/high-power-of-two siblings in this file, this one stays a clean win on 68020 too (verified with 68kcounter: 19 fewer cycles, no byte cost).",
      example: { source: "\tmuls.w #8,d0\n\tmove.l d0,d1" },
    },
  },
  checkLine(ctx, line, index) {
    if (
      !isInstruction(line, "muls") ||
      wordFormSize(line) !== "w" ||
      !targetsOnly(ctx.config, [
        "mc68000",
        "mc68010",
        "mc68020",
        "mc68030",
        "mc68040",
      ])
    )
      return;
    const imm = immediateOperand(line, 0);
    const dest = dataRegisterOperand(line, 1);
    if (!imm || !dest) return;
    const value = ctx.evaluate(imm.value);
    if (
      !value.known ||
      !isPowerOfTwo(value.value) ||
      value.value < 2 ||
      value.value > 256
    )
      return;
    const shift = Math.log2(value.value);
    if (!Number.isInteger(shift) || shift < 1 || shift > 8) return;
    // On 68000, sign-extending to a long is wasted work when the old upper
    // word is never read: muls-word-low-word-only offers a plain ASL.W there,
    // cheaper, and it now does so even when that is merely not disproven.
    if (
      strictly68000(ctx) &&
      ctx.registers.upperWordUseAfter(index, dest.register) !== "used"
    )
      return;

    // N/Z describe the final result in both forms. MULS clears V/C and preserves X,
    // whereas ASL derives X/V/C from the shift, so those are the observable differences.
    const safety = changedFlagsApplicability(ctx, index, ["X", "V", "C"]);
    const r = dest.register;
    const replacement = `ext.l ${r}\nasl.l #${shift},${r}`;
    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence: safety.confidence,
      message: `MULS.W by ${value.value} can be expressed as sign-extension plus a ${shift}-bit shift`,
      loc: line.mnemonic!.loc,
      suggestion: {
        description: `Use EXT.L + ASL.L #${shift}`,
        replacement,
        applicability: safety.applicability,
      },
      notes: [
        ...(safety.applicability === "safe"
          ? [
              {
                message:
                  "The differing X/V/C values are dead after this instruction.",
              },
            ]
          : [
              {
                message:
                  "ASL can leave different X/V/C values from MULS; review any later flag use.",
              },
            ]),
      ],
    });
  },
};

export const multiplyUnsignedWordPowerOfTwo: Rule = {
  meta: {
    obfuscated: true,
    id: "optimization/mulu-word-power-of-two",
    category: "optimization",
    defaultSeverity: "suggestion",
    description:
      "Replace unsigned word multiply by a small power of two with zero-extension plus LSL",
    tags: ["asp68k", "multiply", "constant", "ccr"],
    serves: "speed",
    docs: {
      source: "ASP68K",
      example: { source: "\tmulu.w #8,d0\n\tmove.l d0,d1" },
    },
  },
  checkLine(ctx, line, index) {
    if (
      !isInstruction(line, "mulu") ||
      wordFormSize(line) !== "w" ||
      !powerOfTwoTimingUseful(ctx)
    )
      return;
    const imm = immediateOperand(line, 0);
    const dest = dataRegisterOperand(line, 1);
    if (!imm || !dest) return;
    const value = ctx.evaluate(imm.value);
    if (
      !value.known ||
      !isPowerOfTwo(value.value) ||
      value.value < 2 ||
      value.value > 256
    )
      return;
    const shift = Math.log2(value.value);
    if (!Number.isInteger(shift) || shift < 1 || shift > 8) return;
    // On 68000, zero-extending to a long is wasted work when the old upper
    // word is never read: mulu-word-low-word-only offers a plain LSL.W there,
    // cheaper, and it now does so even when that is merely not disproven.
    if (
      strictly68000(ctx) &&
      ctx.registers.upperWordUseAfter(index, dest.register) !== "used"
    )
      return;

    const safety = changedFlagsApplicability(ctx, index, ["X", "V", "C"]);
    const r = dest.register;
    const replacement = `swap ${r}\nclr.w ${r}\nswap ${r}\nlsl.l #${shift},${r}`;
    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence: safety.confidence,
      message: `MULU.W by ${value.value} can be expressed as zero-extension plus a ${shift}-bit shift`,
      loc: line.mnemonic!.loc,
      suggestion: {
        description: `Zero-extend then LSL.L #${shift}`,
        replacement,
        applicability: safety.applicability,
      },
      notes: [
        ...(safety.applicability === "safe"
          ? [
              {
                message:
                  "The differing X/V/C values are dead after this instruction.",
              },
            ]
          : [
              {
                message:
                  "LSL can leave different X/V/C values from MULU; review later flag use.",
              },
            ]),
      ],
    });
  },
};

export const multiplySignedWordHighPowerOfTwo: Rule = {
  meta: {
    obfuscated: true,
    id: "optimization/muls-word-high-power-of-two",
    category: "optimization",
    defaultSeverity: "suggestion",
    description:
      "Replace signed word multiply by a large power of two with SWAP/CLR/ASR",
    tags: ["asp68k", "multiply", "constant", "ccr"],
    serves: "speed",
    docs: {
      source: "ASP68K",
      example: { source: "\tmuls.w #1024,d0\n\tmove.l d0,d1" },
    },
  },
  checkLine(ctx, line, index) {
    if (
      !isInstruction(line, "muls") ||
      wordFormSize(line) !== "w" ||
      !powerOfTwoTimingUseful(ctx)
    )
      return;
    const imm = immediateOperand(line, 0);
    const dest = dataRegisterOperand(line, 1);
    if (!imm || !dest) return;
    const value = ctx.evaluate(imm.value);
    if (
      !value.known ||
      !isPowerOfTwo(value.value) ||
      value.value < 512 ||
      value.value > 32768
    )
      return;
    const shift = Math.log2(value.value);
    if (!Number.isInteger(shift) || shift < 9 || shift > 15) return;
    // On 68000, muls-word-low-word-only now covers powers of two above the
    // generated tables too, with a plain ASL.W; leave it there when the upper
    // word is not proven used.
    if (
      strictly68000(ctx) &&
      ctx.registers.upperWordUseAfter(index, dest.register) !== "used"
    )
      return;

    const safety = changedFlagsApplicability(ctx, index, ["X", "V", "C"]);
    const r = dest.register;
    const right = 16 - shift;
    const replacement = `swap ${r}\nclr.w ${r}\nasr.l #${right},${r}`;
    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence: safety.confidence,
      message: `MULS.W by ${value.value} can use the high-word shift construction`,
      loc: line.mnemonic!.loc,
      suggestion: {
        description: `Use SWAP + CLR.W + ASR.L #${right}`,
        replacement,
        applicability: safety.applicability,
      },
      notes: [
        ...(safety.applicability === "safe"
          ? [
              {
                message:
                  "The differing X/V/C values are dead after this instruction.",
              },
            ]
          : [
              {
                message:
                  "The replacement can leave different X/V/C values from MULS; review later flag use.",
              },
            ]),
      ],
    });
  },
};

export const multiplyUnsignedWordHighPowerOfTwo: Rule = {
  meta: {
    obfuscated: true,
    id: "optimization/mulu-word-high-power-of-two",
    category: "optimization",
    defaultSeverity: "suggestion",
    description:
      "Replace unsigned word multiply by a large power of two with SWAP/CLR/LSR",
    tags: ["asp68k", "multiply", "constant", "ccr"],
    serves: "speed",
    docs: {
      source: "ASP68K",
      example: { source: "\tmulu.w #1024,d0\n\tmove.l d0,d1" },
    },
  },
  checkLine(ctx, line, index) {
    if (
      !isInstruction(line, "mulu") ||
      wordFormSize(line) !== "w" ||
      !powerOfTwoTimingUseful(ctx)
    )
      return;
    const imm = immediateOperand(line, 0);
    const dest = dataRegisterOperand(line, 1);
    if (!imm || !dest) return;
    const value = ctx.evaluate(imm.value);
    if (
      !value.known ||
      !isPowerOfTwo(value.value) ||
      value.value < 512 ||
      value.value > 32768
    )
      return;
    const shift = Math.log2(value.value);
    if (!Number.isInteger(shift) || shift < 9 || shift > 15) return;
    // On 68000, mulu-word-low-word-only now covers powers of two above the
    // generated tables too, with a plain LSL.W; leave it there when the upper
    // word is not proven used.
    if (
      strictly68000(ctx) &&
      ctx.registers.upperWordUseAfter(index, dest.register) !== "used"
    )
      return;

    const safety = changedFlagsApplicability(ctx, index, ["X", "V", "C"]);
    const r = dest.register;
    const right = 16 - shift;
    const replacement = `swap ${r}\nclr.w ${r}\nlsr.l #${right},${r}`;
    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence: safety.confidence,
      message: `MULU.W by ${value.value} can use the high-word logical-shift construction`,
      loc: line.mnemonic!.loc,
      suggestion: {
        description: `Use SWAP + CLR.W + LSR.L #${right}`,
        replacement,
        applicability: safety.applicability,
      },
      notes: [
        ...(safety.applicability === "safe"
          ? [
              {
                message:
                  "The differing X/V/C values are dead after this instruction.",
              },
            ]
          : [
              {
                message:
                  "The replacement can leave different X/V/C values from MULU; review later flag use.",
              },
            ]),
      ],
    });
  },
};
