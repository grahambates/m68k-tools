import type { ParsedLine } from "m68k-parser";
import { findLoops } from "../../analysis/loops.js";
import type { Rule } from "../../core/rule.js";
import { getFlagSemantics } from "../../semantics/flags.js";
import { semanticMnemonic } from "../../semantics/mnemonics.js";
import { getRegisterSemantics } from "../../semantics/registers.js";
import { isMacroInvocation, isOpaqueMacro } from "../../util/ast.js";

/** An operand that names no memory: what a register-only test is made of. */
function touchesOnlyRegisters(line: ParsedLine): boolean {
  return (line.operands ?? []).every(
    (op) =>
      op.type === "data-register" ||
      op.type === "address-register" ||
      op.type === "immediate",
  );
}

/**
 * A loop whose way out is decided by something the loop never changes.
 *
 * Every exit is a conditional branch, and each condition comes from
 * instructions that read only registers which nothing inside the loop writes.
 * Those inputs cannot differ from one pass to the next, so the loop leaves on
 * its first pass or not at all. Usually a counter update was left out, or
 * moved outside.
 *
 * Deliberately narrow. A loop with no exit at all is not reported, because
 * `bra.s *` and an idle main loop woken by interrupts are the normal way to
 * finish. Anything that could change the outcome from outside is treated as
 * a reason to stay quiet: a memory operand in the test (another task, an
 * interrupt or the hardware may write it), a call, a trap or a macro in the
 * loop, and any exit that is not a plain conditional branch.
 */
export const infiniteLoop: Rule = {
  meta: {
    id: "suspicious/infinite-loop",
    category: "suspicious",
    defaultSeverity: "warning",
    description:
      "Flag a loop whose exit condition depends on nothing the loop changes",
    tags: ["control-flow", "loop"],
    docs: {
      note: "Reports a loop whose every exit is a conditional branch on a register-only test, where nothing in the loop writes those registers. Never reported: loops with no exit (deliberate halts and interrupt-driven idle loops), tests that read memory, and loops containing calls, traps, macros or DBcc.",
    },
  },

  checkFile(ctx) {
    const { cfg } = ctx.registers;

    for (const loop of findLoops(cfg)) {
      if (loop.exits.length === 0) continue;
      if (loop.members.some((i) => cfg.escapes[i])) continue;

      // Everything the loop writes, and bail on anything opaque.
      const written = new Set<string>();
      let opaque = false;
      for (const i of loop.members) {
        const line = ctx.file.lines[i];
        const mnemonic = semanticMnemonic(line) ?? "";
        const semantics = getRegisterSemantics(line);
        const control = getFlagSemantics(line).controlFlow;
        if (
          isOpaqueMacro(line) ||
          semantics.unknownEffects ||
          semantics.call ||
          control === "call" ||
          control === "dynamic-jump" ||
          mnemonic.startsWith("db") ||
          mnemonic.startsWith("trap") ||
          mnemonic === "illegal"
        ) {
          opaque = true;
          break;
        }
        for (const r of semantics.writes) written.add(r);
        for (const r of semantics.partialWrites) written.add(r);
      }
      if (opaque) continue;

      const inputs = new Set<string>();
      let decidable = true;
      const exitLines = [...new Set(loop.exits.map((e) => e.from))];
      const members = new Set(loop.members);

      for (const from of exitLines) {
        const branch = ctx.file.lines[from];
        if (getFlagSemantics(branch).controlFlow !== "conditional-branch") {
          decidable = false;
          break;
        }
        for (const flag of getFlagSemantics(branch).reads) {
          for (const def of ctx.flags.reachingDefinitionsBefore(from, flag)) {
            if (def.kind !== "instruction") {
              decidable = false;
              break;
            }
            // Set before the loop, so it is the same every pass.
            if (!members.has(def.index)) continue;

            const producer = ctx.file.lines[def.index];
            if (
              isMacroInvocation(producer) ||
              !touchesOnlyRegisters(producer) ||
              getFlagSemantics(producer).reads.size > 0
            ) {
              decidable = false;
              break;
            }
            for (const r of getRegisterSemantics(producer).reads) {
              if (written.has(r)) {
                decidable = false;
                break;
              }
              inputs.add(r);
            }
            if (!decidable) break;
          }
          if (!decidable) break;
        }
        if (!decidable) break;
      }
      if (!decidable) continue;

      const first = exitLines[0];
      const branch = ctx.file.lines[first];
      if (!branch.mnemonic) continue;
      const names = [...inputs].sort().map((r) => r.toUpperCase());
      ctx.report({
        ruleId: this.meta.id,
        category: this.meta.category,
        severity: this.meta.defaultSeverity,
        confidence: "medium",
        message:
          names.length === 0
            ? "Nothing in this loop changes its exit condition, so it either exits on the first pass or never"
            : `Nothing in this loop changes ${names.join(", ")}, which its exit condition depends on, so it either exits on the first pass or never`,
        loc: branch.mnemonic.loc,
        notes: [
          {
            message:
              "Every way out of the loop is a conditional branch on registers the loop never writes. Look for a missing counter update, or for one that was moved outside the loop.",
          },
        ],
        suggestion: {
          description:
            "Update the value the exit test depends on inside the loop",
          applicability: "manual",
        },
      });
    }
  },
};
