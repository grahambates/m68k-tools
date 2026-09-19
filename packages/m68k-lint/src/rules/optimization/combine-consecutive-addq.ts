import type { ParsedLine } from "m68k-parser";
import type { Rule } from "../../core/rule.js";
import {
  immediateOperand,
  instructionSize,
  isInstruction,
  operand,
} from "../../util/ast.js";
import {
  changedFlagsApplicability,
  containsSymbol,
  embeddedValueText,
  hasLabelBetween,
  sourceOperand,
} from "./helpers.js";

function directRegisterName(line: ParsedLine): string | undefined {
  const op = operand(line, 1);
  return op?.type === "data-register" || op?.type === "address-register"
    ? op.register.toLowerCase()
    : undefined;
}

export const combineConsecutiveAddq: Rule = {
  meta: {
    // The total can hide the separate increments and their intent.
    obfuscated: true,
    id: "optimization/combine-consecutive-addq",
    category: "optimization",
    defaultSeverity: "suggestion",
    description: "Combine consecutive ADDQ.L operations on the same register",
    tags: ["asp68k", "sequence", "addq", "ccr"],
    docs: {
      source: "ASP68K",
      example: { source: "\taddq.l #3,d0\n\taddq.l #5,d0\n\tadd.l d1,d2" },
    },
  },
  checkLine(ctx, line, index) {
    if (!isInstruction(line, "addq") || instructionSize(line) !== "l") return;
    const firstReg = directRegisterName(line);
    const firstImm = immediateOperand(line, 0);
    if (!firstReg || !firstImm) return;
    const n = ctx.evaluate(firstImm.value);
    if (!n.known || n.value < 1 || n.value > 8) return;

    const next = ctx.nextInstruction(index);
    if (!next || hasLabelBetween(ctx, index, next.index)) return;
    if (!isInstruction(next.line, "addq") || instructionSize(next.line) !== "l")
      return;
    if (directRegisterName(next.line) !== firstReg) return;
    const secondImm = immediateOperand(next.line, 0);
    if (!secondImm) return;
    const m = ctx.evaluate(secondImm.value);
    if (!m.known || m.value < 1 || m.value > 8) return;

    const destText = sourceOperand(ctx, line, 1);
    if (!destText) return;
    const total = n.value + m.value;
    // Two ADDQs collapsing into one ADDQ (sum <= 8) is a strict size and
    // instruction-count win on every 68k model, so that branch carries no CPU
    // gate. The ASP68K table's claim for the full-immediate fallback (sum > 8)
    // is 68000/68010/68030-specific, and exact 68000 auditing with 68kcounter
    // shows no CPU-cycle gain and a 2-byte / 1-read-cycle regression there, so
    // that branch is offered only for 68010/68030 targets -- kept
    // source-backed until there are exact counters for those too.
    if (
      total > 8 &&
      !ctx.config.processors.every(
        (cpu) => cpu === "mc68010" || cpu === "mc68030",
      )
    )
      return;

    const isAddress = operand(line, 1)?.type === "address-register";
    const safety = isAddress
      ? { applicability: "safe" as const, confidence: "certain" as const }
      : changedFlagsApplicability(ctx, next.index, ["X", "V", "C"]);
    // Written as the sum of what the source wrote when either side is a name,
    // so the constant it came from is still visible and still tracked. Two
    // literals are left as their total, since `#3+2` keeps nothing and reads
    // worse than `#5`.
    const symbolic =
      containsSymbol(firstImm.value) || containsSymbol(secondImm.value);
    const totalText = symbolic
      ? `${embeddedValueText(ctx, firstImm.value, n.value)}+${embeddedValueText(ctx, secondImm.value, m.value)}`
      : String(total);
    const replacement =
      total <= 8
        ? `addq.l #${totalText},${destText}`
        : `add.l #${totalText},${destText}`;

    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence: safety.confidence,
      message: `Two ADDQ.L operations on ${firstReg.toUpperCase()} can be combined into one immediate add`,
      loc: line.mnemonic!.loc,
      suggestion: {
        description: `Replace both instructions with ${replacement.toUpperCase()}`,
        replacement,
        applicability: safety.applicability,
      },
      notes: [
        {
          message:
            total <= 8
              ? "The combined value still fits ADDQ, so one ADDQ is preferable to a full immediate ADD."
              : "On 68000 this form was measured as no faster and 2 bytes larger, so it is suppressed there; it remains available for 68010 and 68030.",
        },
        ...(isAddress || safety.applicability === "safe"
          ? []
          : [
              {
                message:
                  "For data registers, the final N/Z result is the same but X/V/C can differ from the second ADDQ; review flag use.",
              },
            ]),
      ],
      data: { sourceEndIndex: next.index },
    });
  },
};
