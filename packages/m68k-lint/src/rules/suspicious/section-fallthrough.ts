import type { Rule } from "../../core/rule.js";
import {
  analyzeSections,
  movesSection,
  type Section,
} from "../../analysis/sections.js";
import { analyzeLocalLabelScopes } from "../../analysis/local-label-scopes.js";
import { findUnreachableLines } from "../../analysis/reachability.js";
import { emittedLines, fallsThrough } from "../../analysis/fallthrough.js";

function describe(section: Section): string {
  return section.label === section.kind
    ? `the ${section.kind} section`
    : `section ${section.label}`;
}

/**
 * Where a section ends up is for the output format or linker to decide, not
 * the source order, so the code after a section's last instruction is not what
 * the source shows next. An Amiga executable loads each section as a separate
 * hunk, so running off the end executes whatever is in memory past it. A TOS
 * program gathers every code section ahead of the data, so it runs into the
 * next code section, skipping any data written between them. Whatever it
 * reaches, it is not visibly intended.
 *
 * The end of the file is the end of its last section, but only for a file that
 * is assembled on its own: one that is included continues in the file that
 * includes it. So it is reported only when the caller has established, from the
 * project, that nothing includes this file.
 */
export const sectionFallthrough: Rule = {
  meta: {
    id: "suspicious/section-fallthrough",
    category: "suspicious",
    defaultSeverity: "warning",
    description: "Flag code that can run off the end of a section",
    tags: ["sections", "control-flow"],
    docs: {
      note: "Reports the last instruction before a switch to another section when execution can continue past it: anything but a return, an unconditional branch or jump, or ILLEGAL. Where each section is placed is decided by the output format or linker, not the source order: an Amiga executable loads every section as a separate hunk, so execution runs into whatever memory follows it, and a TOS program puts all code sections before the data, so it runs into the next code section rather than what the source shows next. Either way the continuation is not visible in the source. Reopening the same section continues it, so that is not reported. The end of the file is reported too, but only where a project index shows that no other file includes this one, since an included file continues in its includer. A subroutine call that never returns, such as one to exit the program, looks the same as one that does and is reported. Silent where the section cannot be worked out, after a TRAP (which may be how the program exits), where the last line is a macro that cannot be seen into, and for code nothing can reach.",
    },
  },

  checkFile(ctx) {
    const sections = analyzeSections(ctx.file);
    const emitted = emittedLines(ctx.file);
    const dead = new Set(
      findUnreachableLines(ctx.file, analyzeLocalLabelScopes(ctx.file)),
    );
    const standalone = ctx.facts?.includedByProject === false;

    ctx.file.lines.forEach((line, index) => {
      if (!emitted.assembled(index) || dead.has(index)) return;
      const mnemonic = line.mnemonic?.type;
      if (mnemonic !== "instruction" && mnemonic !== "macro") return;
      const next = emitted.nextAfter(index);

      if (next === undefined) {
        if (!standalone || fallsThrough(line) !== true) return;
        // An INCLUDE after the last instruction is where the code carries on.
        if (
          ctx.file.lines
            .slice(index + 1)
            .some(
              (later, offset) =>
                emitted.assembled(index + 1 + offset) && movesSection(later),
            )
        )
          return;
        ctx.report({
          ruleId: this.meta.id,
          category: this.meta.category,
          severity: this.meta.defaultSeverity,
          confidence: "high",
          message: "Execution can run off the end of the file",
          loc: line.mnemonic!.loc,
          notes: [
            {
              message:
                "Nothing follows this instruction, and no file in the project includes this one, so after it the processor runs whatever is in memory past the end of the program.",
            },
          ],
          suggestion: {
            description: "End the code with RTS, BRA or JMP",
            applicability: "manual",
          },
        });
        return;
      }

      const from = sections.at(index);
      const to = sections.at(next);
      if (!from || !to || to.key === from.key) return;
      if (fallsThrough(line) !== true) return;

      ctx.report({
        ruleId: this.meta.id,
        category: this.meta.category,
        severity: this.meta.defaultSeverity,
        confidence: "high",
        message: `Execution can run off the end of ${describe(from)}`,
        loc: line.mnemonic!.loc,
        notes: [
          {
            message: `The next line assembled is in ${describe(to)}. Where sections are placed is decided by the output format or linker, not the source order, so this does not continue there. In an Amiga executable each section is a separate hunk, and execution runs into whatever memory follows it.`,
          },
        ],
        suggestion: {
          description:
            "End the section with RTS, BRA or JMP, or continue the code in the same section",
          applicability: "manual",
        },
      });
    });
  },
};
