import type { Rule } from "../../core/rule.js";
import {
  dataRegisterOperand,
  immediateOperand,
  instructionSize,
} from "../../util/ast.js";
import { changedFlagsApplicability } from "./helpers.js";
import { canonicalMnemonic } from "../../semantics/mnemonics.js";

export const shiftToClear: Rule = {
  meta: {
    // The replacement no longer shows the shift count or expression.
    obfuscated: true,
    id: "optimization/shift-to-clear",
    category: "optimization",
    defaultSeverity: "suggestion",
    description: "Replace shifts that necessarily clear the operand",
    tags: ["asp68k", "ccr"],
    docs: {
      source: "ASP68K",
      example: { source: "\tlsl.b #8,d0\n\tadd.l d1,d2" },
    },
  },
  checkLine(ctx, line, index) {
    const mnemonic = canonicalMnemonic(line) ?? "";
    if (!["asl", "lsl", "lsr"].includes(mnemonic)) return;
    const size = instructionSize(line);
    if (!size) return;
    const imm = immediateOperand(line, 0);
    const dest = dataRegisterOperand(line, 1);
    if (!imm || !dest) return;
    const v = ctx.evaluate(imm.value);
    if (!v.known) return;
    const width = size === "b" ? 8 : size === "w" ? 16 : 32;
    if (v.value < width) return;
    const safety = changedFlagsApplicability(ctx, index, [
      "X",
      "N",
      "Z",
      "V",
      "C",
    ]);
    const replacement =
      size === "l"
        ? `moveq #0,${dest.register}`
        : `clr.${size} ${dest.register}`;
    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence: safety.confidence,
      message: `${mnemonic.toUpperCase()}.${size} by ${v.value} necessarily clears this ${width}-bit value`,
      loc: line.mnemonic!.loc,
      suggestion: {
        description: `Use ${size === "l" ? "MOVEQ #0" : "CLR"}`,
        replacement,
        applicability: safety.applicability,
      },
      notes: [
        {
          message:
            "A shift at least as wide as the operand always produces zero, but the resulting flags differ.",
        },
        ...(safety.applicability === "safe"
          ? [{ message: "All condition-code differences are dead here." }]
          : [
              {
                message:
                  "Condition-code values may be observable after this instruction.",
              },
            ]),
      ],
    });
  },
};
