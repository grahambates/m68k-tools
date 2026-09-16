import type { ParsedLine } from "m68k-parser";
import type { Rule } from "../../core/rule.js";
import type { RuleContext } from "../../core/context.js";
import {
  instructionSize,
  isInstruction,
  operand,
  postincrementAddressRegister,
} from "../../util/ast.js";
import {
  normalizeRegister,
  registerOrdinal,
  type Register,
} from "../../semantics/registers.js";
import { formatRegisterList } from "../suspicious/movem-restore-mismatch.js";
import { changedFlagsApplicability, hasLabelBetween } from "./helpers.js";

interface Load {
  base: Register;
  register: Register;
}

/** A `move.l (An)+,Rn` with concrete registers on both sides. */
function postincrementLoad(line: ParsedLine): Load | undefined {
  if (!isInstruction(line, "move") && !isInstruction(line, "movea"))
    return undefined;
  if (instructionSize(line) !== "l") return undefined;
  const source = postincrementAddressRegister(line, 0);
  const destination = operand(line, 1);
  if (
    !source ||
    (destination?.type !== "data-register" &&
      destination?.type !== "address-register")
  )
    return undefined;
  const base = normalizeRegister(source.register);
  const register = normalizeRegister(destination.register);
  if (!base || !register) return undefined;
  // Loading into the pointer being walked is not something MOVEM reproduces:
  // it would still be advancing the register the list has just overwritten.
  if (base === register) return undefined;
  return { base, register };
}

function continues(run: readonly Load[], next: Load): boolean {
  const last = run[run.length - 1];
  return (
    next.base === last.base &&
    registerOrdinal(next.register) > registerOrdinal(last.register)
  );
}

function runStartsHere(
  ctx: RuleContext,
  line: ParsedLine,
  index: number,
  first: Load,
): boolean {
  const previous = ctx.previousInstruction(index);
  if (!previous || hasLabelBetween(ctx, previous.index, index) || line.label)
    return true;
  const before = postincrementLoad(previous.line);
  return !before || !continues([before], first);
}

/**
 * Every consumed line's index, under the `*InstructionIndex` keys
 * `computeSourceSpan` reads, so the replacement covers the whole run.
 */
function memberData(
  list: string,
  indices: readonly number[],
): Record<string, string | number> {
  const data: Record<string, string | number> = { registers: list };
  indices.slice(1).forEach((index, n) => {
    data[`member${n + 2}InstructionIndex`] = index;
  });
  return data;
}

/**
 * A run of postincrement loads through one pointer is what MOVEM does in a
 * single instruction:
 *
 *   move.l (a0)+,d0        movem.l (a0)+,d0-d2
 *   move.l (a0)+,d1   ->
 *   move.l (a0)+,d2
 *
 * MOVEM fills the list in register order, D0-D7 then A0-A7, so a run only
 * folds when its registers ascend in that order. The register numbers need not
 * be contiguous -- the list is a bitmask, so `d1/d3/d5` is one instruction just
 * as `d0-d2` is -- but the loads must be consecutive, because the pointer walks
 * forward one slot at a time either way.
 *
 * Three is the floor, not two. Measured with 68kcounter on 68000, two loads are
 * the same 4 bytes as `movem.l` and 4 cycles *faster*, so folding a pair is a
 * regression. From three it turns: 6 bytes and 36 cycles become 4 and 36, and
 * an eight-register run goes from 16 bytes and 96 cycles to 4 and 76.
 *
 * Long only for now. MOVEM.W sign-extends each word into the whole register,
 * where `move.w (a0)+,d0` leaves the top half alone, so a word run would have
 * to prove those bits dead first. In the corpus 169 of 188 foldable runs are
 * long anyway.
 *
 * Restricted to the targets the win is measured on, now that 68kcounter
 * models 68020 through 68060: 68000/68010/68020 agree with the numbers above.
 * 68030 does not -- checked at every register count from 2 through 8, MOVEM
 * is consistently 6 to 10 cycles *slower* there than the loads it replaces,
 * so it is excluded despite the earlier, 68000/68020-only measurement having
 * included it. 68040 is consistently 3 cycles slower at every count and stays
 * excluded too. 68060 ties the loads it replaces at every count (never faster,
 * never slower) and is a pure 2-byte win, so it is included.
 */
const MEASURED_TARGETS = ["mc68000", "mc68010", "mc68020", "mc68060"];
export const combineLoadsIntoMovem: Rule = {
  meta: {
    id: "optimization/combine-loads-into-movem",
    category: "optimization",
    defaultSeverity: "suggestion",
    description: "Combine a run of postincrement loads into one MOVEM",
    tags: ["movem", "sequence", "memory", "ccr", "native"],
    docs: {
      note: "Found by mining a corpus of real Amiga assembly, where reading a header or vertex record field by field through a walking pointer is the common shape.",
      example: {
        source: "\tmove.l (a0)+,d0\n\tmove.l (a0)+,d1\n\tmove.l (a0)+,d2",
      },
    },
  },

  checkLine(ctx, line, index) {
    if (!ctx.config.processors.every((cpu) => MEASURED_TARGETS.includes(cpu)))
      return;
    const first = postincrementLoad(line);
    if (!first) return;
    // Report each run once, from its first load.
    if (!runStartsHere(ctx, line, index, first)) return;

    const loads = [first];
    const indices = [index];
    let cursor = index;
    for (;;) {
      const next = ctx.nextInstruction(cursor);
      if (!next || hasLabelBetween(ctx, cursor, next.index)) break;
      const load = postincrementLoad(next.line);
      if (!load || !continues(loads, load)) break;
      loads.push(load);
      indices.push(next.index);
      cursor = next.index;
    }

    // Two loads measure worse than one MOVEM; the win starts at three.
    if (loads.length < 3) return;

    const list = formatRegisterList(loads.map((l) => l.register));
    const lastIndex = indices[indices.length - 1];
    // Each MOVE sets N/Z/V/C from the value it loaded; MOVEM sets none at all,
    // so the flags the run would have left behind have to be dead.
    const safety = changedFlagsApplicability(ctx, lastIndex, [
      "N",
      "Z",
      "V",
      "C",
    ]);
    const replacement = `movem.l (${first.base})+,${list}`;

    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence: safety.confidence,
      message: `${loads.length} consecutive loads through (${first.base.toUpperCase()})+ are one MOVEM.L`,
      loc: line.mnemonic!.loc,
      suggestion: {
        description: `Use MOVEM.L (${first.base.toUpperCase()})+,${list.toUpperCase()}`,
        replacement,
        applicability: safety.applicability,
      },
      notes: [
        {
          message: `The registers ascend in MOVEM's own order, so the list loads them in the order the pointer walks.`,
        },
        ...(safety.applicability === "safe"
          ? []
          : [
              {
                message:
                  "Each MOVE sets N/Z/V/C from the value it loaded and MOVEM sets no flags at all; review the flag use after the run.",
              },
            ]),
      ],
      data: memberData(list, indices),
    });
  },
};
