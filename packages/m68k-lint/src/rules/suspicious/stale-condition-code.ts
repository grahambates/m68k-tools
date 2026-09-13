import type { ParsedLine } from "m68k-parser";
import type { Rule } from "../../core/rule.js";
import {
  flagsReadByCondition,
  getFlagSemantics,
  isAddressRegisterWriteWithoutCCR,
} from "../../semantics/flags.js";
import { semanticMnemonic } from "../../semantics/mnemonics.js";

function mnemonic(line: ParsedLine | undefined): string | undefined {
  return line ? semanticMnemonic(line) : undefined;
}

export const staleConditionCode: Rule = {
  meta: {
    id: "suspicious/stale-condition-code",
    category: "suspicious",
    defaultSeverity: "warning",
    description:
      "Flag conditional operations that appear to test stale condition codes",
    tags: ["ccr", "control-flow", "likely-bug"],
  },

  checkLine(ctx, line, index) {
    const name = mnemonic(line);
    if (!name) return;

    const readFlags = [...flagsReadByCondition(name)];
    if (readFlags.length === 0) return;

    const previous = ctx.previousInstruction(index);
    const previousName = mnemonic(previous?.line);
    if (
      !previous ||
      !previousName ||
      !isAddressRegisterWriteWithoutCCR(previous.line)
    )
      return;

    const previousSemantics = getFlagSemantics(previous.line);
    if (
      previousSemantics.writes.size > 0 ||
      previousSemantics.undefined.size > 0
    )
      return;

    // Only warn when every flag read by this condition lacks a concrete
    // reaching definition. If a CMP/TST/etc. reaches through MOVEA/LEA, that is
    // valid intentional use of preserved flags and should stay quiet.
    const suspectFlags = readFlags.filter((flag) => {
      const defs = ctx.flags.reachingDefinitionsBefore(index, flag);
      return (
        defs.length === 0 || defs.some((def) => def.kind !== "instruction")
      );
    });
    if (suspectFlags.length === 0) return;

    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence: "high",
      message: `${name.toUpperCase()} tests ${suspectFlags.join("/")}, but ${previousName.toUpperCase()} does not set condition codes`,
      loc: line.mnemonic!.loc,
      suggestion: {
        description:
          "Review whether an explicit CMP/TST was intended before the conditional operation",
        applicability: "manual",
      },
      notes: [
        {
          message: `At least one path reaches this instruction with the condition code coming from function entry or an unknown control-flow boundary, not from ${previousName.toUpperCase()}.`,
        },
      ],
    });
  },
};
