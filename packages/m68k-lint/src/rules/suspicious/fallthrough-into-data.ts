import type { ParsedLine } from "m68k-parser";
import type { Rule } from "../../core/rule.js";
import { analyzeLocalLabelScopes } from "../../analysis/local-label-scopes.js";
import { findUnreachableLines } from "../../analysis/reachability.js";
import {
  emittedLines,
  endsWithCall,
  fallsThrough,
  isData,
} from "../../analysis/fallthrough.js";
import { movesSection } from "../../analysis/sections.js";

/**
 * Whether data could be instructions written out by hand: word or long values,
 * which is how an opcode the assembler does not support, or one patched at run
 * time, is put in the code.
 */
function couldBeCode(line: ParsedLine): boolean {
  const directive =
    line.mnemonic?.type === "directive"
      ? line.mnemonic.directive.toLowerCase()
      : "";
  if (directive === "dw" || directive === "dl") return true;
  if (directive !== "dc" && directive !== "dcb") return false;
  const size = line.qualifier?.type === "size" ? line.qualifier.size : "w";
  return size === "w" || size === "l";
}

/**
 * Code that runs on into data in the same section executes the data as
 * instructions. Usually a missing RTS or branch at the end of a routine.
 *
 * Sometimes deliberate: an instruction the assembler does not know, written as
 * `dc.w`, or self-modifying code whose instruction words are patched at run
 * time. Those are word or long data, so falling into it is reported with low
 * confidence; falling into bytes, strings, reserved space or included binary is
 * almost never meant.
 *
 * A subroutine call followed by data is not reported: `bsr Print` then
 * `dc.b "text",0` is the inline-argument idiom, where the routine reads the
 * data through its return address and returns past it.
 */
export const fallthroughIntoData: Rule = {
  meta: {
    id: "suspicious/fallthrough-into-data",
    category: "suspicious",
    defaultSeverity: "warning",
    description: "Flag code that can run on into data in the same section",
    tags: ["control-flow", "data"],
    docs: {
      note: "Reports an instruction followed directly by DC, DS, DCB or INCBIN data when execution can continue past it, so the data would be executed as instructions. Falling into word or long data is reported with low confidence, since that is how hand-assembled or self-modifying instructions are written; disable the rule on the line when it is deliberate. A subroutine call followed by data is not reported, as that is the inline-argument idiom. Silent after a TRAP, a line made conditional by IIF, a macro that cannot be seen into, and for code nothing can reach.",
    },
  },

  checkFile(ctx) {
    const emitted = emittedLines(ctx.file);
    const dead = new Set(
      findUnreachableLines(ctx.file, analyzeLocalLabelScopes(ctx.file)),
    );
    const lines = ctx.file.lines;

    lines.forEach((line, index) => {
      if (!emitted.assembled(index) || dead.has(index)) return;
      const mnemonic = line.mnemonic?.type;
      if (mnemonic !== "instruction" && mnemonic !== "macro") return;

      const next = emitted.nextAfter(index);
      if (next === undefined || !isData(lines[next])) return;
      // Data somewhere else is the section rule's to report.
      for (let i = index + 1; i < next; i++)
        if (emitted.assembled(i) && movesSection(lines[i])) return;
      if (fallsThrough(line) !== true || endsWithCall(line)) return;

      const data = lines[next];
      const label = lines
        .slice(index + 1, next + 1)
        .map((l) => l.label?.label)
        .filter((name): name is string => name !== undefined)
        .at(-1);
      const word = couldBeCode(data);
      const what = label ? `the data at ${label}` : "the data that follows";

      ctx.report({
        ruleId: this.meta.id,
        category: this.meta.category,
        severity: this.meta.defaultSeverity,
        confidence: word ? "low" : "high",
        message: `Execution can run on into ${what}`,
        loc: line.mnemonic!.loc,
        notes: [
          {
            message: `Nothing ends the code before line ${data.lineNumber ?? next + 1}, so the processor would execute ${what} as instructions.`,
            loc: data.mnemonic?.loc,
          },
          ...(word
            ? [
                {
                  message:
                    "Word or long data may be instructions written by hand, such as an opcode the assembler does not support or one patched at run time. If so, this is deliberate: disable the rule for this line with `; m68k-lint-disable-line suspicious/fallthrough-into-data`.",
                },
              ]
            : []),
        ],
        suggestion: {
          description: "End the code with RTS, BRA or JMP before the data",
          applicability: "manual",
        },
      });
    });
  },
};
