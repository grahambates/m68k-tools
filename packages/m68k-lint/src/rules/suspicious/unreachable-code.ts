import type { Rule } from "../../core/rule.js";
import { analyzeLocalLabelScopes } from "../../analysis/local-label-scopes.js";
import { findUnreachableLines } from "../../analysis/reachability.js";
import { isExecutableLine } from "../../util/ast.js";

/**
 * Code that nothing branches to and nothing falls into.
 *
 * Usually left behind by an edit: an `rts` or `bra` inserted above code that
 * used to run, or a label's last caller removed. What counts as reachable is
 * deliberately generous (see `findUnreachableLines`), so this stays quiet about
 * anything a jump table, another file or a macro could be entering.
 */
export const unreachableCode: Rule = {
  meta: {
    id: "suspicious/unreachable-code",
    category: "suspicious",
    defaultSeverity: "warning",
    description: "Flag instructions that nothing can branch to or fall into",
    tags: ["dead-code", "control-flow"],
    docs: {
      note: "Reports the first instruction of a run that follows a branch, jump or return with nothing pointing at it. Never reported: anything under a global label (it may be called from elsewhere), a local label that is referenced, code straight after a computed jump such as `jmp table(pc,d0.w)` (an inline jump table), or code following a macro invocation.",
    },
  },

  checkFile(ctx) {
    const scopes = analyzeLocalLabelScopes(ctx.file);
    const dead = new Set(findUnreachableLines(ctx.file, scopes));
    if (!dead.size) return;

    const lines = ctx.file.lines;
    const executable = lines
      .map((line, index) => (isExecutableLine(line) ? index : -1))
      .filter((index) => index >= 0);

    executable.forEach((index, position) => {
      const before = executable[position - 1];
      if (!dead.has(index) || (before !== undefined && dead.has(before)))
        return;

      let count = 0;
      for (let next = position; dead.has(executable[next]); next++) count++;

      const previous = before === undefined ? undefined : lines[before];
      ctx.report({
        ruleId: this.meta.id,
        category: this.meta.category,
        severity: this.meta.defaultSeverity,
        confidence: "high",
        message:
          count === 1
            ? "Unreachable code: nothing branches to or falls into this instruction"
            : `Unreachable code: nothing branches to or falls into these ${count} instructions`,
        loc: lines[index].mnemonic!.loc,
        notes: previous?.mnemonic
          ? [
              {
                message: `Follows \`${ctx.sourceLine(before)?.trim() ?? previous.mnemonic.type}\` on line ${previous.lineNumber ?? before + 1}, after which control does not continue here.`,
              },
            ]
          : undefined,
        suggestion: {
          description: "Remove the unreachable code",
          applicability: "manual",
        },
      });
    });
  },
};
