import type { Rule } from "../../core/rule.js";
import {
  dataRegisterOperand,
  instructionSize,
  isInstruction,
} from "../../util/ast.js";
import { semanticMnemonic } from "../../semantics/mnemonics.js";

function hasInterveningLabel(
  ctx: Parameters<NonNullable<Rule["checkLine"]>>[0],
  from: number,
  to: number,
): boolean {
  for (let i = from + 1; i <= to; i++) if (ctx.line(i)?.label) return true;
  return false;
}

type ProducerInfo = {
  register: string;
  size: "b" | "w" | "l";
  exactTstFlags: boolean;
};

function producerInfo(
  line: Parameters<NonNullable<Rule["checkLine"]>>[1],
): ProducerInfo | undefined {
  const mnemonic = semanticMnemonic(line) ?? "";

  if (mnemonic === "moveq") {
    const dest = dataRegisterOperand(line, 1);
    return dest
      ? { register: dest.register, size: "l", exactTstFlags: true }
      : undefined;
  }

  if (mnemonic === "swap") {
    const dest = dataRegisterOperand(line, 0);
    return dest
      ? { register: dest.register, size: "l", exactTstFlags: true }
      : undefined;
  }

  const size = instructionSize(line);
  if (size !== "b" && size !== "w" && size !== "l") return undefined;

  const unaryExact = ["clr", "not", "ext", "extb"];
  const binaryExact = ["move", "and", "or", "eor"];
  const unaryResult = ["neg"];
  const binaryResult = [
    "add",
    "addq",
    "sub",
    "subq",
    "asl",
    "asr",
    "lsl",
    "lsr",
    "rol",
    "ror",
  ];

  if (unaryExact.includes(mnemonic) || unaryResult.includes(mnemonic)) {
    const dest = dataRegisterOperand(line, 0);
    return dest
      ? {
          register: dest.register,
          size,
          exactTstFlags: unaryExact.includes(mnemonic),
        }
      : undefined;
  }
  if (binaryExact.includes(mnemonic) || binaryResult.includes(mnemonic)) {
    const dest = dataRegisterOperand(line, 1);
    return dest
      ? {
          register: dest.register,
          size,
          exactTstFlags: binaryExact.includes(mnemonic),
        }
      : undefined;
  }

  return undefined;
}

/**
 * Source-independent lint: a very common hand-written assembly pattern is to
 * TST a data register immediately after an instruction which already set the
 * useful condition codes for that same result.
 */
export const redundantTst: Rule = {
  meta: {
    id: "optimization/redundant-tst",
    category: "optimization",
    defaultSeverity: "suggestion",
    description:
      "Remove a TST when the previous instruction already established the required flags",
    tags: ["peephole", "ccr", "native"],
    docs: { note: "m68k-lint native rule; not derived from ASP68K." },
  },
  checkLine(ctx, line, index) {
    if (!isInstruction(line, "tst")) return;
    const tested = dataRegisterOperand(line, 0);
    const tstSize = instructionSize(line);
    if (!tested || !tstSize || !["b", "w", "l"].includes(tstSize)) return;

    const previous = ctx.previousInstruction(index);
    if (!previous || hasInterveningLabel(ctx, previous.index, index)) return;
    const producer = producerInfo(previous.line);
    if (
      !producer ||
      producer.register.toLowerCase() !== tested.register.toLowerCase() ||
      producer.size !== tstSize
    )
      return;

    // MOVE/logical/CLR/NOT/EXT/SWAP produce the same N/Z/V/C values TST
    // would produce for the result. Arithmetic and shifts agree on N/Z, but
    // TST clears V/C, so those flags must be dead for the TST to be removable.
    if (!producer.exactTstFlags) {
      if (
        ctx.flags.isLiveAfter(index, "V") !== "dead" ||
        ctx.flags.isLiveAfter(index, "C") !== "dead"
      )
        return;
    }

    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence: "certain",
      message: `TST.${tstSize} ${tested.register} is redundant; the previous instruction already sets the condition codes needed for this result`,
      loc: line.mnemonic!.loc,
      suggestion: {
        description: "Remove the redundant TST",
        replacement: "",
        applicability: "safe",
      },
      notes: producer.exactTstFlags
        ? []
        : [
            {
              message:
                "The preceding arithmetic/shift produces the same N/Z result, and V/C are proven dead before any use.",
            },
          ],
      data: { producerInstructionIndex: previous.index },
    });
  },
};
