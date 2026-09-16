import type { ExpressionNode, ParsedLine } from "m68k-parser";
import type { Rule } from "../../core/rule.js";
import type { RuleContext } from "../../core/context.js";
import {
  dataRegisterOperand,
  immediateExpressionOperand,
  isInstruction,
} from "../../util/ast.js";
import {
  changedFlagsApplicability,
  containsSymbol,
  embeddedValueText,
  hasLabelBetween,
} from "./helpers.js";

type BitKind = "bset" | "bclr" | "bchg";
const KINDS: readonly BitKind[] = ["bset", "bclr", "bchg"];

/** The masked operation each bit instruction becomes once several are merged. */
const MERGED: Readonly<Record<BitKind, "or" | "and" | "eor">> = {
  bset: "or",
  bclr: "and",
  bchg: "eor",
};

interface BitOp {
  kind: BitKind;
  register: string;
  expression: ExpressionNode;
  bit: number;
}

function bitOp(
  ctx: RuleContext,
  line: ParsedLine | undefined,
): BitOp | undefined {
  if (!line) return undefined;
  const kind = KINDS.find((k) => isInstruction(line, k));
  if (!kind) return undefined;
  // Only a data register: the memory forms are byte-sized read-modify-writes
  // with their own bus behaviour, and are a different rule's business.
  const dest = dataRegisterOperand(line, 1);
  const expression = immediateExpressionOperand(line, 0);
  if (!dest || !expression) return undefined;
  const value = ctx.evaluate(expression);
  if (!value.known || value.value < 0 || value.value > 31) return undefined;
  return {
    kind,
    register: dest.register.toLowerCase(),
    expression,
    bit: value.value,
  };
}

function sameTarget(a: BitOp, b: BitOp): boolean {
  return a.kind === b.kind && a.register === b.register;
}

/**
 * Several single-bit operations on one register are one masked operation.
 *
 * `bclr #0,d0 / bclr #4,d0` clears the same two bits as `and.w #$ffee,d0`, in
 * a quarter of the cycles: measured on 68000 a two-instruction chain goes from
 * 8 bytes and 28 cycles to 4 and 8, and the four-long chains that show up in
 * real boot code go from 16 bytes and 56 cycles to the same 4 and 8.
 *
 * BSET/BCLR/BCHG only touch Z, and set it from the bit as it was *before* the
 * change, while AND/OR/EOR set N and Z from the result and clear V and C. The
 * merged form is therefore only offered where those flags are dead, which is
 * the same condition `bit-op-low-word` applies to the single-bit case.
 */
export const combineConsecutiveBitOps: Rule = {
  meta: {
    // The combined mask hides the individual bit operations.
    obfuscated: true,
    id: "optimization/combine-consecutive-bit-ops",
    category: "optimization",
    defaultSeverity: "suggestion",
    description:
      "Combine consecutive single-bit operations on one register into one masked operation",
    tags: ["peephole", "bit", "ccr", "native"],
    docs: {
      note: "Found by mining a corpus of real Amiga assembly, where BCLR chains clearing several bits of one register are common in hardware setup code.",
      example: { source: "\tbclr #0,d0\n\tbclr #4,d0\n\tadd.l d1,d2" },
    },
  },

  checkLine(ctx, line, index) {
    const first = bitOp(ctx, line);
    if (!first) return;

    // Report a run once, from its start: if the instruction before this one is
    // already part of the same run, the report belongs to that earlier line.
    const previous = ctx.previousInstruction(index);
    if (previous && !hasLabelBetween(ctx, previous.index, index)) {
      const before = bitOp(ctx, previous.line);
      if (before && sameTarget(before, first) && !line.label) return;
    }

    const members = [{ op: first, index }];
    let cursor = index;
    for (;;) {
      const next = ctx.nextInstruction(cursor);
      if (!next || hasLabelBetween(ctx, cursor, next.index)) break;
      const op = bitOp(ctx, next.line);
      if (!op || !sameTarget(op, first)) break;
      members.push({ op, index: next.index });
      cursor = next.index;
    }
    if (members.length < 2) return;

    // BSET and BCLR are idempotent, so their bits simply accumulate. BCHG is
    // its own inverse: toggling the same bit twice leaves it alone, so those
    // cancel out of the mask rather than piling up.
    let mask = 0;
    for (const { op } of members) {
      const bit = 1 << op.bit;
      mask = first.kind === "bchg" ? mask ^ bit : mask | bit;
    }
    if (mask === 0) return;

    const highest = Math.max(...members.map((m) => m.op.bit));
    const size = highest <= 7 ? "b" : highest <= 15 ? "w" : "l";
    const width = size === "b" ? 2 : size === "w" ? 4 : 8;
    const limit = size === "b" ? 0xff : size === "w" ? 0xffff : 0xffffffff;

    // Written as shifts of the bit numbers when any of them is a name, so a
    // `bclr #SPRITE_ON,d0` keeps saying which bit it means rather than becoming
    // an opaque mask that no longer tracks the constant it came from.
    // `& limit` works on a signed 32-bit value, so the unsigned coercion has to
    // come after it or a mask reaching bit 31 renders as a negative number.
    const hex = (value: number) =>
      `$${((value & limit) >>> 0).toString(16).padStart(width, "0")}`;
    const symbolic = members.some((m) => containsSymbol(m.op.expression));
    // Each shift is parenthesised so the mask does not depend on the assembler
    // agreeing with C about how `<<` and `|` bind.
    const bits = members
      .map((m) => `(1<<${embeddedValueText(ctx, m.op.expression, m.op.bit)})`)
      .join("|");
    const maskText =
      first.kind === "bclr"
        ? symbolic
          ? `~(${bits})`
          : hex(~mask)
        : symbolic
          ? bits
          : hex(mask);

    const operation = MERGED[first.kind];
    const last = members[members.length - 1];
    const safety = changedFlagsApplicability(ctx, last.index, [
      "N",
      "Z",
      "V",
      "C",
    ]);
    const replacement = `${operation}.${size} #${maskText},${first.register}`;

    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence: safety.confidence,
      message: `${members.length} consecutive ${first.kind.toUpperCase()} operations on ${first.register.toUpperCase()} are one ${operation.toUpperCase()}.${size.toUpperCase()}`,
      loc: line.mnemonic!.loc,
      suggestion: {
        description: `Use ${replacement.toUpperCase()}`,
        replacement,
        applicability: safety.applicability,
      },
      notes: [
        ...(safety.applicability === "safe"
          ? []
          : [
              {
                message: `${first.kind.toUpperCase()} sets Z from the bit it tested, while ${operation.toUpperCase()} sets N and Z from the result and clears V and C; review the flag use after the run.`,
              },
            ]),
      ],
      data: Object.fromEntries([
        ["mask", mask >>> 0],
        ...members
          .slice(1)
          .map((m, i) => [`member${i + 2}InstructionIndex`, m.index] as const),
      ]),
    });
  },
};
