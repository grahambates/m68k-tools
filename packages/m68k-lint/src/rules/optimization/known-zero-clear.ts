import type { OperandNode } from "m68k-parser";
import type { Rule } from "../../core/rule.js";
import { DATA_REGISTERS } from "../../semantics/registers.js";
import { instructionSize, isInstruction, operand } from "../../util/ast.js";
import { sourceOperand } from "./helpers.js";
import { targetsOnly } from "../../core/config.js";

/**
 * Every memory-destination CLR form measures slower than the equivalent MOVE
 * from a known-zero register on 68000 -- not just predecrement and indexed,
 * which is all ASP68K's own table documents. Verified directly with
 * 68kcounter: e.g. `clr.w (a0)` is 12 cycles against `move.w d7,(a0)` at 8,
 * and `clr.w $1000`/`clr.w 4(a0)` show the same 4-cycle gap, all at identical
 * byte counts either way.
 */
function supportedDestination(op: OperandNode | undefined): boolean {
  return (
    op?.type === "address-register-indirect" ||
    op?.type === "address-register-indirect-displacement" ||
    op?.type === "address-register-indirect-predec" ||
    op?.type === "address-register-indirect-postinc" ||
    op?.type === "address-register-indirect-index" ||
    op?.type === "absolute-address"
  );
}

export const knownZeroClear: Rule = {
  meta: {
    id: "optimization/known-zero-clear",
    category: "optimization",
    defaultSeverity: "suggestion",
    description:
      "Use a known-zero data register instead of CLR for selected memory forms",
    tags: ["asp68k", "register-analysis", "known-zero", "memory"],
    docs: {
      source: "ASP68K",
      example: { source: "\tmoveq #0,d0\n\tclr.w (a0)" },
    },
  },
  checkLine(ctx, line, index) {
    if (!isInstruction(line, "clr")) return;
    const size = instructionSize(line);
    if (!size) return;
    const dest = operand(line, 0);
    if (!supportedDestination(dest)) return;
    // Verified with 68kcounter: a clean win on every target checked except
    // 68040/68060, where it ties (0 delta) rather than improves.
    if (!targetsOnly(ctx.config, ["mc68000", "mc68010", "mc68020", "mc68030"]))
      return;

    const zero = DATA_REGISTERS.find(
      (r) => ctx.registers.knownConstantBefore(index, r) === 0,
    );
    if (!zero) return;
    const destText = sourceOperand(ctx, line, 0);
    if (!destText) return;

    const replacement = `move.${size} ${zero},${destText}`;
    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence: "certain",
      message: `${zero.toUpperCase()} is known to be zero here and can supply this clear`,
      loc: line.mnemonic!.loc,
      suggestion: {
        description: `Consider ${replacement.toUpperCase()}`,
        replacement,
        applicability: "conditional",
      },
      notes: [
        {
          message:
            "The resulting register value and N/Z/V/C are equivalent because the source register is proven zero.",
        },
        {
          message:
            "Review memory-mapped I/O: CLR and MOVE can have different bus-cycle behaviour on some 68k systems.",
        },
      ],
    });
  },
};
