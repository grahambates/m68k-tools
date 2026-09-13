import type { ExpressionNode, OperandNode } from "m68k-parser";
import type { Rule } from "../../core/rule.js";

function directiveExpression(
  op: OperandNode | undefined,
): ExpressionNode | undefined {
  if (!op) return undefined;
  if (op.type === "value") return op.value;
  if (op.type === "immediate" && op.value.type !== "string-literal")
    return op.value;
  return undefined;
}

export const zeroSizedStorage: Rule = {
  meta: {
    id: "suspicious/zero-sized-storage",
    category: "suspicious",
    defaultSeverity: "warning",
    description: "Flag DS directives that reserve zero elements",
    tags: ["directives", "data-layout", "likely-typo"],
  },

  checkLine(ctx, line) {
    if (
      line.mnemonic?.type !== "directive" ||
      line.mnemonic.directive.toLowerCase() !== "ds"
    )
      return;

    const expression = directiveExpression(line.operands?.[0]);
    if (!expression) return;
    const count = ctx.evaluate(expression);
    if (!count.known || count.value !== 0) return;

    const size =
      line.qualifier?.type === "size"
        ? `.${line.qualifier.size.toUpperCase()}`
        : "";
    const label = line.label?.label ? ` for ${line.label.label}` : "";

    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence: "medium",
      message: `DS${size} reserves zero elements${label}`,
      loc: line.operands?.[0]?.loc ?? line.mnemonic.loc,
      suggestion: {
        description:
          "Check whether DC was intended, or remove the zero-sized declaration",
        applicability: "manual",
      },
      notes: [
        {
          message:
            "DS with a zero count reserves no payload. If the label is later treated as storage, a write can land on following data (after any assembler alignment effect).",
        },
        {
          message:
            "Some assemblers also use zero-sized DS forms as alignment idioms, so this remains a suspicious rather than correctness diagnostic.",
        },
      ],
    });
  },
};
