import type { Rule } from "../../core/rule.js";
import {
  addressRegisterOperand,
  immediateOperand,
  instructionSize,
  isInstruction,
} from "../../util/ast.js";
import { sourceOperand, valueText } from "./helpers.js";

function stripImmediate(text: string): string {
  return text.trim().replace(/^#\s*/, "");
}

export const moveImmediateAddressToLea: Rule = {
  meta: {
    id: "optimization/movea-immediate-to-lea",
    category: "optimization",
    defaultSeverity: "suggestion",
    description: "Use LEA for a non-zero immediate address-register load",
    tags: [
      "asp68k",
      "address-register",
      "addressing",
      "assembler-relaxation",
      "clarity",
    ],
    docs: {
      source: "ASP68K",
      note: "ASP68K claims a 68000/68010 speed win, which exact auditing does not bear out: the two forms measure identically. The real gain is clarity, and that LEA lets the assembler relax the operand to PC-relative, which a long immediate MOVEA can never be.",
    },
  },
  checkLine(ctx, line) {
    if (!isInstruction(line, "movea")) return;
    const size = instructionSize(line);
    if (size !== "w" && size !== "l") return;
    const imm = immediateOperand(line, 0);
    const dest = addressRegisterOperand(line, 1);
    if (!imm || !dest || imm.value.type === "string-literal") return;
    // Anything loaded into an address register is an address, whether it folds
    // to a constant or stays a link-time symbol. Zero has its own rules.
    const value = ctx.evaluate(imm.value);
    if (value.known && value.value === 0) return;
    const text = sourceOperand(ctx, line, 0);
    if (!text) return;

    // MOVEA.W sign-extends its 16-bit source, so the absolute-short form has to
    // be pinned: without the suffix the assembler could pick absolute long and
    // turn #$8000 into $00008000 rather than $FFFF8000. MOVEA.L has no such
    // constraint, so it is left bare for the assembler to relax.
    const replacement =
      size === "w"
        ? `lea ${stripImmediate(text)}.w,${dest.register}`
        : `lea ${stripImmediate(text)},${dest.register}`;
    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence: "certain",
      message: `This MOVEA.${size} immediate is an address load and is clearer as LEA`,
      loc: line.mnemonic!.loc,
      suggestion: {
        description: "Use LEA",
        replacement,
        applicability: "safe",
      },
      notes: [
        {
          message:
            size === "l"
              ? "The suggestion carries no size suffix on purpose: LEA lets the assembler relax the operand to PC-relative where the target is in range, which is 2 bytes shorter and faster. A long immediate MOVEA can never be relaxed."
              : "The .W suffix is kept because MOVEA.W sign-extends its source, and absolute short is the form that matches.",
        },
      ],
    });
  },
};

export const moveAddressThenAddToLea: Rule = {
  meta: {
    id: "optimization/movea-add-to-lea",
    category: "optimization",
    defaultSeverity: "suggestion",
    description: "Combine MOVEA plus immediate ADDA/ADDQ into one LEA",
    tags: ["asp68k", "address-register", "sequence"],
    docs: { source: "ASP68K" },
  },
  checkLine(ctx, line, index) {
    // Restrict the copy to .L. MOVEA.W sign-extends the low source word, while
    // LEA uses the complete base register and is therefore not generally equivalent.
    if (!isInstruction(line, "movea") || instructionSize(line) !== "l") return;
    const source = addressRegisterOperand(line, 0);
    const dest = addressRegisterOperand(line, 1);
    if (!source || !dest) return;

    const next = ctx.nextInstruction(index);
    if (
      !next ||
      next.line.label ||
      (!isInstruction(next.line, "adda") && !isInstruction(next.line, "addq"))
    )
      return;
    const addSize = instructionSize(next.line);
    if (addSize !== "w" && addSize !== "l") return;
    const imm = immediateOperand(next.line, 0);
    const addDest = addressRegisterOperand(next.line, 1);
    if (
      !imm ||
      !addDest ||
      addDest.register.toLowerCase() !== dest.register.toLowerCase() ||
      imm.value.type === "string-literal"
    )
      return;
    const value = ctx.evaluate(imm.value);
    if (!value.known || value.value < -32768 || value.value > 32767) return;

    const replacement = `lea ${valueText(ctx, imm.value, value.value)}(${source.register}),${dest.register}`;
    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence: "certain",
      message:
        "MOVEA plus an immediate address adjustment can be folded into one LEA",
      loc: line.mnemonic!.loc,
      suggestion: {
        description: "Fold the address copy and adjustment into LEA",
        replacement,
        applicability: "safe",
      },
      data: { secondInstructionIndex: next.index },
    });
  },
};
