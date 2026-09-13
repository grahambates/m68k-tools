import type { Rule } from "../../core/rule.js";
import { semanticMnemonic } from "../../semantics/mnemonics.js";
import { addressRegisterOperand, instructionSize } from "../../util/ast.js";

export const moveaWordSignExtension: Rule = {
  meta: {
    id: "suspicious/movea-word-sign-extension",
    category: "suspicious",
    defaultSeverity: "warning",
    description:
      "Flag a word load into an address register whose sign-extended upper half is then used",
    tags: ["address-registers", "sign-extension", "partial-width"],
    docs: {
      source: "Motorola 68000 Family Programmer's Reference Manual",
      note: "MOVEA.W sign-extends its 16-bit source and loads all 32 bits of the address register. Only reported where those upper bits are read again, since holding a 16-bit value in a spare address register and reading it back as a word is unaffected by the extension.",
    },
  },

  checkLine(ctx, line, index) {
    if (semanticMnemonic(line) !== "movea" || instructionSize(line) !== "w")
      return;
    const destination = addressRegisterOperand(line, 1);
    if (!destination) return;

    // The extension only writes the upper half, so it matters only where that
    // half is read. Using the register as a base address reads all 32 bits;
    // reading it back with MOVE.W reads none of them. Holding a 16-bit value in
    // a spare address register is ordinary when data registers run short, and
    // reporting every MOVEA.W buried the case that is actually wrong.
    if (
      ctx.registers.registerBitsUseAfter(
        index,
        destination.register,
        0xffff0000,
      ) !== "used"
    )
      return;

    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence: "high",
      message: `MOVEA.W sign-extends the source into ${destination.register.toUpperCase()}, and those upper bits are used`,
      loc: line.mnemonic!.loc,
      suggestion: {
        description:
          "Review whether a sign-extended 16-bit address is intended; use .L for a full 32-bit value",
        applicability: "manual",
      },
      notes: [
        {
          message:
            "This is not a 16-bit partial write: values $8000..$FFFF become $FFFF8000..$FFFFFFFF.",
        },
        {
          message: `${destination.register.toUpperCase()} is later used as an address or read as a long, so the extended half is observed.`,
        },
      ],
    });
  },
};
