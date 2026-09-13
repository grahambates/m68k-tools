import type { Rule } from "../../core/rule.js";
import {
  dataRegisterOperand,
  immediateOperand,
  instructionSize,
  isInstruction,
} from "../../util/ast.js";
import { changedFlagsApplicability } from "./helpers.js";

function targetsAre(
  ctx: Parameters<NonNullable<Rule["checkLine"]>>[0],
  allowed: readonly string[],
): boolean {
  return ctx.config.processors.every((cpu) => allowed.includes(cpu));
}

/**
 * ASP68K contains a family of long shifts where moving the useful half-word
 * into position is cheaper than performing a 16..31 bit long shift on early CPUs.
 */
export const longShiftSequence: Rule = {
  meta: {
    id: "optimization/long-shift-sequence",
    category: "optimization",
    defaultSeverity: "suggestion",
    description:
      "Replace selected 16..31-bit long shifts with word/SWAP sequences",
    tags: ["asp68k", "shift", "sequence", "ccr", "68000", "68010"],
    serves: "speed",
    docs: { source: "ASP68K" },
  },
  checkLine(ctx, line, index) {
    const kind = ["asl", "asr", "lsl", "lsr"].find((name) =>
      isInstruction(line, name),
    );
    if (!kind || instructionSize(line) !== "l") return;

    const imm = immediateOperand(line, 0);
    const dest = dataRegisterOperand(line, 1);
    if (!imm || !dest || imm.value.type === "string-literal") return;
    const amount = ctx.evaluate(imm.value);
    if (!amount.known || amount.value < 16 || amount.value >= 32) return;

    // ASP68K only records these as wins on the following targets. 68020 is
    // deliberately excluded because the source has no timing data for it.
    const allowed =
      kind === "lsr" && amount.value === 16
        ? ["mc68000", "mc68010", "mc68030"]
        : ["mc68000", "mc68010"];
    if (!targetsAre(ctx, allowed)) return;

    const r = dest.register;
    let replacement: string;
    if ((kind === "asl" || kind === "lsl") && amount.value === 16) {
      replacement = `swap ${r}\nclr.w ${r}`;
    } else if ((kind === "asl" || kind === "lsl") && amount.value > 16) {
      replacement = `${kind}.w #${amount.value - 16},${r}\nswap ${r}\nclr.w ${r}`;
    } else if (kind === "asr" && amount.value === 16) {
      replacement = `swap ${r}\next.l ${r}`;
    } else if (kind === "asr") {
      replacement = `swap ${r}\nasr.w #${amount.value - 16},${r}\next.l ${r}`;
    } else if (kind === "lsr" && amount.value === 16) {
      replacement = `clr.w ${r}\nswap ${r}`;
    } else {
      replacement = `clr.w ${r}\nswap ${r}\nlsr.w #${amount.value - 16},${r}`;
    }

    const safety = changedFlagsApplicability(ctx, index, [
      "X",
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
      message: `${kind.toUpperCase()}.L #${amount.value},${r} can use a shorter half-word/SWAP sequence on the selected target`,
      loc: line.mnemonic!.loc,
      suggestion: {
        description: `Replace the ${amount.value}-bit long shift with a word-oriented sequence`,
        replacement,
        applicability: safety.applicability,
      },
      notes: [
        {
          message:
            "The replacement is faster on the selected targets, but the condition codes differ.",
        },
        ...(safety.applicability === "safe"
          ? [
              {
                message:
                  "All differing condition-code values are proven dead here.",
              },
            ]
          : [
              {
                message:
                  "Review later condition-code use before applying this replacement.",
              },
            ]),
      ],
    });
  },
};
