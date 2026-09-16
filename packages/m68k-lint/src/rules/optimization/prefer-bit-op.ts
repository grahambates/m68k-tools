import type { Rule } from "../../core/rule.js";
import {
  dataRegisterOperand,
  immediateOperand,
  instructionSize,
  isInstruction,
} from "../../util/ast.js";
import { changedFlagsApplicability, isPowerOfTwo } from "./helpers.js";

function bitRule(kind: "or" | "and"): Rule {
  const id =
    kind === "or" ? "optimization/prefer-bset" : "optimization/prefer-bclr";
  return {
    meta: {
      // The computed bit number replaces the original mask expression.
      obfuscated: true,
      id,
      category: "optimization",
      defaultSeverity: "suggestion",
      description: `Prefer ${kind === "or" ? "BSET" : "BCLR"} for a one-bit mask`,
      tags: ["asp68k", "ccr"],
      docs: {
        source: "ASP68K",
        example: {
          source:
            kind === "or"
              ? "\tor.l #8,d0\n\tadd.l d1,d2"
              : "\tand.l #$fffffff7,d0\n\tadd.l d1,d2",
        },
      },
    },
    checkLine(ctx, line, index) {
      if (!isInstruction(line, kind) || instructionSize(line) !== "l") return;
      const imm = immediateOperand(line, 0);
      const dest = dataRegisterOperand(line, 1);
      if (!imm || !dest || imm.value.type === "string-literal") return;
      const raw = ctx.evaluate(imm.value);
      if (!raw.known) return;
      // Verified with 68kcounter: both stay a clean win through 68030 and on
      // 68060; 68040 costs 2 cycles more than the mask form there, so it
      // stays excluded for both.
      const allowed = ["mc68000", "mc68010", "mc68020", "mc68030", "mc68060"];
      if (!ctx.config.processors.every((cpu) => allowed.includes(cpu))) return;
      const mask = kind === "or" ? raw.value >>> 0 : ~raw.value >>> 0;
      if (!isPowerOfTwo(mask)) return;
      const bit = Math.log2(mask);
      const safety = changedFlagsApplicability(ctx, index, ["N", "V", "C"]);
      ctx.report({
        ruleId: id,
        category: "optimization",
        severity: "suggestion",
        confidence: safety.confidence,
        message: `${kind.toUpperCase()} mask changes exactly one bit`,
        loc: line.mnemonic!.loc,
        suggestion: {
          description: `Use ${kind === "or" ? "BSET" : "BCLR"} #${bit}`,
          replacement: `${kind === "or" ? "bset" : "bclr"}.l #${bit},${dest.register}`,
          applicability: safety.applicability,
        },
        notes: [
          ...(safety.applicability === "safe"
            ? [
                {
                  message:
                    "N/V/C are dead after this instruction, so the differing flag effects are unobservable.",
                },
              ]
            : [
                {
                  message:
                    "Replacement has different condition-code effects; review subsequent flag use.",
                },
              ]),
        ],
      });
    },
  };
}
export const preferBset = bitRule("or");
export const preferBclr = bitRule("and");
