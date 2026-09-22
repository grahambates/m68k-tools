import type { Rule } from "../../core/rule.js";
import {
  dataRegisterOperand,
  immediateExpressionOperand,
  instructionSize,
  isInstruction,
} from "../../util/ast.js";
import {
  changedFlagsApplicability,
  isAuthoredExpression,
  embeddedValueText,
} from "./helpers.js";

function baseMatch(line: Parameters<NonNullable<Rule["checkLine"]>>[1]) {
  if (!isInstruction(line, "move") || instructionSize(line) !== "l")
    return undefined;
  const value = immediateExpressionOperand(line, 0);
  const dest = dataRegisterOperand(line, 1);
  if (!value || !dest) return undefined;
  return { value, dest };
}

export const moveImmediateBelowMoveq: Rule = {
  meta: {
    obfuscated: true,
    id: "optimization/move-immediate-below-moveq",
    category: "optimization",
    defaultSeverity: "suggestion",
    description:
      "Construct immediates just below MOVEQ range with MOVEQ plus SUBQ",
    tags: ["asp68k", "constant", "ccr"],
    docs: {
      source: "ASP68K",
      example: { source: "\tmove.l #-130,d0\n\tadd.l d1,d2" },
    },
  },
  checkLine(ctx, line, index) {
    const match = baseMatch(line);
    if (!match) return;
    const value = ctx.evaluate(match.value);
    if (!value.known || value.value < -136 || value.value > -129) return;
    const amount = value.value + 128; // -8 .. -1
    const q = -amount; // 1 .. 8
    const r = match.dest.register;
    const safety = changedFlagsApplicability(ctx, index, ["X", "V", "C"]);
    const replacement = `moveq #-128,${r}\nsubq.l #${q},${r}`;
    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence: safety.confidence,
      message: `${value.value} is just below the MOVEQ immediate range`,
      loc: line.mnemonic!.loc,
      suggestion: {
        description: "Use MOVEQ plus SUBQ",
        replacement,
        applicability: safety.applicability,
      },
      notes: [
        ...(safety.applicability === "safe"
          ? []
          : [
              {
                message:
                  "SUBQ can leave different X/V/C values from MOVE.L; review later CCR use.",
              },
            ]),
      ],
    });
  },
};

export const moveImmediateByteComplement: Rule = {
  meta: {
    obfuscated: true,
    id: "optimization/move-immediate-byte-complement",
    category: "optimization",
    defaultSeverity: "suggestion",
    description: "Construct 128..255 using MOVEQ plus NOT.B",
    tags: ["asp68k", "constant", "ccr"],
    docs: {
      source: "ASP68K",
      example: { source: "\tmove.l #200,d0\n\tadd.l d1,d2" },
    },
  },
  checkLine(ctx, line, index) {
    const match = baseMatch(line);
    if (!match) return;
    const value = ctx.evaluate(match.value);
    if (!value.known || value.value < 128 || value.value > 255) return;
    const m = 255 - value.value;
    if (m < 0 || m > 127) return;
    const r = match.dest.register;
    // NOT.B sets N/Z from the byte result whereas MOVE.L sets them from the long result,
    // so all visible condition codes must be dead before this is called safe.
    const safety = changedFlagsApplicability(ctx, index, ["N", "Z", "V", "C"]);
    const replacement = `moveq #${m},${r}\nnot.b ${r}`;
    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence: safety.confidence,
      message: `${value.value} can be synthesized with MOVEQ plus NOT.B`,
      loc: line.mnemonic!.loc,
      suggestion: {
        description: "Use MOVEQ plus NOT.B",
        replacement,
        applicability: safety.applicability,
      },
      notes: [
        ...(safety.applicability === "safe"
          ? []
          : [
              {
                message:
                  "The replacement leaves different condition-code details from MOVE.L; review later CCR use.",
              },
            ]),
      ],
    });
  },
};

export const moveImmediateDoubleByte: Rule = {
  meta: {
    obfuscated: true,
    id: "optimization/move-immediate-double-byte",
    category: "optimization",
    defaultSeverity: "suggestion",
    description: "Construct selected even immediates with MOVEQ plus ADD.B",
    tags: ["asp68k", "constant", "ccr"],
    docs: {
      source: "ASP68K",
      example: { source: "\tmove.l #150,d0\n\tadd.l d1,d2" },
    },
  },
  checkLine(ctx, line, index) {
    const match = baseMatch(line);
    if (!match) return;
    const value = ctx.evaluate(match.value);
    if (!value.known || (value.value & 1) !== 0) return;
    const inRange =
      (value.value >= 128 && value.value <= 254) ||
      (value.value >= -256 && value.value <= -130);
    if (!inRange) return;
    const m = value.value / 2;
    if (m < -128 || m > 127) return;
    const r = match.dest.register;
    const safety = changedFlagsApplicability(ctx, index, ["X", "V", "C"]);
    // The halving is exact, the value being even, so it can be written rather
    // than worked out. Done when the author wrote an expression, a name or a
    // sum, so that it is still there: `#SPRITE_BYTES/2`, `#100+50` as
    // `#(100+50)/2`. A bare `#200` becomes `#100`, not `#200/2`.
    const half = isAuthoredExpression(match.value)
      ? `${embeddedValueText(ctx, match.value, value.value)}/2`
      : String(m);
    const replacement = `moveq #${half},${r}\nadd.b ${r},${r}`;
    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence: safety.confidence,
      message: `${value.value} can be synthesized with MOVEQ plus a byte doubling`,
      loc: line.mnemonic!.loc,
      suggestion: {
        description: "Use MOVEQ plus ADD.B",
        replacement,
        applicability: safety.applicability,
      },
      notes: [
        ...(safety.applicability === "safe"
          ? []
          : [
              {
                message:
                  "ADD.B can leave different X/V/C values from MOVE.L; review later CCR use.",
              },
            ]),
      ],
    });
  },
};
