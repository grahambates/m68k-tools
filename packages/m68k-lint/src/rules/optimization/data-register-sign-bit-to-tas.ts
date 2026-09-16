import type { Rule } from "../../core/rule.js";
import {
  dataRegisterOperand,
  immediateExpressionOperand,
  instructionSize,
} from "../../util/ast.js";
import { changedFlagsApplicability } from "./helpers.js";
import { semanticMnemonic } from "../../semantics/mnemonics.js";

/**
 * Setting bit 7 of a data register is what TAS does, in one word.
 *
 *   bset #7,dn      ->  tas dn
 *   ori.b #$80,dn   ->  tas dn
 *
 * This is separate from `optimization/bset-to-tas`, which covers the memory
 * form and is off by default because TAS to memory uses a locked
 * read-modify-write cycle that some hardware cannot arbitrate. A data-register
 * operand performs no memory access at all, so it carries none of that risk.
 */
export const dataRegisterSignBitToTas: Rule = {
  meta: {
    obfuscated: true,
    id: "optimization/data-register-sign-bit-to-tas",
    category: "optimization",
    defaultSeverity: "suggestion",
    description: "Use TAS to set bit 7 of a data register",
    tags: ["peephole", "tas", "ccr"],
    docs: {
      source: "EAB 68000 code optimisations",
      example: { source: "\tori.b #$80,d0\n\tadd.l d1,d2" },
    },
  },

  checkLine(ctx, line, index) {
    const mnemonic = semanticMnemonic(line);
    const destination = dataRegisterOperand(line, 1);
    if (!destination) return;

    // The flags each form leaves behind differ from TAS in different ways, so
    // each has its own set to prove dead.
    let differing: readonly ("X" | "N" | "Z" | "V" | "C")[];
    if (mnemonic === "bset") {
      // Bit numbers on a data register are modulo 32, so bit 7 is the low
      // byte's sign bit, which is the bit TAS sets.
      const bit = immediateExpressionOperand(line, 0);
      if (!bit) return;
      const value = ctx.evaluate(bit);
      if (!value.known || (value.value & 31) !== 7) return;
      // BSET sets Z from the bit's previous state, exactly as TAS does. It
      // leaves N, V and C alone, where TAS writes all three.
      differing = ["N", "V", "C"];
    } else if (mnemonic === "or" && instructionSize(line) === "b") {
      const immediate = immediateExpressionOperand(line, 0);
      if (!immediate) return;
      const value = ctx.evaluate(immediate);
      if (!value.known || (value.value & 0xff) !== 0x80) return;
      // Both clear V and C. ORI sets N and Z from the result, so Z is always
      // clear; TAS reports the byte's state beforehand.
      differing = ["N", "Z"];
    } else {
      return;
    }

    const register = destination.register;
    const safety = changedFlagsApplicability(ctx, index, differing);

    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence: safety.confidence,
      message: `Setting bit 7 of ${register.toUpperCase()} is a single TAS`,
      loc: line.mnemonic!.loc,
      suggestion: {
        description: `Use tas ${register}`,
        replacement: `tas ${register}`,
        applicability: safety.applicability,
      },
      notes: [
        {
          message:
            mnemonic === "bset"
              ? "Z means the same thing in both, but TAS also writes N, V and C where BSET leaves them alone."
              : "V and C are cleared by both, but TAS reports the byte's state before the change where ORI reports it after.",
        },
      ],
      data: { register },
    });
  },
};
