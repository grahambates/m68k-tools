import type { Rule } from "../../core/rule.js";
import { scanBlocks } from "../../analysis/blocks.js";

/**
 * A macro that nothing in the project invokes.
 *
 * Off by default and only runs when a project-wide reference index is
 * available, for the same reason `unused-global-label` is: a macro is
 * commonly defined in an include file for every source file to draw on, so
 * "never invoked in the one file I can see" says nothing. A macro library is
 * written expecting most of it to go unused by any one project.
 *
 * Both definition forms count, `NAME: MACRO` and `MACRO NAME`. Invocation is
 * matched by name alone and without regard to case, since assemblers differ on
 * that and a call spelled differently is still a call.
 *
 * A macro invoked only from the body of another macro counts as used, even if
 * that macro is itself unused: chasing the chain is more than this attempts.
 */
export const unusedMacro: Rule = {
  meta: {
    id: "suspicious/unused-macro",
    category: "suspicious",
    defaultSeverity: "warning",
    enabledByDefault: false,
    description: "Flag a macro that nothing in the project invokes",
    tags: ["dead-code", "macros"],
    docs: {
      note: "Off by default, and only checked when a project-wide reference index is available (the CLI's project scan, or an editor session with project symbols enabled). A macro never invoked anywhere the index can see may still belong to a library kept for other projects, or be invoked through a name assembled by another macro, which is not visible to source analysis. Sections are not covered: nothing refers to a section by name, so there is no reference to look for.",
    },
  },

  checkFile(ctx) {
    const references = ctx.projectReferences;
    if (!references) return;
    const blocks = scanBlocks(ctx.file);

    ctx.file.lines.forEach((line, index) => {
      if (line.mnemonic?.type !== "directive") return;
      if (line.mnemonic.directive.toLowerCase() !== "macro") return;
      // The header opens its own region. One nested in another macro's body
      // continues that region, and only exists once that macro runs.
      const region = blocks.region[index];
      if (region === 0 || blocks.region[index - 1] === region) return;

      const first = line.operands?.[0];
      const named =
        first?.type === "value" && first.value.type === "symbol"
          ? { name: first.value.name, loc: first.value.loc }
          : undefined;
      const defined = line.label
        ? { name: line.label.label, loc: line.label.loc }
        : named;
      if (!defined || line.label?.interpolated) return;
      if (references.invokes(defined.name)) return;

      ctx.report({
        ruleId: this.meta.id,
        category: this.meta.category,
        severity: this.meta.defaultSeverity,
        confidence: "medium",
        message: `Macro '${defined.name}' is not invoked anywhere in the project`,
        loc: defined.loc,
        suggestion: {
          description: "Remove the unused macro",
          applicability: "manual",
        },
      });
    });
  },
};
