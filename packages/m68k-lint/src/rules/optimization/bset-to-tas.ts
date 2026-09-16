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

function isAlterableMemory(op: OperandNode | undefined): boolean {
  return (
    !!op &&
    [
      "address-register-indirect",
      "address-register-indirect-postinc",
      "address-register-indirect-predec",
      "address-register-indirect-displacement",
      "address-register-indirect-index",
      "absolute-address",
    ].includes(op.type)
  );
}

export const bsetToTas: Rule = {
  meta: {
    obfuscated: true,
    id: "optimization/bset-to-tas",
    category: "optimization",
    defaultSeverity: "suggestion",
    enabledByDefault: false,
    description: "Use TAS for BSET bit 7 patterns",
    tags: ["asp68k", "peephole", "ccr", "tas", "disabled-by-default"],
    docs: {
      source: "ASP68K",
      example: {
        source: "\tbset.l #7,d0\n\tadd.l d1,d2",
        config: { rules: { "optimization/bset-to-tas": "suggestion" } },
      },
    },
  },
  checkLine(ctx, line, index) {
    // Never suggest TAS in Amiga mode: the Amiga architecture does not support it.
    if (ctx.config.platform === "amiga") return;
    if (!isInstruction(line, "bset")) return;
    const bitOp = immediateOperand(line, 0);
    const dest = operand(line, 1);
    if (!bitOp || bitOp.value.type === "string-literal" || !dest) return;
    const bit = ctx.evaluate(bitOp.value);
    if (!bit.known || bit.value !== 7) return;

    const dataDest = dataRegisterOperand(line, 1);
    const memoryDest = isAlterableMemory(dest);
    const size = instructionSize(line);
    if (dataDest ? size !== "l" : !memoryDest || size !== "b") return;

    // Verified with 68kcounter: the data-register form is cycle-equal-or-
    // faster on every target checked, including 68020.
    const allowed = dataDest
      ? ["mc68000", "mc68010", "mc68020", "mc68030"]
      : ["mc68000", "mc68010"];
    if (!ctx.config.processors.every((cpu) => allowed.includes(cpu))) return;

    const destText = sourceOperand(ctx, line, 1);
    if (!destText) return;

    const next = ctx.nextInstruction(index);
    const branchName = next ? (canonicalMnemonic(next.line) ?? "") : "";
    const replacementBranch = branchMap[branchName];

    if (
      next &&
      replacementBranch &&
      !hasInterveningLabel(ctx, index, next.index)
    ) {
      const target = sourceOperand(ctx, next.line, 0);
      if (!target) return;
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
        message: `BSET bit 7 followed by ${branchName.toUpperCase()} can use TAS plus ${replacementBranch.toUpperCase()}`,
        loc: line.mnemonic!.loc,
        suggestion: {
          description: `Use TAS ${destText} followed by ${replacementBranch.toUpperCase()}${suffix}`,
          replacement: `tas ${destText}\n${replacementBranch}${suffix} ${target}`,
          applicability: safety.applicability,
        },
        notes: [
          {
            message:
              "TAS sets bit 7 and tests the byte in one instruction, but the branch condition changes with it.",
          },
          ...(safety.applicability === "safe"
            ? []
            : [
                {
                  message:
                    "The replacement leaves different CCR values after the branch; review later flag use.",
                },
              ]),
        ],
        data: { secondInstructionIndex: next.index },
      });
      return;
    }

    const safety = changedFlagsApplicability(ctx, index, ["N", "Z", "V", "C"]);
    // Without the paired branch, BSET and TAS expose genuinely different CCR
    // values. Only call the standalone transform an optimisation when those
    // flags are proven dead.
    if (safety.applicability !== "safe") return;
    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence: safety.confidence,
      message: `BSET.${size} #7,${destText} can use TAS`,
      loc: line.mnemonic!.loc,
      suggestion: {
        description: `Use TAS ${destText}`,
        replacement: `tas ${destText}`,
        applicability: safety.applicability,
      },
      notes: [
        {
          message:
            "The quick form encodes its operand in the instruction word, with no extension word.",
        },
        ...(safety.applicability === "safe"
          ? []
          : [
              {
                message:
                  "BSET and TAS set condition codes differently; review any later CCR use.",
              },
            ]),
      ],
    });
  },
};
