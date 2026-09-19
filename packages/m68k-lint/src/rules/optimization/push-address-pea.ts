import type { ParsedLine } from "m68k-parser";
import type { Rule } from "../../core/rule.js";
import {
  addressRegisterOperand,
  immediateOperand,
  instructionSize,
  isInstruction,
  operand,
} from "../../util/ast.js";
import {
  changedFlagsApplicability,
  negatedValueText,
  sourceOperand,
  valueText,
} from "./helpers.js";

function isStackPredecrement(line: ParsedLine, operandIndex: number): boolean {
  const op = operand(line, operandIndex);
  if (op?.type !== "address-register-indirect-predec") return false;
  return (
    op.register.type === "address-register" &&
    ["sp", "a7"].includes(op.register.register.toLowerCase())
  );
}

function isStackIndirect(line: ParsedLine, operandIndex: number): boolean {
  const op = operand(line, operandIndex);
  if (op?.type !== "address-register-indirect") return false;
  return (
    op.register.type === "address-register" &&
    ["sp", "a7"].includes(op.register.register.toLowerCase())
  );
}

function isLongMove(line: ParsedLine): boolean {
  return isInstruction(line, "move") && instructionSize(line) === "l";
}

function adjustment(line: ParsedLine): "add" | "sub" | undefined {
  if (isInstruction(line, "add")) return "add";
  if (isInstruction(line, "sub")) return "sub";
  return undefined;
}

export const pushAddressPea: Rule = {
  meta: {
    id: "optimization/push-address-pea",
    category: "optimization",
    defaultSeverity: "suggestion",
    description:
      "Fold an address-register push plus immediate stack adjustment into PEA",
    tags: ["asp68k", "stack", "peephole"],
    docs: {
      source: "ASP68K",
      example: { source: "\tmove.l a0,-(sp)\n\tadd.l #4,(sp)" },
    },
  },

  checkLine(ctx, line, index) {
    if (!isLongMove(line)) return;
    const sourceRegister = addressRegisterOperand(line, 0);
    if (!sourceRegister || !isStackPredecrement(line, 1)) return;

    const next = ctx.nextInstruction(index);
    if (!next) return;
    const op = adjustment(next.line);
    if (
      !op ||
      instructionSize(next.line) !== "l" ||
      !isStackIndirect(next.line, 1)
    )
      return;

    const imm = immediateOperand(next.line, 0);
    if (!imm) return;
    const value = ctx.evaluate(imm.value);
    if (!value.known) return;

    const displacement = op === "add" ? value.value : -value.value;
    const displacementText =
      op === "add"
        ? valueText(ctx, imm.value, displacement)
        : negatedValueText(ctx, imm.value, displacement);
    // On 68000-class addressing, d16(An) is the useful portable form.
    if (displacement < -32768 || displacement > 32767) return;

    const register = sourceOperand(ctx, line, 0) ?? sourceRegister.register;
    const changed = changedFlagsApplicability(ctx, next.index, [
      "X",
      "N",
      "Z",
      "V",
      "C",
    ]);

    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence: changed.confidence,
      message:
        "Address-register push plus immediate stack adjustment can be folded into PEA",
      loc: line.mnemonic!.loc,
      suggestion: {
        description: `Replace the two instructions with PEA ${displacement}(${register})`,
        replacement: `pea ${displacementText}(${register})`,
        applicability: changed.applicability,
      },
      notes: [
        ...(changed.applicability === "safe"
          ? []
          : [
              {
                message:
                  "PEA preserves CCR, while the original arithmetic writes flags; review any later CCR use.",
              },
            ]),
      ],
      data: { secondInstructionIndex: next.index },
    });
  },
};
