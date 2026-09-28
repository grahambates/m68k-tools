import type { Rule } from "../../core/rule.js";
import {
  FLAGS,
  flagsReadByCondition,
  getFlagSemantics,
} from "../../semantics/flags.js";
import type { RuleContext } from "../../core/context.js";
import type { DiagnosticNote } from "../../core/diagnostic.js";
import { semanticMnemonic } from "../../semantics/mnemonics.js";
import { isOpaqueMacro } from "../../util/ast.js";

/** Comparison/test instructions; memory operands may also have side effects. */
const COMPARISONS = new Set(["cmp", "cmpi", "cmpa", "cmpm", "tst", "btst"]);

/** Explain a nearby conditional use only when its flag sources are unambiguous. */
function overwrittenCondition(ctx: RuleContext, index: number) {
  const { cfg } = ctx.flags;
  const seen = new Set([index]);
  let at = index;
  while (!cfg.escapes[at] && cfg.successors[at].size === 1) {
    at = [...cfg.successors[at]][0];
    if (seen.has(at) || cfg.predecessors[at].size !== 1) return;
    seen.add(at);
    const line = ctx.line(at);
    if (!line || line.mnemonic?.type !== "instruction") return;
    const name = semanticMnemonic(line)!;
    const effect = getFlagSemantics(line);
    // A second explicit comparison is a plausible intentional replacement.
    if (COMPARISONS.has(name) || effect.controlFlow === "call") return;
    const read = [...flagsReadByCondition(name)];
    if (read.length === 0) continue;
    const notes: DiagnosticNote[] = [];
    const sources = new Map<number, string[]>();
    for (const flag of read) {
      const defs = ctx.flags.reachingDefinitionsBefore(at, flag);
      if (defs.length !== 1 || defs[0].kind !== "instruction") return;
      const writer = defs[0].index;
      if (writer === index || !seen.has(writer)) return;
      const flags = sources.get(writer) ?? [];
      flags.push(flag);
      sources.set(writer, flags);
    }
    for (const [writer, flags] of sources) {
      const instruction = ctx.line(writer)!.mnemonic!;
      notes.push({
        message: `${semanticMnemonic(ctx.line(writer)!)!.toUpperCase()} on line ${instruction.loc.line} overwrites ${flags.join("/")}, which ${name.toUpperCase()} reads.`,
        loc: instruction.loc,
      });
    }
    notes.push({
      message: `${name.toUpperCase()} on line ${line.mnemonic.loc.line} tests these replacement flags, not the earlier comparison/test result.`,
      loc: line.mnemonic.loc,
    });
    return { name: name.toUpperCase(), line: line.mnemonic.loc.line, notes };
  }
}

/**
 * A comparison whose result nothing reads.
 *
 * Usually a branch that was never written, or was deleted in an edit. Only
 * reported when every flag the instruction sets is overwritten before anything
 * could read it, on every path. Flow into a call, a macro or a return leaves
 * the answer unknown, so `tst.l d0` before `rts`, which hands the flags to the
 * caller, is left alone.
 *
 * Without an identifiable overwritten conditional use, `tst` on memory is not
 * reported: reading hardware or probing an address can be deliberate even
 * when nobody wants the resulting flags.
 */
export const unusedComparison: Rule = {
  meta: {
    id: "suspicious/unused-comparison",
    category: "suspicious",
    defaultSeverity: "warning",
    description: "Flag a comparison whose condition codes are never used",
    tags: ["flags", "dead-code", "likely-typo"],
    docs: {
      note: "Reports CMP, CMPA, CMPI, CMPM, TST and BTST when every flag they set is overwritten before any branch, Scc or DBcc could read it. Not reported when the flags reach a call, macro or return, or for TST on memory unless a subsequent conditional use clearly reads replacement flags. Nearby unambiguous Bcc/Scc/DBcc uses identify the overwriting instructions and the flags they replace.",
    },
  },

  checkLine(ctx, line, index) {
    if (line.mnemonic?.type !== "instruction") return;
    const mnemonic = semanticMnemonic(line);
    if (!mnemonic || !COMPARISONS.has(mnemonic)) return;

    const written = FLAGS.filter((flag) =>
      getFlagSemantics(line).writes.has(flag),
    );
    if (written.length === 0) return;
    if (!written.every((flag) => ctx.flags.isLiveAfter(index, flag) === "dead"))
      return;

    const condition = overwrittenCondition(ctx, index);
    if (
      !condition &&
      mnemonic === "tst" &&
      line.operands?.some(
        (op) => op.type !== "data-register" && op.type !== "address-register",
      )
    )
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
      message: condition
        ? `${name} result is never used: its condition codes are overwritten before ${condition.name} on line ${condition.line}`
        : `${name} result is never used: the condition codes are overwritten before anything reads them`,
      loc: line.mnemonic.loc,
      notes: condition?.notes ?? [
        {
          message:
            "Nothing between here and the next instruction that sets these flags branches on them or reads them. A conditional branch may be missing.",
        },
      ],
      suggestion: {
        description: condition
          ? "Review the instruction order so the conditional instruction reads the intended comparison/test flags"
          : "Add the intended conditional use, or remove the comparison/test if its memory access and address-register side effects are not needed",
        applicability: "manual",
      },
    });
  },
};
