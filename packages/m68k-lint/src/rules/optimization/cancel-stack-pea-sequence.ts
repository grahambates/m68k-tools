import type { OperandNode, ParsedLine } from "m68k-parser";
import type { Rule } from "../../core/rule.js";
import {
  addressRegisterOperand,
  immediateOperand,
  instructionSize,
  isInstruction,
  operand,
} from "../../util/ast.js";
import { registersReadByOperand } from "../../semantics/registers.js";
import {
  changedFlagsApplicability,
  hasLabelBetween,
  sourceOperand,
} from "./helpers.js";

function isSpRegisterName(name: string): boolean {
  return ["sp", "a7"].includes(name.toLowerCase());
}

function isSpAddressRegister(line: ParsedLine, index: number): boolean {
  const op = addressRegisterOperand(line, index);
  return !!op && isSpRegisterName(op.register);
}

function predecSp(line: ParsedLine, index: number): boolean {
  const op = operand(line, index);
  return (
    op?.type === "address-register-indirect-predec" &&
    op.register.type === "address-register" &&
    isSpRegisterName(op.register.register)
  );
}

function peaAddressRegister(line: ParsedLine): string | undefined {
  if (!isInstruction(line, "pea")) return undefined;
  const op = operand(line, 0);
  if (op?.type !== "address-register-indirect") return undefined;
  if (op.register.type !== "address-register") return undefined;
  if (isSpRegisterName(op.register.register)) return undefined;
  return op.register.register;
}

function movePredecSp(
  line: ParsedLine,
): { size: "w" | "l"; source: OperandNode } | undefined {
  if (!isInstruction(line, "move")) return undefined;
  const size = instructionSize(line);
  if (size !== "w" && size !== "l") return undefined;
  if (!predecSp(line, 1)) return undefined;
  const source = operand(line, 0);
  if (!source) return undefined;
  // The original source EA is evaluated with SP after the ADDQ (and possibly
  // after a preceding PEA). The folded form does not change SP, so source EAs
  // depending on SP are not equivalent.
  if (registersReadByOperand(source).has("a7")) return undefined;
  return { size, source };
}

function quickAmount(
  ctx: Parameters<NonNullable<Rule["checkLine"]>>[0],
  line: ParsedLine,
): number | undefined {
  if (!isInstruction(line, "addq") || !isSpAddressRegister(line, 1))
    return undefined;
  const size = instructionSize(line);
  if (size !== "w" && size !== "l") return undefined;
  const imm = immediateOperand(line, 0);
  if (!imm) return undefined;
  const value = ctx.evaluate(imm.value);
  return value.known ? value.value : undefined;
}

export const cancelStackPeaSequence: Rule = {
  meta: {
    // Fixed stack offsets obscure the original pushes and stack adjustment.
    obfuscated: true,
    id: "optimization/cancel-stack-pea-sequence",
    category: "optimization",
    defaultSeverity: "suggestion",
    description:
      "Cancel stack ADDQ/PEA/predecrement sequences into fixed-offset stores",
    tags: ["asp68k", "stack", "pea", "sequence"],
    docs: {
      source: "ASP68K",
      example: { source: "\taddq.l #4,sp\n\tpea (a0)" },
    },
  },

  checkLine(ctx, line, index) {
    const amount = quickAmount(ctx, line);
    if (amount !== 4 && amount !== 6 && amount !== 8) return;

    const first = ctx.nextInstruction(index);
    if (!first || hasLabelBetween(ctx, index, first.index)) return;

    // ADDQ #4,SP ; PEA (An) -> MOVE.L An,(SP)
    if (amount === 4) {
      const ar = peaAddressRegister(first.line);
      if (!ar) return;
      const ccr = changedFlagsApplicability(ctx, first.index, [
        "N",
        "Z",
        "V",
        "C",
      ]);
      ctx.report({
        ruleId: this.meta.id,
        category: this.meta.category,
        severity: this.meta.defaultSeverity,
        confidence: ccr.confidence,
        message:
          "ADDQ #4,SP followed by PEA can be replaced by a direct longword store",
        loc: line.mnemonic!.loc,
        suggestion: {
          description: `Replace the pair with MOVE.L ${ar},(SP)`,
          replacement: `move.l ${ar},(sp)`,
          applicability: ccr.applicability,
        },
        notes: [
          ...(ccr.applicability === "safe"
            ? []
            : [
                {
                  message:
                    "PEA preserves CCR, whereas the replacement MOVE.L writes N/Z/V/C.",
                },
              ]),
        ],
        data: { secondInstructionIndex: first.index },
      });
      return;
    }

    const second = ctx.nextInstruction(first.index);
    if (!second || hasLabelBetween(ctx, first.index, second.index)) return;

    const firstMove = movePredecSp(first.line);
    const secondMove = movePredecSp(second.line);
    const firstPea = peaAddressRegister(first.line);
    const secondPea = peaAddressRegister(second.line);

    // ADDQ #6,SP ; MOVE.W src,-(SP) ; PEA (An)
    if (amount === 6 && firstMove?.size === "w" && secondPea) {
      const src = sourceOperand(ctx, first.line, 0);
      if (!src) return;
      const ccr = changedFlagsApplicability(ctx, second.index, [
        "N",
        "Z",
        "V",
        "C",
      ]);
      ctx.report({
        ruleId: this.meta.id,
        category: this.meta.category,
        severity: this.meta.defaultSeverity,
        confidence: ccr.confidence,
        message:
          "The stack adjustment is cancelled by a word predecrement and PEA",
        loc: line.mnemonic!.loc,
        suggestion: {
          description:
            "Use fixed SP displacements instead of cancelling stack updates",
          replacement: `move.w ${src},4(sp)\nmove.l ${secondPea},(sp)`,
          applicability: ccr.applicability,
        },
        notes: [
          {
            message:
              "The source operand is independent of SP, so its effective address is unchanged.",
          },
          ...(ccr.applicability === "safe"
            ? []
            : [
                {
                  message:
                    "The final replacement MOVE.L writes N/Z/V/C whereas the original final PEA preserves the preceding MOVE.W flags.",
                },
              ]),
        ],
        data: {
          secondInstructionIndex: first.index,
          thirdInstructionIndex: second.index,
        },
      });
      return;
    }

    // ADDQ #6,SP ; PEA (An) ; MOVE.W src,-(SP)
    if (amount === 6 && firstPea && secondMove?.size === "w") {
      const src = sourceOperand(ctx, second.line, 0);
      if (!src) return;
      ctx.report({
        ruleId: this.meta.id,
        category: this.meta.category,
        severity: this.meta.defaultSeverity,
        confidence: "certain",
        message:
          "The stack adjustment is cancelled by PEA and a word predecrement",
        loc: line.mnemonic!.loc,
        suggestion: {
          description:
            "Use fixed SP displacements instead of cancelling stack updates",
          replacement: `move.l ${firstPea},2(sp)\nmove.w ${src},(sp)`,
          applicability: "safe",
        },
        notes: [
          {
            message:
              "The final MOVE.W sets the same condition codes as the original final MOVE.W, and the source is independent of SP.",
          },
        ],
        data: {
          secondInstructionIndex: first.index,
          thirdInstructionIndex: second.index,
        },
      });
      return;
    }

    // ADDQ #8,SP ; MOVE.L src,-(SP) ; PEA (An)
    if (amount === 8 && firstMove?.size === "l" && secondPea) {
      const src = sourceOperand(ctx, first.line, 0);
      if (!src) return;
      const ccr = changedFlagsApplicability(ctx, second.index, [
        "N",
        "Z",
        "V",
        "C",
      ]);
      ctx.report({
        ruleId: this.meta.id,
        category: this.meta.category,
        severity: this.meta.defaultSeverity,
        confidence: ccr.confidence,
        message:
          "The stack adjustment is cancelled by a longword predecrement and PEA",
        loc: line.mnemonic!.loc,
        suggestion: {
          description:
            "Use fixed SP displacements instead of cancelling stack updates",
          replacement: `move.l ${src},4(sp)\nmove.l ${secondPea},(sp)`,
          applicability: ccr.applicability,
        },
        notes: [
          {
            message:
              "The source operand is independent of SP, so its effective address is unchanged.",
          },
          ...(ccr.applicability === "safe"
            ? []
            : [
                {
                  message:
                    "The final replacement MOVE.L writes N/Z/V/C whereas the original final PEA preserves the preceding MOVE.L flags.",
                },
              ]),
        ],
        data: {
          secondInstructionIndex: first.index,
          thirdInstructionIndex: second.index,
        },
      });
      return;
    }

    // ADDQ #8,SP ; PEA (An) ; MOVE.L src,-(SP)
    if (amount === 8 && firstPea && secondMove?.size === "l") {
      const src = sourceOperand(ctx, second.line, 0);
      if (!src) return;
      ctx.report({
        ruleId: this.meta.id,
        category: this.meta.category,
        severity: this.meta.defaultSeverity,
        confidence: "certain",
        message:
          "The stack adjustment is cancelled by PEA and a longword predecrement",
        loc: line.mnemonic!.loc,
        suggestion: {
          description:
            "Use fixed SP displacements instead of cancelling stack updates",
          replacement: `move.l ${firstPea},4(sp)\nmove.l ${src},(sp)`,
          applicability: "safe",
        },
        notes: [
          {
            message:
              "The final MOVE.L sets the same condition codes as the original final MOVE.L, and the source is independent of SP.",
          },
        ],
        data: {
          secondInstructionIndex: first.index,
          thirdInstructionIndex: second.index,
        },
      });
      return;
    }

    // ADDQ #8,SP ; PEA (An) ; PEA (Am)
    if (amount === 8 && firstPea && secondPea) {
      const ccr = changedFlagsApplicability(ctx, second.index, [
        "N",
        "Z",
        "V",
        "C",
      ]);
      ctx.report({
        ruleId: this.meta.id,
        category: this.meta.category,
        severity: this.meta.defaultSeverity,
        confidence: ccr.confidence,
        message:
          "The stack adjustment is cancelled by two following PEA instructions",
        loc: line.mnemonic!.loc,
        suggestion: {
          description: "Use direct longword stores at fixed SP offsets",
          replacement: `move.l ${firstPea},4(sp)\nmove.l ${secondPea},(sp)`,
          applicability: ccr.applicability,
        },
        notes: [
          ...(ccr.applicability === "safe"
            ? []
            : [
                {
                  message:
                    "The original PEA instructions preserve CCR, while the replacement MOVE.L instructions write N/Z/V/C.",
                },
              ]),
        ],
        data: {
          secondInstructionIndex: first.index,
          thirdInstructionIndex: second.index,
        },
      });
    }
  },
};
