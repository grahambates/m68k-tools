import type { Rule } from "../../core/rule.js";
import {
  immediateOperand,
  instructionSize,
  isInstruction,
  operand,
} from "../../util/ast.js";
import { sourceOperand } from "./helpers.js";

/** Destinations CLR can reach: memory only. A data register is prefer-moveq-zero's business. */
const CLEARABLE = [
  "address-register-indirect",
  "address-register-indirect-displacement",
  "address-register-indirect-index",
  "address-register-indirect-postinc",
  "address-register-indirect-predec",
  "absolute-address",
];

/**
 * Storing a zero immediate is CLR with the immediate word deleted: two bytes
 * for a word store, four for a long one, at identical cycle and bus-cycle
 * counts on 68000 (measured with 68kcounter). N/Z/V/C come out the same, since
 * both forms leave Z set and the rest clear.
 *
 * The catch is that a 68000 CLR is a read-modify-write: it reads the location
 * before writing it. For a write-only register the read returns bus noise, so
 * the location briefly holds a wrong value between the two bus cycles. That is
 * harmless wherever nothing samples the location in between -- a blitter
 * modulo is not consulted until the blit is triggered -- and it is why this is
 * offered as a review rather than applied blind.
 */
export const zeroStoreToClear: Rule = {
  meta: {
    // CLR removes the explicit zero value or expression being stored.
    obfuscated: true,
    id: "optimization/zero-store-to-clear",
    category: "optimization",
    defaultSeverity: "suggestion",
    description: "Store a zero with CLR instead of a zero immediate",
    // No `serves`: this costs nothing to trade off. It saves bytes at an
    // identical cycle and bus-cycle count, so it is live under every goal.
    tags: ["peephole", "memory", "native"],
    docs: {
      note: "Found by mining a corpus of real Amiga assembly, where storing #0 to a hardware register is the single most common shape a rule did not cover.",
      example: { source: "\tmove.w #0,(a0)" },
    },
  },

  checkLine(ctx, line) {
    if (!isInstruction(line, "move")) return;
    const size = instructionSize(line);
    if (size !== "b" && size !== "w" && size !== "l") return;

    const immediate = immediateOperand(line, 0);
    if (!immediate || immediate.value.type === "string-literal") return;
    const value = ctx.evaluate(immediate.value);
    if (!value.known || value.value !== 0) return;
    // A zero that arrived as a named constant still folds. CLR has no operand
    // to carry the name, but `symbolsLostBy` in the report path already notes
    // which names the replacement drops, so the caveat reaches the reader
    // rather than the suggestion being withheld.

    const destination = operand(line, 1);
    if (!destination || !CLEARABLE.includes(destination.type)) return;

    const destinationText = sourceOperand(ctx, line, 1);
    if (!destinationText) return;

    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence: "certain",
      message: `Storing zero to ${destinationText} can use CLR.${size.toUpperCase()}, dropping the immediate`,
      loc: line.mnemonic!.loc,
      suggestion: {
        description: `Use CLR.${size.toUpperCase()} ${destinationText}`,
        replacement: `clr.${size} ${destinationText}`,
        applicability: "conditional",
      },
      notes: [
        {
          message: `Saves ${size === "l" ? "four" : "two"} bytes at the same cycle count; the condition codes are identical.`,
        },
        {
          message:
            "A 68000 CLR reads the location before writing it. Where the destination is a write-only register the read returns bus noise, so it briefly holds a wrong value between the two bus cycles -- harmless unless something samples it in between.",
        },
      ],
      data: { size },
    });
  },
};
