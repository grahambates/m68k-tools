import type { Rule } from "../../core/rule.js";
import { isInMacroDefinition, scanBlocks } from "../../analysis/blocks.js";
import { analyzeLocalLabelScopes } from "../../analysis/local-label-scopes.js";

/**
 * A local label (`.loop`, `loop$`) that nothing in its routine refers to.
 *
 * Restricted to local scope on purpose: a global label with no in-file
 * reference may still be reached from another module, a vector table, or a
 * jump table this analysis cannot see, so flagging it would risk deleting a
 * real entry point. A local label cannot be referenced outside the global
 * label it belongs to, by construction, so "nothing in that scope names it"
 * is a sound proof that it is unused, not a guess.
 *
 * Matching is scoped to the nearest preceding global label, the way an
 * assembler resolves a local label, rather than by name alone: two routines
 * can each define their own `.loop`, and one being referenced must not hide
 * the other one's `.loop` going unused.
 *
 * A label defined inside a macro body is skipped entirely: it belongs to each
 * expansion rather than to the file, and an interpolated name (`.loop\@`)
 * describes a family of labels rather than one, so neither can be checked
 * without seeing every invocation.
 */
export const unusedLocalLabel: Rule = {
  meta: {
    id: "suspicious/unused-local-label",
    category: "suspicious",
    defaultSeverity: "warning",
    description: "Flag a local label that nothing in its routine refers to",
    tags: ["dead-code", "labels"],
    docs: {
      note: "Only local labels (a leading dot or trailing $) are checked, since their scope guarantees nothing outside the enclosing global label can reference them. A global label with no in-file reference is left alone: it may still be called from another module or a jump table. Matching follows the same scoping an assembler uses -- the nearest preceding global label -- so two routines may each have their own unused `.loop` without hiding one another.",
    },
  },

  checkFile(ctx) {
    const blocks = scanBlocks(ctx.file);
    const scopes = analyzeLocalLabelScopes(ctx.file);

    ctx.file.lines.forEach((line, index) => {
      const label = line.label;
      if (!label || label.scope !== "local" || label.interpolated) return;
      if (isInMacroDefinition(blocks, index)) return;
      if (scopes.referenced.has(scopes.keyOf(index, label.label))) return;

      const scope = scopes.scopeOf(index);
      ctx.report({
        ruleId: this.meta.id,
        category: this.meta.category,
        severity: this.meta.defaultSeverity,
        confidence: "high",
        message: scope
          ? `Local label '${label.label}' is never referenced within '${scope}'`
          : `Local label '${label.label}' is never referenced`,
        loc: label.loc,
        suggestion: {
          description: "Remove the unused label",
          applicability: "manual",
        },
      });
    });
  },
};
