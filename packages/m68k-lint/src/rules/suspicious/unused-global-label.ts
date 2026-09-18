import type { Rule } from "../../core/rule.js";
import { isInMacroDefinition, scanBlocks } from "../../analysis/blocks.js";

/**
 * Conventional entry-point names a linker can invoke without any source file
 * naming them. `_start` is the customary label a linker script or command-line
 * entry option points at; nothing in the project has to reference it for it to
 * be live.
 */
const CONVENTIONAL_ENTRY_POINTS = new Set(["_start"]);

/**
 * A global label that nothing in the project refers to.
 *
 * Off by default and only runs when a project-wide reference index is
 * available: "unused in the one file I can see" is not evidence for a global
 * label, which by definition can be called from anywhere in the project. An
 * XDEF or XREF needs no special handling here -- its operand is an ordinary
 * symbol reference, so an exported or imported name already counts as used.
 *
 * Even project-wide, a name with no reference the index can see may still be a
 * linker-specified entry point (`_start`, wired on the linker's own command
 * line rather than named in any source file) or a hardware vector table entry
 * placed by address rather than by name. Neither is visible to source
 * analysis, so this stays opt-in rather than reporting with confidence a
 * file-local rule can. `_start` specifically is common and conventional
 * enough to exempt outright rather than rely on every project remembering to
 * suppress it.
 *
 * A label defined inside a macro body is skipped for the same reason
 * `unused-local-label` skips one: it belongs to each expansion, not to the
 * file.
 */
export const unusedGlobalLabel: Rule = {
  meta: {
    id: "suspicious/unused-global-label",
    category: "suspicious",
    defaultSeverity: "warning",
    enabledByDefault: false,
    description: "Flag a global label that nothing in the project refers to",
    tags: ["dead-code", "labels"],
    docs: {
      note: "Off by default, and only checked when a project-wide reference index is available (the CLI's project scan, or an editor session with project symbols enabled). A label with no reference anywhere the index can see may still be a linker-specified entry point or a hardware vector table entry placed by address rather than by name, neither of which is visible to source analysis. `_start` is exempt outright as the conventional linker entry point name. Export any other genuine entry point with XDEF, or reference it from wherever it is actually wired in, to clear this once it fires.",
    },
  },

  checkFile(ctx) {
    const references = ctx.projectReferences;
    if (!references) return;
    const blocks = scanBlocks(ctx.file);

    ctx.file.lines.forEach((line, index) => {
      const label = line.label;
      if (!label || label.scope !== "global" || label.interpolated) return;
      if (isInMacroDefinition(blocks, index)) return;
      if (CONVENTIONAL_ENTRY_POINTS.has(label.label.toLowerCase())) return;
      if (references.references(label.label)) return;

      ctx.report({
        ruleId: this.meta.id,
        category: this.meta.category,
        severity: this.meta.defaultSeverity,
        confidence: "medium",
        message: `Global label '${label.label}' is not referenced anywhere in the project`,
        loc: label.loc,
        suggestion: {
          description:
            "Remove the unused label, or export it with XDEF if it is an entry point called from elsewhere",
          applicability: "manual",
        },
      });
    });
  },
};
