import type { OperandNode } from "m68k-parser";
import type { Rule } from "../../core/rule.js";
import {
  immediateExpressionOperand,
  instructionSize,
  isInstruction,
  operand,
} from "../../util/ast.js";
import { sourceOperand } from "./helpers.js";

function isTstDestination(op: OperandNode | undefined): boolean {
  return (
    !!op &&
    [
      "data-register",
      "address-register-indirect",
      "address-register-indirect-postinc",
      "address-register-indirect-predec",
      "address-register-indirect-displacement",
      "address-register-indirect-index",
      "memory-indirect",
      "absolute-address",
    ].includes(op.type)
  );
}

function makeIdentityRule(
  id: string,
  mnemonic: "and" | "or" | "eor",
  expected: number | "all-ones",
  label: string,
): Rule {
  return {
    meta: {
      // TST hides the original logical operation and any mask expression.
      obfuscated: true,
      id,
      category: "optimization",
      defaultSeverity: "suggestion",
      description: `${label} can use TST`,
      tags: ["vasm", "identity", "tst", "ccr"],
      docs: { source: "vasm m68k optimization history" },
    },
    checkLine(ctx, line) {
      if (!isInstruction(line, mnemonic)) return;
      const expr = immediateExpressionOperand(line, 0);
      const dst = operand(line, 1);
      if (!expr || !isTstDestination(dst)) return;
      const value = ctx.evaluate(expr);
      if (!value.known) return;

      const size = instructionSize(line);
      if (!size || !["b", "w", "l"].includes(size)) return;
      if (expected === "all-ones") {
        const mask = size === "b" ? 0xff : size === "w" ? 0xffff : 0xffffffff;
        if (value.value >>> 0 !== mask && value.value !== -1) return;
      } else if (value.value !== expected) return;
      const text = sourceOperand(ctx, line, 1);
      if (!text) return;

      const registerOnly = dst?.type === "data-register";
      ctx.report({
        ruleId: this.meta.id,
        category: this.meta.category,
        severity: this.meta.defaultSeverity,
        confidence: registerOnly ? "certain" : "high",
        message: `${label} leaves the operand unchanged and can use TST.${size.toUpperCase()}`,
        loc: line.mnemonic!.loc,
        suggestion: {
          description: `Use TST.${size.toUpperCase()}`,
          replacement: `tst.${size} ${text}`,
          applicability: registerOnly ? "safe" : "conditional",
        },
        notes: registerOnly
          ? []
          : [
              {
                message:
                  "The value and CCR are equivalent, but the original instruction is a memory read-modify-write while TST is only a read. Review memory-mapped I/O or other write side effects.",
              },
            ],
      });
    },
  };
}

export const andAllOnesToTst = makeIdentityRule(
  "optimization/andi-all-ones-to-tst",
  "and",
  "all-ones",
  "ANDI #-1/all-ones",
);

export const orZeroToTst = makeIdentityRule(
  "optimization/ori-zero-to-tst",
  "or",
  0,
  "ORI #0",
);

export const eorZeroToTst = makeIdentityRule(
  "optimization/eori-zero-to-tst",
  "eor",
  0,
  "EORI #0",
);
