import type { Rule } from "../../core/rule.js";
import {
  dataRegisterOperand,
  immediateOperand,
  instructionSize,
  isInstruction,
} from "../../util/ast.js";
import { changedFlagsApplicability } from "./helpers.js";

/** ASP68K: ADD/SUB #0,Dn can use TST on CPUs where that is a timing/size win.
 *  ADD/SUB #0 and TST agree on N/Z/V/C, but ADD/SUB update X while TST preserves it.
 */
export const zeroArithmeticToTst: Rule = {
  meta: {
    // TST removes the original arithmetic and its immediate expression.
    obfuscated: true,
    id: "optimization/zero-arithmetic-to-tst",
    category: "optimization",
    defaultSeverity: "suggestion",
    description: "Use TST instead of adding/subtracting zero",
    tags: ["asp68k", "ccr"],
    docs: {
      source: "ASP68K",
      example: { source: "\tadd.l #0,d0\n\tadd.l d1,d2" },
    },
  },

  checkLine(ctx, line, index) {
    const mnemonic = isInstruction(line, "add")
      ? "add"
      : isInstruction(line, "sub")
        ? "sub"
        : undefined;
    if (!mnemonic) return;

    // ASP68K records the win on 000/010/030 and leaves 020 unknown ("?" in
    // its table). Verified with 68kcounter: 020 is a real cycle win too, and
    // 040/060 tie on cycles but TST still drops the immediate word, so all
    // three are a clean win by the same bar the other targets are held to.
    if (
      !ctx.config.processors.every((cpu) =>
        [
          "mc68000",
          "mc68010",
          "mc68020",
          "mc68030",
          "mc68040",
          "mc68060",
        ].includes(cpu),
      )
    )
      return;

    const imm = immediateOperand(line, 0);
    const dest = dataRegisterOperand(line, 1);
    const size = instructionSize(line);
    if (!imm || !dest || !size || imm.value.type === "string-literal") return;
    const value = ctx.evaluate(imm.value);
    if (!value.known || value.value !== 0) return;

    const safety = changedFlagsApplicability(ctx, index, ["X"]);
    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence: safety.confidence,
      message: `${mnemonic.toUpperCase()} of zero leaves the data value unchanged`,
      loc: line.mnemonic!.loc,
      suggestion: {
        description: `Use TST.${size} ${dest.register}`,
        replacement: `tst.${size} ${dest.register}`,
        applicability: safety.applicability,
      },
      notes: [
        ...(safety.applicability === "safe"
          ? [
              {
                message:
                  "X is dead after this instruction, so TST preserving X is unobservable.",
              },
            ]
          : [
              {
                message:
                  "ADD/SUB update X while TST preserves it; review later X/extend-dependent instructions.",
              },
            ]),
      ],
    });
  },
};
