import type { Rule } from "../../core/rule.js";
import {
  dataRegisterOperand,
  immediateOperand,
  instructionSize,
  isInstruction,
} from "../../util/ast.js";
import { changedFlagsApplicability, embeddedValueText } from "./helpers.js";

function makeRule(kind: "bset" | "bclr" | "bchg"): Rule {
  return {
    meta: {
      id: `optimization/${kind}-low-word-mask`,
      category: "optimization",
      defaultSeverity: "suggestion",
      description: `Use a word mask for low-bit ${kind.toUpperCase()}`,
      tags: ["asp68k", "bit", "ccr"],
      docs: {
        source: "ASP68K",
        example: { source: `\t${kind} #3,d0\n\tadd.l d1,d2` },
      },
    },
    checkLine(ctx, line, index) {
      if (!isInstruction(line, kind)) return;
      const size = instructionSize(line);
      if (size && size !== "l") return;
      const bitOp = immediateOperand(line, 0);
      const dest = dataRegisterOperand(line, 1);
      if (!bitOp || bitOp.value.type === "string-literal" || !dest) return;
      const bit = ctx.evaluate(bitOp.value);
      if (!bit.known || bit.value < 0 || bit.value > 15) return;
      if (
        !ctx.config.processors.every((cpu) =>
          ["mc68000", "mc68010", "mc68030", "mc68040"].includes(cpu),
        )
      )
        return;

      const op = kind === "bset" ? "or" : kind === "bclr" ? "and" : "eor";
      // Written as a shift of the bit number rather than the value it produces.
      // It says which bit is meant instead of leaving the reader to decode a
      // hex constant, and it is the only way the bit number survives when it is
      // a symbol: `bset #SPRITE_ON,d3` keeps that name rather than becoming
      // `or.w #$0100,d3`, which stops tracking the constant it came from.
      const bitText = embeddedValueText(ctx, bitOp.value, bit.value);
      const renderedMask =
        kind === "bclr" ? `~(1<<${bitText})` : `1<<${bitText}`;
      const safety = changedFlagsApplicability(ctx, index, [
        "N",
        "Z",
        "V",
        "C",
      ]);

      ctx.report({
        ruleId: this.meta.id,
        category: this.meta.category,
        severity: this.meta.defaultSeverity,
        confidence: safety.confidence,
        message: `${kind.toUpperCase()} #${bitText},${dest.register} can use ${op.toUpperCase()}.W with a word mask`,
        loc: line.mnemonic!.loc,
        suggestion: {
          description: `Use ${op.toUpperCase()}.W #${renderedMask},${dest.register}`,
          replacement: `${op}.w #${renderedMask},${dest.register}`,
          applicability: safety.applicability,
        },
        notes: [
          ...(safety.applicability === "safe"
            ? []
            : [
                {
                  message:
                    "The mask operation and bit operation leave different condition-code results; review CCR use.",
                },
              ]),
        ],
      });
    },
  };
}

export const bsetLowWordMask = makeRule("bset");
export const bclrLowWordMask = makeRule("bclr");
export const bchgLowWordMask = makeRule("bchg");
