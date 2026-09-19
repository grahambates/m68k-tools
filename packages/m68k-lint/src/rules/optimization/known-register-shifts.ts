import type { Rule } from "../../core/rule.js";
import type { RuleContext } from "../../core/context.js";
import {
  dataRegisterOperand,
  immediateExpressionOperand,
  instructionSize,
  isInstruction,
} from "../../util/ast.js";
import { canonicalMnemonic } from "../../semantics/mnemonics.js";
import { changedFlagsApplicability } from "./helpers.js";
import { hex } from "../../util/format.js";
import { targetsOnly } from "../../core/config.js";

function m68000Only(ctx: RuleContext): boolean {
  return ctx.config.processors.every((cpu) => cpu === "mc68000");
}

function hasInterveningLabel(
  ctx: RuleContext,
  from: number,
  to: number,
): boolean {
  for (let i = from + 1; i <= to; i++) if (ctx.line(i)?.label) return true;
  return false;
}

function precedingMoveq(
  ctx: RuleContext,
  index: number,
  register: string,
  count: number,
) {
  const previous = ctx.previousInstruction(index);
  if (
    !previous ||
    hasInterveningLabel(ctx, previous.index, index) ||
    !isInstruction(previous.line, "moveq")
  )
    return undefined;
  const expr = immediateExpressionOperand(previous.line, 0);
  const dst = dataRegisterOperand(previous.line, 1);
  if (!expr || !dst || dst.register.toLowerCase() !== register)
    return undefined;
  const value = ctx.evaluate(expr);
  if (!value.known || value.value !== count) return undefined;
  return previous;
}

function canRemoveCountSetup(
  ctx: RuleContext,
  setupIndex: number,
  shiftIndex: number,
  register: string,
  count: number,
): boolean {
  if (ctx.registers.isLiveAfter(shiftIndex, register) === "dead") return true;
  return ctx.registers.knownConstantBefore(setupIndex, register) === count;
}

/**
 * Flamewing's register-count logical-shift-to-zero family. The register shift
 * count is taken modulo 64 on every 68k model, so for a non-zero count at
 * least as wide as the operand, LSL/ASL/LSR necessarily produce zero.
 *
 * Unlike its siblings in this file, this one is not 68000-only: replacing the
 * shift with CLR/MOVEQ is a genuine win on the 68020's barrel shifter too, not
 * just 68000's linear one. Confirmed with 68kcounter: a register-count
 * LSR.L/LSL.L costs 8+2n cycles on 68000 (72 cycles at n=32) against MOVEQ's
 * flat 4, and on 68020 the barrel shifter still costs a flat 6 against
 * MOVEQ's flat 3 -- half the cost, not a wash -- at the same byte count
 * either way.
 */
export const knownRegisterShiftToClear: Rule = {
  meta: {
    obfuscated: true,
    id: "optimization/known-register-shift-to-clear",
    category: "optimization",
    defaultSeverity: "suggestion",
    description:
      "Replace a known large register-count logical shift with a clear",
    tags: ["flamewing", "shift", "register-count", "ccr"],
    docs: {
      source: "Flamewing M68000 Peephole Optimizations",
      example: {
        source: "\tmoveq #32,d1\n\tlsr.l d1,d0\n\tmoveq #0,d1\n\tmove.l d2,d3",
      },
    },
  },
  checkLine(ctx, line, index) {
    const mnemonic = canonicalMnemonic(line);
    if (mnemonic !== "lsl" && mnemonic !== "asl" && mnemonic !== "lsr") return;
    const size = instructionSize(line);
    if (size !== "b" && size !== "w" && size !== "l") return;
    const countReg = dataRegisterOperand(line, 0);
    const valueReg = dataRegisterOperand(line, 1);
    if (!countReg || !valueReg) return;
    const countRegister = countReg.register.toLowerCase();
    if (countRegister === valueReg.register.toLowerCase()) return;

    const known = ctx.registers.knownConstantBefore(index, countRegister);
    if (known === undefined) return;
    const effectiveCount = known & 63;
    const width = size === "b" ? 8 : size === "w" ? 16 : 32;
    if (effectiveCount < width || effectiveCount === 0) return;

    const replacement =
      size === "l"
        ? `moveq #0,${valueReg.register}`
        : `clr.${size} ${valueReg.register}`;
    const setup = precedingMoveq(ctx, index, countRegister, known);
    const removeSetup =
      !!setup &&
      canRemoveCountSetup(ctx, setup.index, index, countRegister, known);
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
      message: `${mnemonic.toUpperCase()}.${size.toUpperCase()} uses a known count of ${effectiveCount}, which necessarily clears the ${width}-bit result`,
      loc: (removeSetup ? setup.line.mnemonic : line.mnemonic)!.loc,
      suggestion: {
        description: removeSetup
          ? "Replace the count setup and shift with a clear"
          : "Replace the shift with a clear",
        replacement,
        applicability: safety.applicability,
      },
      notes: [
        ...(removeSetup
          ? [
              {
                message: `${countReg.register.toUpperCase()} is dead afterwards or already held the same count before MOVEQ, so the setup can be removed.`,
              },
            ]
          : [
              {
                message: `${countReg.register.toUpperCase()} is preserved; only replace the shift instruction.`,
              },
            ]),
        ...(safety.applicability === "safe"
          ? []
          : [
              {
                message:
                  "The clear form has different CCR behaviour from the original multi-bit shift.",
              },
            ]),
      ],
      data: {
        secondInstructionIndex: removeSetup ? index : undefined,
        countRegister,
        shiftCount: effectiveCount,
        removedCountSetup: removeSetup,
      },
    });
  },
};

/** LSR.B #7 leaves only the original sign bit in bit zero. */
export const lsrByteSeven: Rule = {
  meta: {
    obfuscated: true,
    id: "optimization/lsr-byte-seven",
    category: "optimization",
    defaultSeverity: "suggestion",
    description: "Replace LSR.B #7 with ADD/SUBX/NEG on 68000",
    tags: ["flamewing", "68000", "shift", "ccr"],
    serves: "speed",
    docs: {
      source: "Flamewing M68000 Peephole Optimizations",
      example: {
        source: "\tlsr.b #7,d0\n\tmove.l d1,d2\n\trts",
        config: { processors: ["mc68000"] },
      },
    },
  },
  checkLine(ctx, line, index) {
    if (
      !m68000Only(ctx) ||
      !isInstruction(line, "lsr") ||
      instructionSize(line) !== "b"
    )
      return;
    const expr = immediateExpressionOperand(line, 0);
    const dst = dataRegisterOperand(line, 1);
    if (!expr || !dst) return;
    const value = ctx.evaluate(expr);
    if (!value.known || value.value !== 7) return;

    // The data result and N/Z/V agree.  The replacement's final X/C reflect
    // the original bit 7, whereas LSR #7 reports original bit 6.
    const safety = changedFlagsApplicability(ctx, index, ["X", "C"]);
    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence: safety.confidence,
      message: `LSR.B #7,${dst.register.toUpperCase()} can use ADD/SUBX/NEG on 68000`,
      loc: line.mnemonic!.loc,
      suggestion: {
        description: "Use the sign-bit extraction sequence",
        replacement: `add.b ${dst.register},${dst.register}\nsubx.b ${dst.register},${dst.register}\nneg.b ${dst.register}`,
        applicability: safety.applicability,
      },
      notes: [
        ...(safety.applicability === "safe"
          ? []
          : [
              { message: "X/C differ from LSR.B #7 and must not be observed." },
            ]),
      ],
    });
  },
};

/** ASR.B #7 and #8 both saturate a byte to $00 or $FF according to its sign. */
export const asrByteSaturate: Rule = {
  meta: {
    obfuscated: true,
    id: "optimization/asr-byte-saturate",
    category: "optimization",
    defaultSeverity: "suggestion",
    description: "Replace ASR.B #7/#8 with ADD/SUBX on 68000",
    tags: ["flamewing", "68000", "shift", "ccr"],
    serves: "speed",
    docs: {
      source: "Flamewing M68000 Peephole Optimizations",
      example: {
        source: "\tasr.b #8,d0\n\tmove.l d1,d2\n\trts",
        config: { processors: ["mc68000"] },
      },
    },
  },
  checkLine(ctx, line, index) {
    if (
      !m68000Only(ctx) ||
      !isInstruction(line, "asr") ||
      instructionSize(line) !== "b"
    )
      return;
    const expr = immediateExpressionOperand(line, 0);
    const dst = dataRegisterOperand(line, 1);
    if (!expr || !dst) return;
    const value = ctx.evaluate(expr);
    if (!value.known || (value.value !== 7 && value.value !== 8)) return;

    // ADD captures the original sign bit into X, then SUBX Dn,Dn produces
    // exactly $00 or $FF. SUBX has sticky-Z semantics and its final X/C do
    // not generally match ASR, so keep the CCR condition conservative.
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
      message: `ASR.B #${value.value},${dst.register.toUpperCase()} can use ADD.B/SUBX.B on 68000`,
      loc: line.mnemonic!.loc,
      suggestion: {
        description: "Use ADD.B followed by SUBX.B to sign-saturate the byte",
        replacement: `add.b ${dst.register},${dst.register}\nsubx.b ${dst.register},${dst.register}`,
        applicability: safety.applicability,
      },
      notes:
        safety.applicability === "safe"
          ? undefined
          : [
              {
                message:
                  "The replacement has different CCR semantics, especially SUBX's cumulative Z behaviour.",
              },
            ],
    });
  },
};

/**
 * Flamewing's non-stack register-count shift reductions. These are the same
 * value identities as the immediate-count long-shift rules, but triggered
 * when a preceding MOVEQ proves the register count and that setup can be
 * removed without changing observable register state.
 */
export const knownRegisterShiftReduction: Rule = {
  meta: {
    obfuscated: true,
    id: "optimization/known-register-shift-reduction",
    category: "optimization",
    defaultSeverity: "suggestion",
    description:
      "Reduce a known register-count shift to immediate word/SWAP operations",
    tags: ["flamewing", "68000", "shift", "register-count", "ccr"],
    serves: "speed",
    docs: {
      source: "Flamewing M68000 Peephole Optimizations",
      example: {
        source:
          "\tmoveq #30,d1\n\tlsl.l d1,d0\n\tmove.l d0,d2\n\tmoveq #0,d1\n\trts",
        config: { processors: ["mc68000"] },
      },
    },
  },
  checkLine(ctx, line, index) {
    if (!m68000Only(ctx)) return;
    const mnemonic = canonicalMnemonic(line);
    if (
      mnemonic !== "lsl" &&
      mnemonic !== "asl" &&
      mnemonic !== "lsr" &&
      mnemonic !== "asr"
    )
      return;
    const size = instructionSize(line);
    if (size !== "w" && size !== "l") return;
    const countReg = dataRegisterOperand(line, 0);
    const valueReg = dataRegisterOperand(line, 1);
    if (!countReg || !valueReg) return;
    const countRegister = countReg.register.toLowerCase();
    if (countRegister === valueReg.register.toLowerCase()) return;

    const known = ctx.registers.knownConstantBefore(index, countRegister);
    if (known === undefined) return;
    const count = known & 63;
    const wordRotateMask =
      size === "w" &&
      (mnemonic === "lsl" || mnemonic === "asl" || mnemonic === "lsr") &&
      count >= 10 &&
      count <= (mnemonic === "lsr" ? 14 : 15);
    const longWordSwap = size === "l" && count >= 16 && count <= 23;
    const longHighRotateMask =
      size === "l" &&
      (((mnemonic === "lsl" || mnemonic === "asl") &&
        count >= 26 &&
        count <= 31) ||
        (mnemonic === "lsr" && count >= 25 && count <= 30));
    if (!wordRotateMask && !longWordSwap && !longHighRotateMask) return;

    const setup = precedingMoveq(ctx, index, countRegister, known);
    if (
      !setup ||
      !canRemoveCountSetup(ctx, setup.index, index, countRegister, known)
    )
      return;

    const reg = valueReg.register;
    let replacement: string;
    if (size === "w") {
      const mask = ~((1 << count) - 1) & 0xffff;
      const maskText = hex(mask, 4);
      const rotate = 16 - count;
      replacement =
        mnemonic === "lsr"
          ? `andi.w #${maskText},${reg}\nrol.w #${rotate},${reg}`
          : `ror.w #${rotate},${reg}\nandi.w #${maskText},${reg}`;
    } else if ((mnemonic === "lsl" || mnemonic === "asl") && count >= 26) {
      const x = count - 24;
      const rotate = 8 - x;
      const mask = ~((1 << (8 + x)) - 1) & 0xffff;
      const maskText = hex(mask, 4);
      replacement = `ror.w #${rotate},${reg}\nandi.w #${maskText},${reg}\nswap ${reg}\nclr.w ${reg}`;
    } else if (mnemonic === "lsr" && count >= 25) {
      const x = count - 24;
      const rotate = 8 - x;
      const mask = ~((1 << (8 + x)) - 1) & 0xffff;
      const maskText = hex(mask, 4);
      replacement = `clr.w ${reg}\nswap ${reg}\nandi.w #${maskText},${reg}\nrol.w #${rotate},${reg}`;
    } else if (mnemonic === "lsl" || mnemonic === "asl") {
      replacement =
        count === 16
          ? `swap ${reg}\nclr.w ${reg}`
          : `${mnemonic}.w #${count - 16},${reg}\nswap ${reg}\nclr.w ${reg}`;
    } else if (mnemonic === "lsr") {
      replacement =
        count === 16
          ? `clr.w ${reg}\nswap ${reg}`
          : `clr.w ${reg}\nswap ${reg}\nlsr.w #${count - 16},${reg}`;
    } else {
      replacement =
        count === 16
          ? `swap ${reg}\next.l ${reg}`
          : `swap ${reg}\nasr.w #${count - 16},${reg}\next.l ${reg}`;
    }

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
      message: `${mnemonic.toUpperCase()}.${size.toUpperCase()} uses known register count ${count}; use the faster 68000 reduction`,
      loc: setup.line.mnemonic!.loc,
      suggestion: {
        description: "Replace the MOVEQ count setup and register-count shift",
        replacement,
        applicability: safety.applicability,
      },
      notes: [
        {
          message: `${countReg.register.toUpperCase()} is dead afterwards or already held the same count before MOVEQ, so the count setup can be removed.`,
        },
        ...(safety.applicability === "safe"
          ? []
          : [
              {
                message:
                  "The replacement produces different CCR results, so it is only safe when the changed flags are not observed.",
              },
            ]),
      ],
      data: { secondInstructionIndex: index, countRegister, shiftCount: count },
    });
  },
};

/**
 * Flamewing's ASR.W count 10..14 reduction. The low word is exact, but the
 * replacement leaves a different high word in Dn, so only use it when bits
 * 16..31 are provably discarded before any read.
 */
export const knownRegisterAsrWordLowOnly: Rule = {
  meta: {
    obfuscated: true,
    id: "optimization/known-register-asr-word-low-only",
    category: "optimization",
    defaultSeverity: "suggestion",
    description:
      "Reduce a known ASR.W count when only the low word is observed",
    tags: [
      "flamewing",
      "68000",
      "shift",
      "register-count",
      "partial-register",
      "ccr",
    ],
    serves: "speed",
    docs: {
      source: "Flamewing M68000 Peephole Optimizations",
      example: {
        source:
          "\tmoveq #12,d1\n\tasr.w d1,d0\n\tmove.w d0,d2\n\tmoveq #0,d0\n\tmoveq #0,d1\n\trts",
        config: { processors: ["mc68000"] },
      },
    },
  },
  checkLine(ctx, line, index) {
    if (
      !m68000Only(ctx) ||
      !isInstruction(line, "asr") ||
      instructionSize(line) !== "w"
    )
      return;
    const countReg = dataRegisterOperand(line, 0);
    const valueReg = dataRegisterOperand(line, 1);
    if (!countReg || !valueReg) return;
    const countRegister = countReg.register.toLowerCase();
    if (countRegister === valueReg.register.toLowerCase()) return;

    const known = ctx.registers.knownConstantBefore(index, countRegister);
    if (known === undefined) return;
    const count = known & 63;
    if (count < 10 || count > 14) return;

    const setup = precedingMoveq(ctx, index, countRegister, known);
    if (
      !setup ||
      !canRemoveCountSetup(ctx, setup.index, index, countRegister, known)
    )
      return;
    if (
      ctx.registers.registerBitsUseAfter(
        index,
        valueReg.register,
        0xffff0000,
      ) !== "unused"
    )
      return;

    const rotate = 16 - count;
    const reg = valueReg.register;
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
      message: `Only the low word of ${reg.toUpperCase()} is observed; ASR.W count ${count} can use EXT/SWAP/ROL on 68000`,
      loc: setup.line.mnemonic!.loc,
      suggestion: {
        description:
          "Replace the count setup and ASR.W with the low-word reduction",
        replacement: `ext.l ${reg}\nswap ${reg}\nrol.l #${rotate},${reg}`,
        applicability: safety.applicability,
      },
      notes: [
        {
          message: `The high word differs after this rewrite, but bits 16-31 of ${reg.toUpperCase()} are proven discarded before any read.`,
        },
        ...(safety.applicability === "safe"
          ? []
          : [
              {
                message:
                  "The replacement has different CCR results and requires the changed flags to be unobserved.",
              },
            ]),
      ],
      data: {
        secondInstructionIndex: index,
        countRegister,
        shiftCount: count,
        differingBits: "16-31",
        provenance: "flamewing",
      },
    });
  },
};

/** Full-result non-stack ASR.L reduction for known counts 26..30. */
export const knownRegisterAsrLongHighReduction: Rule = {
  meta: {
    obfuscated: true,
    id: "optimization/known-register-asr-long-high",
    category: "optimization",
    defaultSeverity: "suggestion",
    description: "Reduce a known high-count ASR.L to SWAP/EXT/ROL operations",
    tags: ["flamewing", "68000", "shift", "register-count", "ccr"],
    serves: "speed",
    docs: {
      source: "Flamewing M68000 Peephole Optimizations",
      example: {
        source:
          "\tmoveq #28,d1\n\tasr.l d1,d0\n\tmove.l d0,d2\n\tmoveq #0,d1\n\trts",
        config: { processors: ["mc68000"] },
      },
    },
  },
  checkLine(ctx, line, index) {
    if (
      !m68000Only(ctx) ||
      !isInstruction(line, "asr") ||
      instructionSize(line) !== "l"
    )
      return;
    const countReg = dataRegisterOperand(line, 0);
    const valueReg = dataRegisterOperand(line, 1);
    if (!countReg || !valueReg) return;
    const countRegister = countReg.register.toLowerCase();
    if (countRegister === valueReg.register.toLowerCase()) return;

    const known = ctx.registers.knownConstantBefore(index, countRegister);
    if (known === undefined) return;
    const count = known & 63;
    if (count < 26 || count > 30) return;

    const setup = precedingMoveq(ctx, index, countRegister, known);
    if (
      !setup ||
      !canRemoveCountSetup(ctx, setup.index, index, countRegister, known)
    )
      return;

    const rotate = 32 - count;
    const reg = valueReg.register;
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
      message: `ASR.L uses known count ${count}; a SWAP/EXT/ROL reduction is shorter on 68000 without using stack scratch`,
      loc: setup.line.mnemonic!.loc,
      suggestion: {
        description:
          "Replace the count setup and ASR.L with the high-count reduction",
        replacement: `swap ${reg}\next.l ${reg}\nswap ${reg}\nrol.l #${rotate},${reg}\next.l ${reg}`,
        applicability: safety.applicability,
      },
      notes: [
        ...(safety.applicability === "safe"
          ? []
          : [
              {
                message:
                  "The sequence produces different CCR results, so the changed flags must be unobserved.",
              },
            ]),
      ],
      data: {
        secondInstructionIndex: index,
        countRegister,
        shiftCount: count,
        provenance: "flamewing",
      },
    });
  },
};

/**
 * For ASR, any non-zero count at least width-1 leaves a value containing only
 * copies of the original sign bit.  ADD captures that sign bit into X and
 * SUBX Dn,Dn materializes exactly 0 or -1 at the operand width.
 */
export const knownRegisterAsrSaturate: Rule = {
  meta: {
    obfuscated: true,
    id: "optimization/known-register-asr-saturate",
    category: "optimization",
    defaultSeverity: "suggestion",
    description:
      "Replace a known large register-count ASR with ADD/SUBX saturation",
    tags: ["flamewing", "68000", "shift", "register-count", "ccr"],
    docs: {
      source: "Flamewing M68000 Peephole Optimizations",
      note: "Unlike its siblings in this file, the ADD/SUBX saturation sequence stays a clean win from 68010 through 68040 (verified with 68kcounter); only 68060 ties rather than improves, so it stays excluded.",
      example: {
        source:
          "\tmoveq #31,d1\n\tasr.l d1,d0\n\tmove.l d0,d2\n\tmoveq #0,d1\n\trts",
        config: { processors: ["mc68000"] },
      },
    },
  },
  checkLine(ctx, line, index) {
    if (
      !targetsOnly(ctx.config, [
        "mc68000",
        "mc68010",
        "mc68020",
        "mc68030",
        "mc68040",
      ]) ||
      !isInstruction(line, "asr")
    )
      return;
    const size = instructionSize(line);
    if (size !== "w" && size !== "l") return;
    const countReg = dataRegisterOperand(line, 0);
    const valueReg = dataRegisterOperand(line, 1);
    if (!countReg || !valueReg) return;
    const countRegister = countReg.register.toLowerCase();
    if (countRegister === valueReg.register.toLowerCase()) return;

    const known = ctx.registers.knownConstantBefore(index, countRegister);
    if (known === undefined) return;
    const count = known & 63;
    const threshold = size === "w" ? 15 : 31;
    if (count < threshold || count === 0) return;

    const setup = precedingMoveq(ctx, index, countRegister, known);
    if (
      !setup ||
      !canRemoveCountSetup(ctx, setup.index, index, countRegister, known)
    )
      return;

    const reg = valueReg.register;
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
      message: `ASR.${size.toUpperCase()} uses known count ${count}; the result is only sign saturation on 68000`,
      loc: setup.line.mnemonic!.loc,
      suggestion: {
        description:
          "Replace the count setup and ASR with ADD/SUBX sign saturation",
        replacement: `add.${size} ${reg},${reg}\nsubx.${size} ${reg},${reg}`,
        applicability: safety.applicability,
      },
      notes: [
        {
          message: `${countReg.register.toUpperCase()} is dead afterwards or already held the same count before MOVEQ, so its setup may be removed.`,
        },
        ...(safety.applicability === "safe"
          ? []
          : [
              {
                message:
                  "SUBX has different CCR behaviour, including cumulative-Z semantics.",
              },
            ]),
      ],
      data: { secondInstructionIndex: index, countRegister, shiftCount: count },
    });
  },
};
