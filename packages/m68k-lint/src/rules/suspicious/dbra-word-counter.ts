import type { ParsedLine } from "m68k-parser";
import type { RuleContext } from "../../core/context.js";
import type { Rule } from "../../core/rule.js";
import { semanticMnemonic } from "../../semantics/mnemonics.js";
import { getRegisterSemantics } from "../../semantics/registers.js";
import { isExecutableLine, operand } from "../../util/ast.js";
import { hex } from "../../util/format.js";

/** Index of the label a backward DBcc branches to, searching upwards like a local label lookup. */
function loopStart(
  ctx: RuleContext,
  dbra: number,
  name: string,
): number | undefined {
  const wanted = name.toLowerCase();
  for (let i = dbra; i >= 0; i--)
    if (ctx.file.lines[i].label?.label.toLowerCase() === wanted) return i;
  return undefined;
}

function firstExecutableFrom(ctx: RuleContext, index: number): number {
  let i = index;
  while (i < ctx.file.lines.length && !isExecutableLine(ctx.file.lines[i])) i++;
  return i;
}

/** Whether any line between two indices matches. */
function anyBetween(
  ctx: RuleContext,
  from: number,
  to: number,
  test: (line: ParsedLine) => boolean,
): boolean {
  for (let i = from; i <= to; i++) if (test(ctx.file.lines[i])) return true;
  return false;
}

/**
 * DBcc decrements only the low word of its counter, and treats $FFFF as the end.
 *
 * A counter loaded as a longword with anything in the upper half is therefore
 * not the count it looks like: `move.l #100000,d0` runs the loop 34465 times,
 * and `moveq #-1,d0` runs it 65536.
 */
export const dbraWordCounter: Rule = {
  meta: {
    id: "suspicious/dbra-word-counter",
    category: "suspicious",
    defaultSeverity: "warning",
    description:
      "Flag a DBcc loop whose counter has a non-zero upper word on entry",
    tags: ["loop", "dbra"],
    docs: {
      note: "DBcc only looks at the low word of its counter. Reported when the counter is a known constant with bits set above bit 15 on entry to the loop and nothing in the loop writes it. Not reported when the routine also SWAPs the register, since packing an outer count into the upper word is a deliberate technique.",
    },
  },

  checkLine(ctx, line, index) {
    const mnemonic = semanticMnemonic(line);
    if (!mnemonic?.startsWith("db") || mnemonic.length < 3) return;
    const counter = operand(line, 0);
    const target = operand(line, 1);
    if (counter?.type !== "data-register") return;
    const targetName =
      target?.type === "absolute-address" && target.address.type === "symbol"
        ? target.address.name
        : target?.type === "value" && target.value.type === "symbol"
          ? target.value.name
          : undefined;
    if (!targetName || !line.mnemonic) return;

    const start = loopStart(ctx, index, targetName);
    if (start === undefined || start >= index) return;
    const head = firstExecutableFrom(ctx, start);
    if (head > index) return;

    const register = counter.register.toLowerCase();
    const written = (l: ParsedLine) => {
      if (!isExecutableLine(l)) return false;
      const sem = getRegisterSemantics(l);
      return (
        sem.writes.has(register as never) ||
        sem.partialWrites.has(register as never)
      );
    };
    // The loop changing its own counter is a different structure, and the
    // value on entry says nothing about it.
    if (anyBetween(ctx, head, index - 1, written)) return;

    // Values that reach the loop from above, not the ones the DBcc itself
    // feeds back around.
    const entries = [...ctx.registers.cfg.predecessors[head]].filter(
      (p) => p < head,
    );
    if (entries.length === 0) return;
    let value: number | undefined;
    for (const entry of entries) {
      const known = ctx.registers.valueAfter(entry, register);
      if (known.kind !== "constant") return;
      if (value !== undefined && value !== known.value) return;
      value = known.value;
    }
    if (value === undefined) return;

    const unsigned = value >>> 0;
    if (unsigned >>> 16 === 0) return;

    // An outer count packed into the upper word and reached with SWAP.
    let lo = start;
    while (lo > 0 && ctx.file.lines[lo].label?.scope !== "global") lo--;
    let hi = index;
    while (
      hi < ctx.file.lines.length - 1 &&
      ctx.file.lines[hi + 1].label?.scope !== "global"
    )
      hi++;
    const swapsCounter = anyBetween(ctx, lo, hi, (l) => {
      const op = operand(l, 0);
      return (
        semanticMnemonic(l) === "swap" &&
        op?.type === "data-register" &&
        op.register.toLowerCase() === register
      );
    });
    if (swapsCounter) return;

    const low = unsigned & 0xffff;
    const runs = low + 1;
    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence: "high",
      message: `${mnemonic.toUpperCase()} counts only the low word of ${register.toUpperCase()}, which holds ${hex(unsigned, 8)}: the loop runs ${runs} ${runs === 1 ? "time" : "times"}`,
      loc: line.mnemonic.loc,
      notes: [
        {
          message:
            "DBcc decrements the low 16 bits and ends the loop at $FFFF, ignoring the upper word. Counts of 65536 or more need a different loop, such as a SUBQ.L and BNE, or a nested pair of DBRAs.",
        },
      ],
      suggestion: {
        description: `Load a counter that fits in a word (${hex(unsigned & 0xffff, 4)} is what DBcc sees)`,
        applicability: "manual",
      },
    });
  },
};
