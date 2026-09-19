import type { Rule } from "../../core/rule.js";
import { FLAGS, getFlagSemantics } from "../../semantics/flags.js";
import { semanticMnemonic } from "../../semantics/mnemonics.js";
import { isOpaqueMacro } from "../../util/ast.js";

/** Instructions whose only effect is to set the condition codes. */
const COMPARISONS = new Set(["cmp", "cmpi", "cmpa", "cmpm", "tst", "btst"]);

/**
 * A comparison whose result nothing reads.
 *
 * Usually a branch that was never written, or was deleted in an edit. Only
 * reported when every flag the instruction sets is overwritten before anything
 * could read it, on every path. Flow into a call, a macro or a return leaves
 * the answer unknown, so `tst.l d0` before `rts`, which hands the flags to the
 * caller, is left alone.
 *
 * `tst` on memory is not reported: reading a hardware register or probing an
 * address for its side effect is a deliberate use of an instruction that
 * happens to set flags nobody wants.
 */
export const unusedComparison: Rule = {
  meta: {
    id: "suspicious/unused-comparison",
    category: "suspicious",
    defaultSeverity: "warning",
    description: "Flag a comparison whose condition codes are never used",
    tags: ["flags", "dead-code", "likely-typo"],
    docs: {
      note: "Reports CMP, CMPA, CMPI, CMPM, TST and BTST when every flag they set is overwritten before any branch, Scc or DBcc could read it. Not reported when the flags reach a call, macro or return, or for TST on memory, which is used deliberately to touch hardware.",
    },
  },

  checkLine(ctx, line, index) {
    if (line.mnemonic?.type !== "instruction") return;
    const mnemonic = semanticMnemonic(line);
    if (!mnemonic || !COMPARISONS.has(mnemonic)) return;

    if (
      mnemonic === "tst" &&
      line.operands?.some(
        (op) => op.type !== "data-register" && op.type !== "address-register",
      )
    )
      return;

    const written = FLAGS.filter((flag) =>
      getFlagSemantics(line).writes.has(flag),
    );
    if (written.length === 0) return;
    if (!written.every((flag) => ctx.flags.isLiveAfter(index, flag) === "dead"))
      return;

    // The flag analysis treats a macro it cannot expand as clobbering the
    // flags, but it may as easily branch on them. Any such macro reached before
    // the flags are overwritten makes the answer unknown.
    const { cfg } = ctx.registers;
    const seen = new Set<number>([index]);
    const pending = [...cfg.successors[index]];
    while (pending.length) {
      const at = pending.pop()!;
      if (seen.has(at)) continue;
      seen.add(at);
      const next = ctx.file.lines[at];
      if (isOpaqueMacro(next)) return;
      const effect = getFlagSemantics(next);
      const overwritten = written.every(
        (flag) => effect.writes.has(flag) || effect.undefined.has(flag),
      );
      if (!overwritten) for (const to of cfg.successors[at]) pending.push(to);
    }

    const name = line.mnemonic.instruction.toUpperCase();
    ctx.report({
      ruleId: this.meta.id,
      category: this.meta.category,
      severity: this.meta.defaultSeverity,
      confidence: "high",
      message: `${name} result is never used: the condition codes are overwritten before anything reads them`,
      loc: line.mnemonic.loc,
      notes: [
        {
          message:
            "Nothing between here and the next instruction that sets these flags branches on them or reads them. A conditional branch may be missing.",
        },
      ],
      suggestion: {
        description:
          "Add the branch that was meant to follow it, or remove the comparison",
        applicability: "manual",
      },
    });
  },
};
