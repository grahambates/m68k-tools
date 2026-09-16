import type { OperandNode } from "m68k-parser";
import type { Rule } from "../../core/rule.js";
import { registersReadByOperand } from "../../semantics/registers.js";
import {
  immediateOperand,
  instructionSize,
  isInstruction,
  operand,
} from "../../util/ast.js";
import { sourceOperand, valueText } from "./helpers.js";

function isMemoryDestination(op: OperandNode | undefined): boolean {
  return (
    !!op &&
    [
      "address-register-indirect",
      "address-register-indirect-postinc",
      "address-register-indirect-predec",
      "address-register-indirect-displacement",
      "address-register-indirect-index",
      "memory-indirect",
      "absolute-address",
    ].includes(op.type)
  );
}

export const moveImmediateViaScratch: Rule = {
  meta: {
    id: "optimization/move-immediate-via-scratch",
    category: "optimization",
    defaultSeverity: "suggestion",
    description:
      "Materialize a small long immediate with MOVEQ before storing it",
    tags: ["asp68k", "register-analysis", "scratch-register", "moveq"],
    docs: {
      source: "ASP68K",
      example: { source: "\tmove.l #42,(a0)\n\tmoveq #0,d0\n\trts" },
    },
  },
  checkLine(ctx, line, index) {
    if (!isInstruction(line, "move") || instructionSize(line) !== "l") return;
    const source = immediateOperand(line, 0);
    const dest = operand(line, 1);
    if (
      !source ||
      source.value.type === "string-literal" ||
      !isMemoryDestination(dest)
    )
      return;
    const value = ctx.evaluate(source.value);
    if (!value.known || value.value < -128 || value.value > 127) return;
    // Verified with 68kcounter: a clean win through 68030; 68040/68060 were
    // not measured as improvements here and stay excluded.
    if (
      !ctx.config.processors.every((cpu) =>
        ["mc68000", "mc68010", "mc68020", "mc68030"].includes(cpu),
      )
    )
      return;

    const addressRegisters = registersReadByOperand(dest);
    const scratch = ctx.registers
      .deadDataRegistersAfter(index)
      .find((r) => !addressRegisters.has(r));
    if (!scratch) return;
    const destText = sourceOperand(ctx, line, 1);
    if (!destText) return;

    const replacement = `moveq #${valueText(ctx, source.value, value.value)},${scratch}\nmove.l ${scratch},${destText}`;
    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence: "certain",
      message: `${scratch.toUpperCase()} is dead after this store and can be used to materialize the immediate with MOVEQ`,
      loc: line.mnemonic!.loc,
      suggestion: {
        description: `Use MOVEQ via ${scratch.toUpperCase()}`,
        replacement,
        applicability: "safe",
      },
      notes: [
        {
          message:
            "The scratch register is proven dead after the original instruction and is not used to form the destination address.",
        },
      ],
    });
  },
};
