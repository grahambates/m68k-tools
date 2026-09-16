import type { Rule } from "../../core/rule.js";
import { isInstruction } from "../../util/ast.js";
import { hasLabelBetween, sourceOperand } from "./helpers.js";

export const jsrJmpDispatch: Rule = {
  meta: {
    // The call is encoded as a manually pushed return address and jump.
    obfuscated: true,
    id: "optimization/jsr-jmp-tail-dispatch",
    category: "optimization",
    defaultSeverity: "suggestion",
    description: "Replace JSR sub / JMP next with PEA next / JMP sub",
    tags: ["tricks-and-traps", "68000", "control-flow"],
    docs: {
      source: "Mike Morton, 68000 Tricks and Traps (BYTE, Sep 1986)",
      example: {
        source: "\tjsr Sub\n\tjmp Cont\nSub:\n\trts\nCont:\n\trts",
      },
    },
  },
  checkLine(ctx, line, index) {
    if (!isInstruction(line, "jsr")) return;
    const next = ctx.nextInstruction(index);
    if (
      !next ||
      !isInstruction(next.line, "jmp") ||
      hasLabelBetween(ctx, index, next.index)
    )
      return;
    const sub = sourceOperand(ctx, line, 0);
    const cont = sourceOperand(ctx, next.line, 0);
    if (!sub || !cont) return;
    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence: "high",
      message:
        "JSR followed by JMP can pre-push the continuation and jump directly to the subroutine",
      loc: line.mnemonic!.loc,
      suggestion: {
        description: `Push ${cont} as the return address, then JMP directly to ${sub}`,
        replacement: `pea ${cont}\njmp ${sub}`,
        applicability: "conditional",
      },
      notes: [
        {
          message:
            "The return-address value visible to the callee changes from the address of the original JMP instruction to the final continuation target; review code that inspects or edits its return address.",
        },
      ],
      data: { secondInstructionIndex: next.index },
    });
  },
};
