import type { Rule } from "../../core/rule.js";
import {
  dataRegisterOperand,
  instructionSize,
  isInstruction,
} from "../../util/ast.js";

/** ASP68K: EXT.W Dn + EXT.L Dn -> EXTB.L Dn, available from the 68020 on. */
export const combineExtByte: Rule = {
  meta: {
    id: "optimization/combine-ext-byte",
    category: "optimization",
    defaultSeverity: "suggestion",
    description: "Combine EXT.W + EXT.L into EXTB.L",
    tags: ["asp68k", "sequence", "68020+"],
    docs: {
      source: "ASP68K",
      example: {
        source: "\text.w d0\n\text.l d0",
        config: { processors: ["mc68020"] },
      },
    },
  },

  checkLine(ctx, line, index) {
    if (
      !ctx.config.processors.every((cpu) =>
        ["mc68020", "mc68030", "mc68040", "mc68060"].includes(cpu),
      )
    )
      return;
    if (!isInstruction(line, "ext") || instructionSize(line) !== "w") return;
    const first = dataRegisterOperand(line, 0);
    if (!first) return;

    const next = ctx.nextInstruction(index);
    if (
      !next ||
      !isInstruction(next.line, "ext") ||
      instructionSize(next.line) !== "l"
    )
      return;
    const second = dataRegisterOperand(next.line, 0);
    if (
      !second ||
      second.register.toLowerCase() !== first.register.toLowerCase()
    )
      return;

    // A label on the second instruction can make it independently reachable.
    if (next.line.label) return;

    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence: "certain",
      message: "EXT.W followed by EXT.L is a byte-to-long sign extension",
      loc: line.mnemonic!.loc,
      suggestion: {
        description: `Use EXTB.L ${first.register}`,
        replacement: `extb.l ${first.register}`,
        applicability: "safe",
      },
      notes: [
        {
          message:
            "EXTB.L sign-extends byte to long in one instruction, and exists from the 68020.",
        },
      ],
      data: { secondInstructionIndex: next.index },
    });
  },
};
