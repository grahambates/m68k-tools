import type { Rule } from "../../core/rule.js";
import { semanticMnemonic } from "../../semantics/mnemonics.js";
import { immediateExpressionOperand, operand } from "../../util/ast.js";

const BIT_OPS = new Set(["btst", "bchg", "bclr", "bset"]);

function modulo(value: number, width: number): number {
  return ((Math.trunc(value) % width) + width) % width;
}

export const bitNumberWraparound: Rule = {
  meta: {
    id: "suspicious/bit-number-wraparound",
    category: "suspicious",
    defaultSeverity: "warning",
    description: "Flag immediate bit numbers that wrap modulo 8 or 32",
    tags: ["bit-operations", "likely-typo", "modulo"],
    docs: {
      source: "Motorola 68000 Family Programmer's Reference Manual",
      note: "Bit numbers are modulo 32 for data-register destinations and modulo 8 for memory destinations.",
    },
  },

  checkLine(ctx, line) {
    const name = semanticMnemonic(line);
    if (!name || !BIT_OPS.has(name)) return;

    const expression = immediateExpressionOperand(line, 0);
    const destination = operand(line, 1);
    if (!expression || !destination) return;

    const result = ctx.evaluate(expression);
    if (!result.known) return;

    const width = destination.type === "data-register" ? 32 : 8;
    if (result.value >= 0 && result.value < width) return;

    const actualBit = modulo(result.value, width);
    const target =
      destination.type === "data-register"
        ? destination.register.toUpperCase()
        : "memory";
    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence: "high",
      message: `${name.toUpperCase()} #${result.value} on ${target} actually selects bit ${actualBit} (modulo ${width})`,
      loc: line.operands?.[0]?.loc ?? line.mnemonic!.loc,
      suggestion: {
        description: `Review whether bit ${actualBit} was really intended`,
        applicability: "manual",
      },
    });
  },
};
