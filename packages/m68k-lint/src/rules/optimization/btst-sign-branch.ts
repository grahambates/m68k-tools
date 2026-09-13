import type { OperandNode } from "m68k-parser";
import type { Rule } from "../../core/rule.js";
import {
  dataRegisterOperand,
  immediateOperand,
  instructionSize,
  isInstruction,
  operand,
} from "../../util/ast.js";
import { changedFlagsApplicability, sourceOperand } from "./helpers.js";
import { canonicalMnemonic } from "../../semantics/mnemonics.js";

const branchMap: Record<string, string> = { beq: "bpl", bne: "bmi" };

function hasInterveningLabel(
  ctx: Parameters<NonNullable<Rule["checkLine"]>>[0],
  from: number,
  to: number,
): boolean {
  for (let i = from + 1; i <= to; i++) if (ctx.line(i)?.label) return true;
  return false;
}

function isMemoryBtstOperand(op: OperandNode | undefined): boolean {
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

export const btstSignBranch: Rule = {
  meta: {
    id: "optimization/btst-sign-branch",
    category: "optimization",
    defaultSeverity: "suggestion",
    description: "Use TST plus sign branch for a sign-bit BTST sequence",
    tags: ["asp68k", "peephole", "ccr", "branch"],
    docs: { source: "ASP68K" },
  },
  checkLine(ctx, line, index) {
    if (!isInstruction(line, "btst")) return;
    const bitOp = immediateOperand(line, 0);
    const rawDest = operand(line, 1);
    if (!bitOp || bitOp.value.type === "string-literal" || !rawDest) return;
    const bit = ctx.evaluate(bitOp.value);
    if (!bit.known) return;

    const dataDest = dataRegisterOperand(line, 1);
    const memoryDest = isMemoryBtstOperand(rawDest);
    const size = dataDest
      ? bit.value === 7
        ? "b"
        : bit.value === 15
          ? "w"
          : bit.value === 31
            ? "l"
            : undefined
      : memoryDest && bit.value === 7
        ? "b"
        : undefined;
    if (!size) return;

    const next = ctx.nextInstruction(index);
    if (!next || hasInterveningLabel(ctx, index, next.index)) return;
    const branchName = canonicalMnemonic(next.line) ?? "";
    const replacementBranch = branchMap[branchName];
    if (!replacementBranch) return;
    const target = sourceOperand(ctx, next.line, 0);
    const destText = sourceOperand(ctx, line, 1);
    if (!target || !destText) return;

    const branchSize = instructionSize(next.line);
    const suffix = branchSize ? `.${branchSize}` : "";
    const safety = changedFlagsApplicability(ctx, next.index, [
      "N",
      "Z",
      "V",
      "C",
    ]);

    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence: safety.confidence,
      message: `BTST #${bit.value},${destText} followed by ${branchName.toUpperCase()} can use TST.${size} plus ${replacementBranch.toUpperCase()}`,
      loc: line.mnemonic!.loc,
      suggestion: {
        description: `Use TST.${size} ${destText} followed by ${replacementBranch.toUpperCase()}${suffix}`,
        replacement: `tst.${size} ${destText}\n${replacementBranch}${suffix} ${target}`,
        applicability: safety.applicability,
      },
      notes: [
        ...(safety.applicability === "safe"
          ? []
          : [
              {
                message:
                  "The replacement leaves different N/Z/V/C values after the branch; review any later CCR use on either path.",
              },
            ]),
      ],
      // The replacement changes BEQ/BNE only to the equivalent BPL/BMI, so
      // the branch-not-taken path is directly comparable on both sides.
      data: { secondInstructionIndex: next.index, branchTiming: "not-taken" },
    });
  },
};
