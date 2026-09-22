import type { ParsedLine } from "m68k-parser";
import type { Rule } from "../../core/rule.js";
import {
  dataRegisterOperand,
  immediateOperand,
  instructionSize,
  isInstruction,
} from "../../util/ast.js";
import {
  additiveTermText,
  isAuthoredExpression,
  sumText,
  hasLabelBetween,
  sourceOperand,
} from "./helpers.js";

const SHIFT_MNEMONICS = ["lsl", "lsr", "asl", "asr"] as const;
type ShiftMnemonic = (typeof SHIFT_MNEMONICS)[number];

function shiftMnemonic(line: ParsedLine): ShiftMnemonic | undefined {
  return SHIFT_MNEMONICS.find((m) => isInstruction(line, m));
}

/**
 * Splitting a shift into two immediate steps on the same register is
 * associative -- the second step continues shifting bits the first step
 * already moved into place, so the combined result, and every flag, is
 * exactly what a single shift by the total count would produce:
 *
 * - N/Z reflect the final value, which is identical either way.
 * - X/C reflect the last bit shifted out, which for a left shift by N is
 *   always original bit (width-N) regardless of how the N steps were split,
 *   since the second step's "last bit out" is the first step's continuation
 *   through the same bit range.
 * - V (ASL/ASR only) is set if the sign bit changes at any point during the
 *   shift; splitting the shift into two steps still examines that same
 *   contiguous bit range, just across two instructions instead of one.
 *
 * So combining is unconditionally safe when the total still fits in a single
 * immediate shift (<=8). Above that, an immediate shift can no longer encode
 * the count at all, and the alternative -- MOVEQ the total into a scratch
 * register, then use the register-count form -- is a genuine 68000 win
 * (confirmed with 68kcounter: a chain like LSL.W #8,Dn / LSL.W #4,Dn costs 36
 * cycles against 10 for MOVEQ+LSL.W, at the same byte count), but is a wash or
 * a one-cycle regression on 68020's barrel shifter, so that branch is kept
 * 68000-only like its siblings in known-register-shifts.ts.
 */
export const combineConsecutiveShift: Rule = {
  meta: {
    // The total hides the separate counts and can require a scratch sequence.
    obfuscated: true,
    id: "optimization/combine-consecutive-shift",
    category: "optimization",
    defaultSeverity: "suggestion",
    description:
      "Combine consecutive immediate shifts of the same direction on the same register",
    tags: ["sequence", "shift", "ccr"],
    docs: {
      note: "Found by mining a corpus of real Amiga assembly for repeated instruction shapes, then verified with 68kcounter rather than taken from a documented source.",
      example: { source: "\tlsl.w #3,d0\n\tlsl.w #4,d0" },
    },
  },
  checkLine(ctx, line, index) {
    const mnemonic = shiftMnemonic(line);
    if (!mnemonic) return;
    const size = instructionSize(line);
    if (size !== "b" && size !== "w" && size !== "l") return;
    const firstImm = immediateOperand(line, 0);
    const dest = dataRegisterOperand(line, 1);
    if (!firstImm || !dest) return;
    const n = ctx.evaluate(firstImm.value);
    if (!n.known || n.value < 1 || n.value > 8) return;

    const next = ctx.nextInstruction(index);
    if (!next || hasLabelBetween(ctx, index, next.index)) return;
    if (
      shiftMnemonic(next.line) !== mnemonic ||
      instructionSize(next.line) !== size
    )
      return;
    const secondImm = immediateOperand(next.line, 0);
    const nextDest = dataRegisterOperand(next.line, 1);
    if (!secondImm || !nextDest) return;
    if (nextDest.register.toLowerCase() !== dest.register.toLowerCase()) return;
    const m = ctx.evaluate(secondImm.value);
    if (!m.known || m.value < 1 || m.value > 8) return;

    const total = n.value + m.value;
    const destText = sourceOperand(ctx, line, 1);
    if (!destText) return;
    const totalText =
      isAuthoredExpression(firstImm.value) ||
      isAuthoredExpression(secondImm.value)
        ? sumText([
            additiveTermText(ctx, firstImm.value, n.value),
            additiveTermText(ctx, secondImm.value, m.value),
          ])
        : String(total);

    let replacement: string;
    let note: string;
    if (total <= 8) {
      replacement = `${mnemonic}.${size} #${totalText},${destText}`;
      note = "The combined count still fits a single immediate shift.";
    } else {
      if (!ctx.config.processors.every((cpu) => cpu === "mc68000")) return;
      const target = dest.register.toLowerCase();
      const scratch = ctx.registers
        .deadDataRegistersAfter(next.index)
        .find((register) => register.toLowerCase() !== target);
      if (!scratch) return;
      replacement = `moveq #${totalText},${scratch}\n${mnemonic}.${size} ${scratch},${destText}`;
      note = `${scratch.toUpperCase()} is proven dead here; the register-count form is faster on 68000 once an immediate shift can no longer encode the count.`;
    }

    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence: "certain",
      message: `Two ${mnemonic.toUpperCase()}.${size.toUpperCase()} operations on ${dest.register.toUpperCase()} can be combined`,
      loc: line.mnemonic!.loc,
      suggestion: {
        description: `Replace both instructions with the combined shift`,
        replacement,
        applicability: "safe",
      },
      notes: [
        { message: note },
        {
          message:
            "Splitting a shift into two steps on the same register cannot change the result or any flag, so this holds regardless of what runs afterwards.",
        },
      ],
      data: { secondInstructionIndex: next.index },
    });
  },
};
