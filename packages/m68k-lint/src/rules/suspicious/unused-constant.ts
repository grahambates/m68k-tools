import type { Rule } from "../../core/rule.js";

/**
 * A constant (`equ`, `=`) that nothing in the project refers to.
 *
 * Off by default and only runs when a project-wide reference index is
 * available, for the same reason `unused-global-label` is: a constant has no
 * scope of its own the way a local label does, so "unused in the one file I
 * can see" is no evidence at all -- a hardware equates header is written
 * expecting most of its own file to be unreferenced there and used from
 * everywhere else in the project. XDEF and XREF need no special handling:
 * their operands are ordinary symbol references, so an exported or imported
 * name already counts as used.
 *
 * A constant used only to define another constant still counts as used, even
 * if that other constant turns out to be unused itself: `BASE equ 40` /
 * `OFFSET equ BASE+2` reports `OFFSET`, not `BASE`, if nothing else reads
 * either of them. Chasing that further into a real dead-chain analysis is
 * more than this rule attempts.
 *
 * Even project-wide, a name with no reference the index can see may still be
 * part of a header kept for documentation or future use, or consumed by a
 * build step this analysis does not see. That residual risk is exactly why
 * this stays opt-in.
 *
 * A constant defined inside a macro body, or one the project defines
 * inconsistently, never reaches here: `ctx.symbols.entries()` already leaves
 * both out, for the same reasons `DefaultSymbolTable` does everywhere else.
 */
export const unusedConstant: Rule = {
  meta: {
    id: "suspicious/unused-constant",
    category: "suspicious",
    defaultSeverity: "warning",
    enabledByDefault: false,
    description: "Flag a constant that nothing in the project refers to",
    tags: ["dead-code", "constants"],
    docs: {
      note: "Off by default, and only checked when a project-wide reference index is available (the CLI's project scan, or an editor session with project symbols enabled). A constant with no reference anywhere the index can see may still be part of a header kept for documentation or future use, or consumed by a build step outside source analysis. Export it with XDEF, or reference it from wherever it is actually used, to clear this once it fires.",
    },
  },

  checkFile(ctx) {
    const references = ctx.projectReferences;
    if (!references) return;

    for (const constant of ctx.symbols.entries()) {
      if (references.references(constant.name)) continue;
      const loc = constant.line.label?.loc;
      if (!loc) continue;

      ctx.report({
        ruleId: this.meta.id,
        category: this.meta.category,
        severity: this.meta.defaultSeverity,
        confidence: "medium",
        message: `Constant '${constant.name}' is not referenced anywhere in the project`,
        loc,
        suggestion: {
          description: "Remove the unused constant",
          applicability: "manual",
        },
      });
    }
  },
};
