import type { Rule } from "../../core/rule.js";
import {
  dataRegisterOperand,
  immediateOperand,
  instructionSize,
  isInstruction,
} from "../../util/ast.js";
import { changedFlagsApplicability } from "./helpers.js";

function powerOfTwoExponent(value: number): number | undefined {
  if (!Number.isInteger(value) || value < 2 || value > 256) return undefined;
  const exponent = Math.log2(value);
  return Number.isInteger(exponent) ? exponent : undefined;
}

function supportsLongMultiply(
  ctx: Parameters<NonNullable<Rule["checkLine"]>>[0],
): boolean {
  return (
    ctx.config.processors.length > 0 &&
    ctx.config.processors.every((cpu) =>
      ["mc68020", "mc68030", "mc68040", "mc68060"].includes(cpu),
    )
  );
}

export const vasmNegativeSignedMultiply: Rule = {
  meta: {
    obfuscated: true,
    id: "optimization/negative-signed-multiply",
    category: "optimization",
    defaultSeverity: "suggestion",
    description:
      "Replace signed multiplication by -1 or a negative power of two with NEG/shift operations",
    tags: ["vasm", "multiply"],
    serves: "speed",
    docs: {
      source: "vasm m68k optimizer",
      example: { source: "\tmuls.w #-1,d0\n\tadd.l d1,d2" },
    },
  },
  checkLine(ctx, line, index) {
    if (!isInstruction(line, "muls")) return;
    const size = instructionSize(line);
    const imm = immediateOperand(line, 0);
    const dest = dataRegisterOperand(line, 1);
    if (!imm || !dest || imm.value.type === "string-literal") return;
    const evaluated = ctx.evaluate(imm.value);
    if (!evaluated.known || evaluated.value >= 0) return;

    const r = dest.register;
    let replacement: string | undefined;
    let note: string;

    if (evaluated.value === -1) {
      if (size === "l") {
        if (!supportsLongMultiply(ctx)) return;
        replacement = `neg.l ${r}`;
        note = "vasm replaces MULS.L #-1,Dn with NEG.L Dn.";
      } else if (size === "w") {
        replacement = `ext.l ${r}\nneg.l ${r}`;
        note = "Multiplying by -1 is a sign extension followed by a negation.";
      } else return;
    } else {
      if (size !== "l" || !supportsLongMultiply(ctx)) return;
      const exponent = powerOfTwoExponent(-evaluated.value);
      if (exponent === undefined) return;
      replacement = `asl.l #${exponent},${r}\nneg.l ${r}`;
      note = `vasm's -opt-mul/-opt-speed path replaces negative power-of-two long multiplies with ASL.L #${exponent} followed by NEG.L.`;
    }

    // The final value and N/Z are equivalent. MULS preserves X and has multiply-specific
    // V/C behaviour, whereas NEG/ASL derive X/V/C from arithmetic operations.
    const safety = changedFlagsApplicability(ctx, index, ["X", "V", "C"]);
    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence: safety.confidence,
      message: `MULS.${size?.toUpperCase()} by ${evaluated.value} can use shift/negate arithmetic`,
      loc: line.mnemonic!.loc,
      suggestion: {
        description: "Use shift/NEG arithmetic instead of MULS",
        replacement,
        applicability: safety.applicability,
      },
      notes: [
        { message: note },
        ...(safety.applicability === "safe"
          ? []
          : [{ message: "X/V/C may differ; review later CCR use." }]),
      ],
      data: { factor: evaluated.value, provenance: "vasm" },
    });
  },
};
