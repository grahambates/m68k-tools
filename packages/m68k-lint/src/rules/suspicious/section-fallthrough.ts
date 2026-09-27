import type { ParsedLine } from "m68k-parser";
import type { Rule } from "../../core/rule.js";
import { analyzeSections, type Section } from "../../analysis/sections.js";
import { analyzeLocalLabelScopes } from "../../analysis/local-label-scopes.js";
import { findUnreachableLines } from "../../analysis/reachability.js";
import { conditionalAssembly } from "../../analysis/conditionals.js";
import { scanBlocks } from "../../analysis/blocks.js";
import { getFlagSemantics } from "../../semantics/flags.js";
import { expansionOf } from "../../semantics/macro-expansions.js";
import { canonicalMnemonic } from "../../semantics/mnemonics.js";

/** Directives that put bytes in the current section. */
const EMITS = new Set(["dc", "ds", "dcb", "blk", "db", "dw", "dl", "incbin"]);

/** Whether a line puts code or data at this point in its section. */
function emits(line: ParsedLine): boolean {
  const mnemonic = line.mnemonic;
  if (mnemonic?.type === "instruction" || mnemonic?.type === "macro")
    return true;
  return (
    mnemonic?.type === "directive" &&
    EMITS.has(mnemonic.directive.toLowerCase())
  );
}

/**
 * Whether execution can continue past this line into whatever follows it.
 * Undefined where that cannot be known: a macro that cannot be seen into, or a
 * line made conditional by IIF.
 */
function fallsThrough(line: ParsedLine): boolean | undefined {
  if (line.inlineCondition !== undefined) return undefined;
  if (line.mnemonic?.type === "macro") {
    const expansion = expansionOf(line);
    const last = expansion?.[expansion.length - 1];
    return last ? fallsThrough(last) : undefined;
  }
  // ILLEGAL takes an exception and does not come back.
  if (canonicalMnemonic(line) === "illegal") return false;
  const flow = getFlagSemantics(line).controlFlow;
  return (
    flow === "fallthrough" || flow === "conditional-branch" || flow === "call"
  );
}

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
 */
export const sectionFallthrough: Rule = {
  meta: {
    id: "suspicious/section-fallthrough",
    category: "suspicious",
    defaultSeverity: "warning",
    description: "Flag code that can run off the end of a section",
    tags: ["sections", "control-flow"],
    docs: {
      note: "Reports the last instruction before a switch to another section when execution can continue past it: anything but a return, an unconditional branch or jump, or ILLEGAL. Where each section is placed is decided by the output format or linker, not the source order: an Amiga executable loads every section as a separate hunk, so execution runs into whatever memory follows it, and a TOS program puts all code sections before the data, so it runs into the next code section rather than what the source shows next. Either way the continuation is not visible in the source. Reopening the same section continues it, so that is not reported. A subroutine call that never returns, such as one to exit the program, looks the same as one that does and is reported. Silent where the section cannot be worked out, where the last line is a macro that cannot be seen into, and for code nothing can reach.",
    },
  },

  checkFile(ctx) {
    const sections = analyzeSections(ctx.file);
    const blocks = scanBlocks(ctx.file);
    const assembly = conditionalAssembly(ctx.file);
    const dead = new Set(
      findUnreachableLines(ctx.file, analyzeLocalLabelScopes(ctx.file)),
    );
    const lines = ctx.file.lines;
    const assembled = (index: number) =>
      blocks.region[index] === 0 && !assembly.unassembled[index];

    lines.forEach((line, index) => {
      if (!assembled(index) || dead.has(index)) return;
      const mnemonic = line.mnemonic?.type;
      if (mnemonic !== "instruction" && mnemonic !== "macro") return;
      const from = sections.at(index);
      if (!from) return;

      // The next thing assembled after this line, in whichever section.
      let next = index + 1;
      while (next < lines.length && !(assembled(next) && emits(lines[next])))
        next++;
      if (next >= lines.length) return;
      const to = sections.at(next);
      if (!to || to.key === from.key) return;
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
