import type { Rule } from "../../core/rule.js";
import {
  addressRegisterOperand,
  immediateOperand,
  instructionSize,
  isInstructionFamily,
} from "../../util/ast.js";
import { negatedValueText, valueText } from "./helpers.js";

function makeAddressImmediateLea(mnemonic: "add" | "sub"): Rule {
  const id =
    mnemonic === "add"
      ? "optimization/address-add-to-lea"
      : "optimization/address-sub-to-lea";
  return {
    meta: {
      id,
      category: "optimization",
      defaultSeverity: "suggestion",
      description: `Use LEA to ${mnemonic.toUpperCase()} immediate to an address register`,
      tags: ["asp68k", "address-register"],
      docs: {
        source: "ASP68K",
        example: { source: `\t${mnemonic}.l #100,a0` },
      },
    },
    checkLine(ctx, line) {
      if (!isInstructionFamily(line, mnemonic)) return;
      const size = instructionSize(line);
      if (size === "b") return;
      const imm = immediateOperand(line, 0);
      const dest = addressRegisterOperand(line, 1);
      if (!imm || imm.value.type === "string-literal" || !dest) return;
      const value = ctx.evaluate(imm.value);
      if (!value.known) return;
      const displacement = mnemonic === "add" ? value.value : -value.value;
      if (
        Math.abs(value.value) < 9 ||
        displacement < -32767 ||
        displacement > 32767
      )
        return;

      // ADD carries the immediate across untouched, so the displacement is
      // written exactly as the author wrote it. SUB has to negate it, which can
      // only be done in the text for a bare symbol or number.
      const displacementText =
        mnemonic === "add"
          ? valueText(ctx, imm.value, displacement)
          : negatedValueText(ctx, imm.value, displacement);

      const allowed =
        mnemonic === "add"
          ? ["mc68000", "mc68010", "mc68030"]
          : ["mc68000", "mc68010", "mc68030", "mc68040"];
      if (!ctx.config.processors.every((cpu) => allowed.includes(cpu))) return;

      ctx.report({
        ruleId: this.meta.id,
        category: this.meta.category,
        severity: this.meta.defaultSeverity,
        confidence: "high",
        message: `${mnemonic.toUpperCase()} immediate to ${dest.register} can use LEA on this target`,
        loc: line.mnemonic!.loc,
        suggestion: {
          description: `Use LEA`,
          replacement: `lea ${displacementText}(${dest.register}),${dest.register}`,
          applicability: "safe",
        },
      });
    },
  };
}

export const addressAddToLea = makeAddressImmediateLea("add");
export const addressSubToLea = makeAddressImmediateLea("sub");
