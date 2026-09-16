import type { Rule } from "../../core/rule.js";
import {
  addressRegisterOperand,
  predecrementAddressRegister,
  immediateExpressionOperand,
  instructionSize,
  isInstruction,
} from "../../util/ast.js";
import {
  normalizeRegister,
  registersReadByOperand,
} from "../../semantics/registers.js";
import { hasLabelBetween } from "./helpers.js";

export const cancelAddqPredecrementMove: Rule = {
  meta: {
    // The direct store removes the explicit address adjustment expression.
    obfuscated: true,
    id: "optimization/cancel-addq-predecrement-move",
    category: "optimization",
    defaultSeverity: "suggestion",
    description:
      "Cancel ADDQ address adjustment against an immediately following predecrement MOVE",
    tags: ["asp68k", "sequence", "address-register"],
    docs: { source: "ASP68K" },
  },
  checkLine(ctx, line, index) {
    if (!isInstruction(line, "addq")) return;
    const size = instructionSize(line);
    if (size !== "w" && size !== "l") return;
    const imm = immediateExpressionOperand(line, 0);
    const ar = addressRegisterOperand(line, 1);
    if (!imm || !ar) return;
    const q = ctx.evaluate(imm);
    if (!q.known) return;

    const next = ctx.nextInstruction(index);
    if (
      !next ||
      hasLabelBetween(ctx, index, next.index) ||
      !isInstruction(next.line, "move")
    )
      return;
    const moveSize = instructionSize(next.line);
    if (moveSize !== "w" && moveSize !== "l") return;
    const width = moveSize === "w" ? 2 : 4;
    if (q.value !== width) return;
    const dstRegister = predecrementAddressRegister(next.line, 1);
    if (!dstRegister) return;
    const addr = normalizeRegister(ar.register);
    const dstAddr = normalizeRegister(dstRegister.register);
    if (!addr || addr !== dstAddr) return;

    // The replacement evaluates the source before the original ADDQ would have run,
    // so reject any source effective address which itself reads the adjusted register.
    if (registersReadByOperand(next.line.operands?.[0]).has(addr)) return;

    const sourceText = ctx.sourceLine(next.index)?.trim();
    const src = next.line.operands?.[0];
    if (!src) return;
    // Preserve spelling by extracting everything before the final comma where practical.
    let srcText: string | undefined;
    if (sourceText) {
      const body = sourceText.replace(/;.*$/, "");
      const comma = body.lastIndexOf(",");
      const mnemonicEnd = body.search(/\s/);
      if (comma > mnemonicEnd && mnemonicEnd >= 0)
        srcText = body.slice(mnemonicEnd, comma).trim();
    }
    if (!srcText) return;

    const replacement = `move.${moveSize} ${srcText},(${ar.register})`;
    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence: "certain",
      message: `ADDQ #${width},${ar.register.toUpperCase()} cancels the following MOVE.${moveSize.toUpperCase()} predecrement`,
      loc: line.mnemonic!.loc,
      suggestion: {
        description: "Remove the cancelling address update/predecrement pair",
        replacement,
        applicability: "safe",
      },
      notes: [
        {
          message:
            "The MOVE source does not read the adjusted address register, so its effective address is unchanged.",
        },
      ],
      data: { sourceEndIndex: next.index },
    });
  },
};
