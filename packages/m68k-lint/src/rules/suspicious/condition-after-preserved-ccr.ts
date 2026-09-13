import type { Rule } from "../../core/rule.js";
import {
  flagsReadByCondition,
  getFlagSemantics,
  type Flag,
} from "../../semantics/flags.js";
import { semanticMnemonic } from "../../semantics/mnemonics.js";

export const conditionAfterPreservedCcr: Rule = {
  meta: {
    id: "suspicious/condition-after-preserved-ccr",
    category: "suspicious",
    defaultSeverity: "warning",
    description:
      "Flag conditional instructions that deliberately rely on CCR across a flag-preserving instruction",
    tags: ["ccr", "control-flow", "implicit-state"],
  },

  checkLine(ctx, line, index) {
    const name = semanticMnemonic(line);
    if (!name) return;

    const readFlags = [...flagsReadByCondition(name)] as Flag[];
    if (readFlags.length === 0) return;

    const previous = ctx.previousInstruction(index);
    if (!previous) return;
    const previousName = semanticMnemonic(previous.line);
    if (!previousName) return;

    // A conditional instruction in between is reading the same condition, not
    // sitting obliviously on top of it. Nothing says the flags are meant more
    // clearly than another instruction already testing them, and consuming one
    // test more than once is ordinary:
    //
    //   move.l d0,dosHandle
    //   sne    isOS2
    //   bne.s  .dosOk
    //
    // Branches are already excluded by the control-flow check below; Scc and
    // the other conditionals that fall through were not.
    if (flagsReadByCondition(previousName).size > 0) return;

    const previousSemantics = getFlagSemantics(previous.line);
    if (previousSemantics.controlFlow !== "fallthrough") return;
    if (
      previousSemantics.writes.size !== 0 ||
      previousSemantics.undefined.size !== 0
    )
      return;

    // suspicious/stale-condition-code owns cases where the condition reaches
    // entry/unknown state. This rule is the complementary suspicious case:
    // the old flags are well-defined, but their preservation across the
    // intervening instruction is easy to miss while reading or editing code.
    const definitions = readFlags.flatMap((flag) =>
      ctx.flags.reachingDefinitionsBefore(index, flag),
    );
    if (
      definitions.length === 0 ||
      definitions.some((definition) => definition.kind !== "instruction")
    )
      return;

    const producerIndexes = [
      ...new Set(
        definitions
          .filter(
            (
              definition,
            ): definition is { kind: "instruction"; index: number } =>
              definition.kind === "instruction",
          )
          .map((definition) => definition.index),
      ),
    ];
    if (producerIndexes.length === 0) return;

    const producers = producerIndexes
      .map((producerIndex) => ctx.line(producerIndex))
      .filter(
        (producerLine): producerLine is NonNullable<typeof producerLine> =>
          Boolean(producerLine),
      )
      .map((producerLine) => semanticMnemonic(producerLine))
      .filter((producer): producer is string => Boolean(producer))
      .map((producer) => producer.toUpperCase());

    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence: "medium",
      message: `${name.toUpperCase()} relies on CCR preserved across ${previousName.toUpperCase()}`,
      loc: line.mnemonic!.loc,
      suggestion: {
        description:
          "Review whether preserving the earlier condition codes here is intentional",
        applicability: "manual",
      },
      notes: [
        {
          message: `${previousName.toUpperCase()} does not update CCR; the condition comes from ${producers.length ? producers.join("/") : "an earlier instruction"}.`,
        },
        {
          message:
            "This can be a useful 68k idiom, but it is fragile if an apparently harmless flag-setting instruction is inserted later.",
        },
      ],
    });
  },
};
