import type { Rule } from "../../core/rule.js";
import { semanticMnemonic } from "../../semantics/mnemonics.js";
import {
  addressRegisterOperand,
  immediateExpressionOperand,
  instructionSize,
} from "../../util/ast.js";

/** What each instruction does with the extended value, for the message. */
const operations: Readonly<
  Record<string, (register: string, used: string, written: string) => string>
> = {
  cmpa: (register, used, written) =>
    `compares ${register} with ${used}, not ${written}`,
  adda: (register, used, written) =>
    `adds ${used}, not ${written}, to ${register}`,
  suba: (register, used, written) =>
    `subtracts ${used}, not ${written}, from ${register}`,
};

const hex = (value: number) =>
  "$" + (value >>> 0).toString(16).toUpperCase().padStart(4, "0");

export const addressWordImmediateSignExtension: Rule = {
  meta: {
    id: "suspicious/address-word-immediate-sign-extension",
    category: "suspicious",
    defaultSeverity: "warning",
    description:
      "Flag a word immediate of $8000 to $FFFF compared with, added to or subtracted from an address register, where sign extension makes it negative",
    tags: ["address-registers", "sign-extension", "immediate"],
    docs: {
      source: "Motorola 68000 Family Programmer's Reference Manual",
      note: "CMPA.W, ADDA.W and SUBA.W sign-extend the source to 32 bits, so a word immediate written as $8000 to $FFFF takes part as $FFFF8000 to $FFFFFFFF. vasm 2.0f accepts these immediates without comment, and its optimiser reads the value as written: SUBA.W #$8000,A0 assembles as LEA -32768(A0) by default, subtracting 32768 where the instruction itself adds it. MOVEA.W has its own rule, which reports only when the extended half is used.",
    },
  },

  checkLine(ctx, line) {
    const mnemonic = semanticMnemonic(line);
    const operation = mnemonic && operations[mnemonic];
    // Without a size these are the word forms, as vasm assembles them.
    if (!operation || (instructionSize(line) ?? "w") !== "w") return;
    const expr = immediateExpressionOperand(line, 0);
    const destination = addressRegisterOperand(line, 1);
    if (!expr || !destination) return;
    const value = ctx.evaluate(expr);
    // A value that is already negative, or fits below $8000, means the same
    // extended or not.
    if (!value.known || value.value < 0x8000 || value.value > 0xffff) return;

    const extended = value.value - 0x10000;
    const register = destination.register.toUpperCase();
    const name = mnemonic.toUpperCase();
    const notes = [
      {
        message: `The immediate is sign-extended: ${hex(value.value)} is ${hex(extended)} (${extended}).`,
      },
    ];
    if (mnemonic === "suba" && value.value === 0x8000) {
      notes.push({
        message:
          "vasm's optimiser reads the value as written and assembles this as LEA -32768(An), which subtracts 32768; the instruction itself adds it.",
      });
    }

    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence: "high",
      message: `${name}.W ${operation(register, hex(extended), hex(value.value))}`,
      loc: line.mnemonic!.loc,
      suggestion: {
        description: `Use ${name}.L for ${hex(value.value)} as written, or write the immediate as ${extended} if the negative value is intended`,
        applicability: "manual",
      },
      notes,
    });
  },
};
