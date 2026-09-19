import type { Rule } from "../../core/rule.js";
import {
  addressRegisterOperand,
  immediateExpressionOperand,
  instructionSize,
  isInstruction,
} from "../../util/ast.js";
import { targetsOnly } from "../../core/config.js";

export const cmpaZeroToTst030: Rule = {
  meta: {
    // TST removes the explicit comparison value or expression.
    obfuscated: true,
    id: "optimization/cmpa-zero-to-tst-030",
    category: "optimization",
    defaultSeverity: "suggestion",
    description: "Use TST.L An for CMPA.L #0,An on 68020+",
    tags: ["asp68k", "68020+", "address-register", "ccr"],
    docs: {
      source: "ASP68K",
      note: "TST An is not a legal 68000/68010 addressing mode -- 68kcounter has no timing entry for it there at all, confirming ASP68K's own '-' (cannot be used) marker -- but its table does have one from 68020 on, where it is cycle-equal-or-faster than CMPA.L #0,An. The rule id keeps its historical '-030' spelling; ids are stable identifiers.",
      example: {
        source: "\tcmpa.l #0,a0",
        config: { processors: ["mc68020"] },
      },
    },
  },
  checkLine(ctx, line) {
    if (!targetsOnly(ctx.config, ["mc68020", "mc68030"])) return;
    if (!isInstruction(line, "cmpa") || instructionSize(line) !== "l") return;
    const expr = immediateExpressionOperand(line, 0);
    const dest = addressRegisterOperand(line, 1);
    if (!expr || !dest) return;
    const value = ctx.evaluate(expr);
    if (!value.known || value.value !== 0) return;
    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence: "certain",
      message: "CMPA.L #0,An can use TST.L An on 68020+",
      loc: line.mnemonic!.loc,
      suggestion: {
        description: "Use TST.L",
        replacement: `tst.l ${dest.register}`,
        applicability: "safe",
      },
      notes: [
        {
          message:
            "The long form has equivalent N/Z/V/C semantics for comparison with zero.",
        },
        {
          message:
            "The .W form is intentionally not implemented because CMPA.W sign-extends the source before a 32-bit address comparison.",
        },
      ],
    });
  },
};
