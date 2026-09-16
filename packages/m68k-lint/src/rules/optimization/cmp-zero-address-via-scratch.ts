import type { Rule } from "../../core/rule.js";
import { DATA_REGISTERS } from "../../semantics/registers.js";
import {
  addressRegisterOperand,
  immediateOperand,
  instructionSize,
  isInstructionFamily,
} from "../../util/ast.js";

export const cmpZeroAddressViaScratch: Rule = {
  meta: {
    obfuscated: true,
    id: "optimization/cmp-zero-address-via-scratch",
    category: "optimization",
    defaultSeverity: "suggestion",
    description:
      "Compare an address register with zero via a dead data register on early CPUs",
    tags: [
      "asp68k",
      "register-analysis",
      "scratch-register",
      "cmp",
      "address-register",
    ],
    docs: {
      source: "ASP68K",
      example: { source: "\tcmp.l #0,a0\n\tmoveq #1,d0\n\trts" },
    },
  },
  checkLine(ctx, line, index) {
    if (!isInstructionFamily(line, "cmp")) return;
    if (instructionSize(line) !== "l") return;
    const source = immediateOperand(line, 0);
    const dest = addressRegisterOperand(line, 1);
    if (!source || source.value.type === "string-literal" || !dest) return;
    const value = ctx.evaluate(source.value);
    if (!value.known || value.value !== 0) return;
    // Verified with 68kcounter: MOVE.L through a scratch register is
    // cycle-equal-or-faster than CMPA.L #0,An on every target checked.
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

    const scratch = DATA_REGISTERS.find(
      (r) => ctx.registers.isLiveAfter(index, r) === "dead",
    );
    if (!scratch) return;
    const replacement = `move.l ${dest.register},${scratch}`;

    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence: "certain",
      message: `${scratch.toUpperCase()} is dead here and can receive ${dest.register.toUpperCase()} to set zero/sign flags`,
      loc: line.mnemonic!.loc,
      suggestion: {
        description: `Use ${replacement.toUpperCase()}`,
        replacement,
        applicability: "safe",
      },
      notes: [
        {
          message:
            "Comparing through a scratch data register avoids the address-register form; the register used here is proven dead.",
        },
        {
          message:
            "The .W form is deliberately not suggested because its flag semantics are not equivalent to CMPA.W #0,An.",
        },
      ],
    });
  },
};
