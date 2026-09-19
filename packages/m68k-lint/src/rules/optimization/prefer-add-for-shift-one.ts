import type { Rule } from "../../core/rule.js";
import {
  dataRegisterOperand,
  immediateOperand,
  instructionSize,
  isInstruction,
} from "../../util/ast.js";
import { changedFlagsApplicability } from "./helpers.js";
import { targetsOnly } from "../../core/config.js";

export const preferAddForShiftOne: Rule = {
  meta: {
    obfuscated: true,
    id: "optimization/prefer-add-for-shift-one",
    category: "optimization",
    defaultSeverity: "suggestion",
    description: "Consider ADD Dn,Dn for a one-bit left shift",
    tags: ["asp68k", "ccr"],
    docs: {
      source: "ASP68K",
      example: { source: "\tasl.w #1,d0\n\tmove.l d1,d2" },
    },
  },
  checkLine(ctx, line, index) {
    const shift = isInstruction(line, "asl")
      ? "ASL"
      : isInstruction(line, "lsl")
        ? "LSL"
        : undefined;
    if (!shift) return;
    const size = instructionSize(line);
    if (!size) return;
    const imm = immediateOperand(line, 0);
    const dest = dataRegisterOperand(line, 1);
    if (!imm || !dest) return;
    const value = ctx.evaluate(imm.value);
    if (!value.known || value.value !== 1) return;

    // ASP68K marks 060 as no win and leaves 020 unknown ("?" in its table).
    // Verified with 68kcounter: 020 is in fact a real win too (1 cycle).
    if (
      !targetsOnly(ctx.config, [
        "mc68000",
        "mc68010",
        "mc68020",
        "mc68030",
        "mc68040",
      ])
    )
      return;

    // Be deliberately conservative about subtle flag differences between shift
    // and arithmetic forms: only call it safe when all flags are dead.
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
      message: `${shift}.${size} #1 can be expressed as ADD.${size} Dn,Dn`,
      loc: line.mnemonic!.loc,
      suggestion: {
        description: `Use ADD.${size} ${dest.register},${dest.register}`,
        replacement: `add.${size} ${dest.register},${dest.register}`,
        applicability: safety.applicability,
      },
      notes: [
        ...(safety.applicability === "safe"
          ? []
          : [
              {
                message:
                  "Flag equivalence is not assumed here; review CCR use before applying.",
              },
            ]),
      ],
    });
  },
};
