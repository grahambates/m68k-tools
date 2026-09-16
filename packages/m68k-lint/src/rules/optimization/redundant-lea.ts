import type { Rule } from "../../core/rule.js";
import {
  addressRegisterOperand,
  isInstruction,
  operand,
} from "../../util/ast.js";
import { sourceOperand } from "./helpers.js";

/** The register a bare `(An)` or a zero-displacement `0(An)` dereferences, if it is one of those forms. */
function dereferencedRegister(
  ctx: Parameters<NonNullable<Rule["checkLine"]>>[0],
  line: Parameters<NonNullable<Rule["checkLine"]>>[1],
): string | undefined {
  const source = operand(line, 0);
  if (!source) return undefined;
  if (source.type === "address-register-indirect") {
    return source.register.type === "address-register"
      ? source.register.register
      : undefined;
  }
  if (source.type === "address-register-indirect-displacement") {
    if (source.register.type !== "address-register") return undefined;
    const result = ctx.evaluate(source.displacement);
    return result.known && result.value === 0
      ? source.register.register
      : undefined;
  }
  return undefined;
}

export const redundantLea: Rule = {
  meta: {
    id: "optimization/redundant-lea",
    category: "optimization",
    defaultSeverity: "suggestion",
    description: "Remove LEA (An),An when source and destination are identical",
    tags: ["asp68k", "redundant"],
    docs: { source: "ASP68K", example: { source: "\tlea (a0),a0" } },
  },

  checkLine(ctx, line) {
    if (!isInstruction(line, "lea")) return;

    const dest = addressRegisterOperand(line, 1);
    const sourceRegister = dereferencedRegister(ctx, line);
    if (!dest || !sourceRegister || sourceRegister !== dest.register) return;

    const rendered = sourceOperand(ctx, line, 0);
    if (!rendered) return;
    const canDeleteWholeLine = !line.label && !line.comment;

    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence: "certain",
      message: `LEA ${rendered},${dest.register} leaves ${dest.register.toUpperCase()} unchanged`,
      loc: line.mnemonic!.loc,
      suggestion: {
        description: canDeleteWholeLine
          ? "Remove the redundant instruction"
          : "Remove the instruction while preserving the label/comment",
        replacement: canDeleteWholeLine ? "" : undefined,
        applicability: canDeleteWholeLine ? "safe" : "manual",
      },
    });
  },
};
