import type { Rule } from "../../core/rule.js";
import {
  addressRegisterOperand,
  postincrementAddressRegister,
  immediateExpressionOperand,
  instructionSize,
  isInstruction,
} from "../../util/ast.js";
import {
  normalizeRegister,
  registersReadByOperand,
} from "../../semantics/registers.js";
import { hasLabelBetween, sourceOperand } from "./helpers.js";

/**
 * The mirror image of `cancel-addq-predecrement-move`: SUBQ pulls An back by
 * exactly the width of the load that follows, and postincrement immediately
 * pushes it forward again by the same amount, so An ends up unchanged overall.
 * Unlike the ADDQ/predecrement case, the read itself happens at the
 * *decremented* address, not An's original value, so the fold needs an
 * explicit negative displacement rather than collapsing to bare `(An)`.
 *
 *   subq.w #2,a3            move.w -2(a3),d0
 *   move.w (a3)+,d0    ->
 */
export const cancelSubqPostincrementMove: Rule = {
  meta: {
    // The direct transfer removes the explicit address adjustment expression.
    obfuscated: true,
    id: "optimization/cancel-subq-postincrement-move",
    category: "optimization",
    defaultSeverity: "suggestion",
    description:
      "Cancel SUBQ address adjustment against an immediately following postincrement MOVE",
    tags: ["asp68k", "sequence", "address-register"],
    docs: {
      source: "ASP68K",
      example: { source: "\tsubq.w #2,a3\n\tmove.w (a3)+,d0" },
    },
  },
  checkLine(ctx, line, index) {
    if (!isInstruction(line, "subq")) return;
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
    const srcRegister = postincrementAddressRegister(next.line, 0);
    if (!srcRegister) return;
    const addr = normalizeRegister(ar.register);
    const srcAddr = normalizeRegister(srcRegister.register);
    if (!addr || addr !== srcAddr) return;

    // The replacement evaluates the destination after the fold, where An
    // already holds its final (unchanged) value, so reject a destination
    // that itself reads the adjusted register -- its effective address would
    // have seen the intermediate, decremented value in the original order.
    if (registersReadByOperand(next.line.operands?.[1]).has(addr)) return;

    const dstText = sourceOperand(ctx, next.line, 1);
    if (!dstText) return;

    const replacement = `move.${moveSize} -${width}(${ar.register}),${dstText}`;
    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence: "certain",
      message: `SUBQ #${width},${ar.register.toUpperCase()} cancels the following MOVE.${moveSize.toUpperCase()} postincrement`,
      loc: line.mnemonic!.loc,
      suggestion: {
        description: "Remove the cancelling address update/postincrement pair",
        replacement,
        applicability: "safe",
      },
      notes: [
        {
          message:
            "The MOVE destination does not read the adjusted address register, so its effective address is unchanged.",
        },
      ],
      data: { sourceEndIndex: next.index },
    });
  },
};
