import type { ExpressionNode } from "m68k-parser";
import type { Rule } from "../../core/rule.js";
import { semanticMnemonic } from "../../semantics/mnemonics.js";
import {
  describeExpectedRanges,
  expectedAbsoluteAddressRange,
  platformLabels,
} from "../../platforms/address-ranges.js";
import { operand } from "../../util/ast.js";
import { hex } from "../../util/format.js";

// Deliberately conservative: these are instructions where an absolute source
// EA is valid and an immediate source is also a plausible intent.  We avoid
// control-flow operands and forms where a missing '#' would simply be rejected
// by the assembler, because those belong to syntax validation rather than lint.
const IMMEDIATE_OR_ABSOLUTE_SOURCE = new Set([
  "move",
  "movea",
  "add",
  "adda",
  "sub",
  "suba",
  "cmp",
  "cmpa",
  "and",
  "or",
  "muls",
  "mulu",
  "divs",
  "divu",
]);

function isPureNumericExpression(expr: ExpressionNode): boolean {
  switch (expr.type) {
    case "numeric-literal":
      return true;
    case "group":
      return isPureNumericExpression(expr.expression);
    case "unary-op":
      return isPureNumericExpression(expr.operand);
    case "binary-op":
      return (
        isPureNumericExpression(expr.left) &&
        isPureNumericExpression(expr.right)
      );
    default:
      return false;
  }
}

export const unexpectedAbsoluteAddress: Rule = {
  meta: {
    id: "suspicious/unexpected-absolute-address",
    category: "suspicious",
    defaultSeverity: "warning",
    platforms: ["amiga", "atari"],
    description:
      "Flag unusual numeric absolute source addresses that may be missing an immediate '#' prefix",
    tags: ["amiga", "atari", "absolute-address", "likely-typo", "immediate"],
    docs: {
      note: "Heuristic for the common 68k typo where an intended immediate constant is written without '#'. Expected absolute regions are kept as platform metadata rather than hard-coded into the rule.",
    },
  },

  checkFile(ctx) {
    const platform = ctx.config.platform ?? "generic";
    // ORG is a strong signal that this source intentionally uses absolute
    // addresses. Without a full location-counter model, suppress the heuristic
    // for the whole file rather than second-guessing individual operands.
    if (
      ctx.file.lines.some(
        (line) =>
          line.mnemonic?.type === "directive" &&
          line.mnemonic.directive.toLowerCase() === "org",
      )
    )
      return;

    for (const line of ctx.file.lines) {
      const mnemonic = semanticMnemonic(line);
      if (!mnemonic || !IMMEDIATE_OR_ABSOLUTE_SOURCE.has(mnemonic)) continue;

      const source = operand(line, 0);
      if (source?.type !== "absolute-address") continue;
      if (!isPureNumericExpression(source.address)) continue;

      const result = ctx.evaluate(source.address);
      if (!result.known) continue;
      const address = result.value >>> 0;
      if (expectedAbsoluteAddressRange(platform, address)) continue;

      ctx.report({
        ruleId: this.meta.id,
        category: this.meta.category,
        severity: this.meta.defaultSeverity,
        confidence: "medium",
        message: `Unexpected ${platformLabels[platform]} absolute source address ${hex(address)}; did you mean #${hex(address)}?`,
        loc: source.loc ?? line.mnemonic!.loc,
        notes: [
          {
            message:
              "This may still be deliberate absolute addressing; the warning is intended to catch accidentally omitted immediate '#' prefixes.",
          },
          {
            message: `Expected ${platformLabels[platform]} absolute regions are ${describeExpectedRanges(platform)}. Files containing ORG are exempt from this heuristic.`,
          },
        ],
        suggestion: {
          description: `Review whether ${hex(address)} is an address or the immediate value #${hex(address)}`,
          applicability: "manual",
        },
      });
    }
  },
};
