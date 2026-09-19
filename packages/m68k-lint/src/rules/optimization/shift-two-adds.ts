import type { Rule } from "../../core/rule.js";
import {
  dataRegisterOperand,
  immediateOperand,
  instructionSize,
  isInstruction,
} from "../../util/ast.js";
import { changedFlagsApplicability } from "./helpers.js";

export const shiftTwoAdds: Rule = {
  meta: {
    obfuscated: true,
    id: "optimization/shift-two-adds",
    category: "optimization",
    defaultSeverity: "suggestion",
    description: "Consider two ADDs for a two-bit byte/word left shift",
    tags: ["asp68k", "ccr"],
    serves: "speed",
    docs: {
      source: "ASP68K",
      example: { source: "\tlsl.b #2,d0\n\tadd.l d1,d2" },
    },
  },
  checkLine(ctx, line, index) {
    const shift = isInstruction(line, "asl")
      ? "asl"
      : isInstruction(line, "lsl")
        ? "lsl"
        : undefined;
    if (!shift) return;
    const size = instructionSize(line);
    if (size !== "b" && size !== "w") return;
    const count = immediateOperand(line, 0);
    const dest = dataRegisterOperand(line, 1);
    if (!count || !dest) return;
    const value = ctx.evaluate(count.value);
    if (!value.known || value.value !== 2) return;

    // Verified with 68kcounter: ASL.B/W #2 is a genuine cycle win through
    // 68040. LSL ties on 68030 instead of improving (4 cycles either way)
    // while still costing 2 more bytes, so 68030 is excluded for LSL only.
    const allowed =
      shift === "asl"
        ? ["mc68000", "mc68010", "mc68030", "mc68040"]
        : ["mc68000", "mc68010"];
    if (!ctx.config.processors.every((cpu) => allowed.includes(cpu))) return;

    const safety = changedFlagsApplicability(ctx, index, [
      "X",
      "N",
      "Z",
      "V",
      "C",
    ]);
    const add = `add.${size} ${dest.register},${dest.register}`;
    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence: safety.confidence,
      message: `${shift.toUpperCase()}.${size} #2 can be faster as two ADDs on this target`,
      loc: line.mnemonic!.loc,
      suggestion: {
        description: `Use two ${add.toUpperCase()} instructions`,
        replacement: `${add}\n${add}`,
        applicability: safety.applicability,
      },
      notes: [
        ...(safety.applicability === "safe"
          ? []
          : [
              {
                message:
                  "Multi-bit shift and repeated ADD flag behaviour is not assumed equivalent; review CCR use.",
              },
            ]),
      ],
    });
  },
};
