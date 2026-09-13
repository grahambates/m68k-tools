import type { Rule } from "../../core/rule.js";
import {
  dataRegisterOperand,
  immediateOperand,
  instructionSize,
  isInstruction,
} from "../../util/ast.js";
import { changedFlagsApplicability } from "./helpers.js";

function u32(n: number): number {
  return n >>> 0;
}
function s32(n: number): number {
  const v = n >>> 0;
  return v >= 0x80000000 ? v - 0x100000000 : v;
}
function moveqValue(m: number): number {
  return m < 0 ? (0x100000000 + m) >>> 0 : m >>> 0;
}
function notWord(v: number): number {
  return ((v & 0xffff0000) | (~v & 0xffff)) >>> 0;
}
function swapWord(v: number): number {
  return (((v & 0xffff) << 16) | ((v >>> 16) & 0xffff)) >>> 0;
}

/** True when MOVEQ alone loads the value, making any follow-up transform pointless. */
function isMoveqValue(v: number): boolean {
  const u = u32(v);
  return u <= 0x7f || u >= 0xffffff80;
}

function findMoveqSeed(
  target: number,
  transform: (v: number) => number,
): number | undefined {
  const wanted = u32(target);
  for (let m = -128; m <= 127; m++)
    if (transform(moveqValue(m)) === wanted) return m;
  return undefined;
}

function synthesisRule(
  id: string,
  transformName: "not.w" | "swap",
  transform: (v: number) => number,
  allowed: readonly string[],
): Rule {
  return {
    meta: {
      id,
      category: "optimization",
      defaultSeverity: "suggestion",
      description: `Synthesize selected long immediates with MOVEQ + ${transformName.toUpperCase()}`,
      tags: ["asp68k", "constant", "ccr"],
      docs: { source: "ASP68K" },
    },
    checkLine(ctx, line, index) {
      if (!isInstruction(line, "move") || instructionSize(line) !== "l") return;
      const imm = immediateOperand(line, 0);
      const dest = dataRegisterOperand(line, 1);
      if (!imm || imm.value.type === "string-literal" || !dest) return;
      const value = ctx.evaluate(imm.value);
      if (
        !value.known ||
        !ctx.config.processors.every((cpu) => allowed.includes(cpu))
      )
        return;
      // e.g. SWAP on MOVEQ #-1 or #0 is a no-op: optimization/prefer-moveq covers these.
      if (isMoveqValue(value.value)) return;
      const seed = findMoveqSeed(value.value, transform);
      if (seed === undefined) return;

      const changed =
        transformName === "not.w"
          ? (["N", "Z", "V", "C"] as const)
          : (["N", "Z", "V", "C"] as const);
      const safety = changedFlagsApplicability(ctx, index, changed);
      const replacement = `moveq #${seed},${dest.register}\n${transformName} ${dest.register}`;
      ctx.report({
        ruleId: id,
        category: "optimization",
        severity: "suggestion",
        confidence: safety.confidence,
        message: `Immediate ${s32(u32(value.value))} can be synthesized with MOVEQ + ${transformName.toUpperCase()}`,
        loc: line.mnemonic!.loc,
        suggestion: {
          description: `Use MOVEQ #${seed} then ${transformName.toUpperCase()}`,
          replacement,
          applicability: safety.applicability,
        },
        notes: [
          ...(safety.applicability === "safe"
            ? []
            : [
                {
                  message:
                    "The sequence can leave different condition-code values from MOVE.L; review later CCR use.",
                },
              ]),
        ],
      });
    },
  };
}

export const moveImmediateWordComplement = synthesisRule(
  "optimization/move-immediate-word-complement",
  "not.w",
  notWord,
  ["mc68000", "mc68010", "mc68030"],
);

export const moveImmediateSwap = synthesisRule(
  "optimization/move-immediate-swap",
  "swap",
  swapWord,
  ["mc68000", "mc68010"],
);
