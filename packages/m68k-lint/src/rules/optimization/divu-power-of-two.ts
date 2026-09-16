import type { Rule } from "../../core/rule.js";
import {
  dataRegisterOperand,
  immediateExpressionOperand,
  instructionSize,
  isInstruction,
} from "../../util/ast.js";
import { changedFlagsApplicability, isPowerOfTwo } from "./helpers.js";

function log2Exact(value: number): number | undefined {
  if (!isPowerOfTwo(value)) return undefined;
  const result = Math.log2(value);
  return Number.isInteger(result) ? result : undefined;
}

function unsigned32(value: number): number {
  return value >>> 0;
}

export const divuWordPowerOfTwo: Rule = {
  meta: {
    obfuscated: true,
    id: "optimization/divu-word-power-of-two",
    category: "optimization",
    defaultSeverity: "suggestion",
    description:
      "Replace unsigned word division by a power of two with a logical shift when its remainder semantics are not needed",
    tags: ["asp68k", "divide", "shift", "remainder", "review"],
    docs: { source: "ASP68K" },
  },
  checkLine(ctx, line, index) {
    if (!isInstruction(line, "divu") || instructionSize(line) !== "w") return;
    const immediate = immediateExpressionOperand(line, 0);
    const dest = dataRegisterOperand(line, 1);
    if (!immediate || !dest) return;
    const divisor = ctx.evaluate(immediate);
    if (!divisor.known) return;
    const shift = log2Exact(divisor.value);
    // DIVU.W has a 16-bit divisor. 2^16 would encode as zero, not 65536.
    if (shift === undefined || shift < 1 || shift > 15) return;

    let replacement: string;
    let scratch: string | undefined;
    if (shift <= 8) {
      replacement = `lsr.l #${shift},${dest.register}`;
    } else {
      scratch = ctx.registers
        .deadDataRegistersAfter(index)
        .find(
          (register) => register.toLowerCase() !== dest.register.toLowerCase(),
        );
      if (!scratch) return;
      replacement = `moveq #${shift},${scratch}\nlsr.l ${scratch},${dest.register}`;
    }

    // A DIVU.W result packs remainder:quotient in Dn. A shift only produces the
    // quotient. Track whether the upper word is actually observed after this point.
    const upperUse = ctx.registers.upperWordUseAfter(index, dest.register);
    if (upperUse === "used") return;

    const knownDividend = ctx.registers.knownConstantBefore(
      index,
      dest.register,
    );
    let quotientFits = false;
    let valueNote: string;
    if (knownDividend !== undefined) {
      const dividend = unsigned32(knownDividend);
      const quotient = Math.floor(dividend / divisor.value);
      const remainder = dividend % divisor.value;
      quotientFits = quotient <= 0xffff;
      if (quotientFits && upperUse === "unused") {
        valueNote = `The known dividend ${dividend} produces quotient ${quotient}; the upper word is provably unobserved, so remainder ${remainder} is irrelevant.`;
      } else if (quotientFits) {
        valueNote = `The known dividend ${dividend} produces quotient ${quotient}, but use of DIVU.W's packed remainder is not fully known.`;
      } else {
        valueNote = `The known dividend ${dividend} would overflow DIVU.W's 16-bit quotient; a plain shift is not equivalent.`;
      }
    } else if (upperUse === "unused") {
      valueNote =
        "The upper word of Dn is provably discarded before use, so the packed remainder is irrelevant; quotient-overflow range is still unproven.";
    } else {
      valueNote =
        "The analyser cannot prove whether Dn's upper-word remainder is observed after the division.";
    }
    const flags = changedFlagsApplicability(ctx, index, [
      "X",
      "N",
      "Z",
      "V",
      "C",
    ]);
    const valueSafe = quotientFits && upperUse === "unused";
    const applicability =
      valueSafe && flags.applicability === "safe" ? "safe" : "conditional";
    const confidence = valueSafe
      ? flags.confidence
      : upperUse === "unused"
        ? "high"
        : "medium";

    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence,
      message: `DIVU.W by ${divisor.value} can use a ${shift}-bit logical right shift if the packed remainder is not required`,
      loc: line.mnemonic!.loc,
      suggestion: {
        description:
          shift <= 8
            ? "Use an immediate LSR.L"
            : `Use ${scratch} as a dead shift-count register`,
        replacement,
        applicability,
      },
      notes: [
        { message: valueNote },
        {
          message:
            upperUse === "unused"
              ? "The packed remainder is provably not observed."
              : "Review whether Dn's upper word (the DIVU.W remainder) is used before it is overwritten.",
        },
        {
          message:
            flags.applicability === "safe"
              ? "The differing CCR outputs are dead."
              : "DIVU and LSR do not have identical CCR effects; review subsequent flag use.",
        },
      ],
      data: {
        divisor: divisor.value,
        shift,
        scratch,
        upperWordUse: upperUse,
        quotientOverflowProvenSafe: quotientFits,
      },
    });
  },
};

export const divuLongPowerOfTwo: Rule = {
  meta: {
    obfuscated: true,
    id: "optimization/divu-long-power-of-two",
    category: "optimization",
    defaultSeverity: "suggestion",
    description:
      "Replace unsigned long division by a power of two with a logical shift",
    tags: ["asp68k", "divide", "shift", "68020+"],
    docs: { source: "ASP68K" },
  },
  checkLine(ctx, line, index) {
    if (!isInstruction(line, "divu") || instructionSize(line) !== "l") return;
    if (
      ctx.config.processors.some(
        (cpu) => cpu === "mc68000" || cpu === "mc68010",
      )
    )
      return;
    const immediate = immediateExpressionOperand(line, 0);
    const dest = dataRegisterOperand(line, 1);
    if (!immediate || !dest) return;
    const divisor = ctx.evaluate(immediate);
    if (!divisor.known) return;
    const unsignedDivisor = unsigned32(divisor.value);
    const shift = log2Exact(unsignedDivisor);
    if (shift === undefined || shift < 1 || shift > 31) return;

    let replacement: string;
    let scratch: string | undefined;
    if (shift <= 8) {
      replacement = `lsr.l #${shift},${dest.register}`;
    } else {
      scratch = ctx.registers
        .deadDataRegistersAfter(index)
        .find(
          (register) => register.toLowerCase() !== dest.register.toLowerCase(),
        );
      if (!scratch) return;
      replacement = `moveq #${shift},${scratch}\nlsr.l ${scratch},${dest.register}`;
    }

    const flags = changedFlagsApplicability(ctx, index, [
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
      confidence: flags.confidence,
      message: `DIVU.L by ${unsignedDivisor} can use a ${shift}-bit logical right shift`,
      loc: line.mnemonic!.loc,
      suggestion: {
        description:
          shift <= 8
            ? "Use an immediate LSR.L"
            : `Use ${scratch} as a dead shift-count register`,
        replacement,
        applicability: flags.applicability,
      },
      notes: [
        {
          message:
            "Unlike DIVU.W, this two-operand long form does not leave a packed remainder in the upper word of Dn.",
        },
        {
          message:
            flags.applicability === "safe"
              ? "The differing CCR outputs are dead."
              : "DIVU.L and LSR do not have identical CCR effects; review subsequent flag use.",
        },
      ],
      data: { divisor: unsignedDivisor, shift, scratch },
    });
  },
};
