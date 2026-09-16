import type { FixAnnotation } from "m68k-lint";
import {
  CodeActionKind,
  type CodeAction,
  type Range,
  type TextEdit,
} from "vscode-languageserver";
import type { TextDocument } from "vscode-languageserver-textdocument";
import {
  applyFixes,
  applyOnce,
  type Applicability,
  type Diagnostic,
  type OptimizationAssessment,
  type SourceSpan,
} from "m68k-lint";
import { formatImpact, spanRange } from "./diagnostics.js";

/**
 * Every measured outcome, for a fix the user asked for by name.
 *
 * `applyOnce` defaults to applying improvements alone, which is right for an
 * unattended `--fix` over a tree. A code action is not unattended: the user
 * opened the lightbulb on this diagnostic and picked this entry, and refusing
 * silently because the rewrite trades bytes for cycles just looks broken. The
 * trade-off is in the action's title instead, so the choice is informed.
 */
const ALL_ASSESSMENTS: OptimizationAssessment[] = [
  "improvement",
  "tradeoff",
  "neutral",
  "regression",
];

/** What `--fix` would take unattended, used for fix-all. */
const FIX_ALL_ASSESSMENTS: OptimizationAssessment[] = ["improvement"];

export function acceptedApplicabilities(conditional: boolean): Applicability[] {
  return conditional ? ["safe", "conditional"] : ["safe"];
}

/**
 * The replacement text for one diagnostic's span.
 *
 * Routed through `applyOnce` rather than splicing `suggestion.replacement`
 * directly so that eligibility and the annotate rewrite stay defined in one
 * place — the library's — and cannot drift from what `m68k-lint --fix` does.
 * Only the changed run is extracted, so the edit stays local and the client
 * keeps cursors and folds outside it.
 */
export function singleFixEdit(
  source: string,
  diagnostic: Diagnostic,
  accept: readonly Applicability[],
  annotate: FixAnnotation,
): { span: SourceSpan; newText: string } | undefined {
  const before = source.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const result = applyOnce(
    source,
    [diagnostic],
    accept,
    annotate,
    ALL_ASSESSMENTS,
  );
  const [applied] = result.applied;
  if (!applied) return undefined;

  const after = result.output.split("\n");
  const replacedCount = applied.endLine - applied.startLine + 1;
  const insertedCount = after.length - before.length + replacedCount;
  const lines = after.slice(
    applied.startLine - 1,
    applied.startLine - 1 + insertedCount,
  );
  // Removals leave no lines; the trailing newline goes with them.
  const newText = insertedCount === 0 ? "" : lines.join("\n") + "\n";
  return {
    span: { startLine: applied.startLine, endLine: applied.endLine },
    newText,
  };
}

function edit(
  document: TextDocument,
  range: Range,
  newText: string,
): CodeAction["edit"] {
  return {
    changes: { [document.uri]: [{ range, newText } satisfies TextEdit] },
  };
}

function fixTitle(diagnostic: Diagnostic): string {
  const description = diagnostic.suggestion?.description ?? "Apply suggestion";
  const impact = formatImpact(diagnostic.suggestion?.impact);
  const conditional = diagnostic.suggestion?.applicability === "conditional";
  const tail = [
    impact,
    conditional
      ? "conditional — check the notes"
      : diagnostic.suggestion?.applicability === "manual"
        ? "manual review — check the notes"
        : undefined,
  ]
    .filter(Boolean)
    .join(", ");
  return tail ? `${description} (${tail})` : description;
}

export interface ActionOptions {
  conditional: boolean;
  annotate: FixAnnotation;
  /**
   * Re-lints intermediate text for fix-all, with the config and project
   * symbols that apply to this document.
   *
   * Passed in rather than reached for: two code-action requests for different
   * documents can be in flight at once, and a linter held in module state
   * would have whichever config arrived last.
   */
  lint: (source: string) => Diagnostic[];
}

/** Quick fixes and suppressions for the diagnostics overlapping `range`. */
export function codeActionsFor(
  document: TextDocument,
  source: string,
  diagnostics: readonly Diagnostic[],
  selected: readonly Diagnostic[],
  options: ActionOptions,
): CodeAction[] {
  const actions: CodeAction[] = [];
  const accept: Applicability[] = ["safe", "conditional", "manual"];

  for (const diagnostic of selected) {
    for (const choice of [
      { ...diagnostic, alternatives: undefined },
      ...(diagnostic.alternatives ?? []),
    ]) {
      if (choice.suggestion?.replacement !== undefined && choice.span) {
        const fix = singleFixEdit(source, choice, accept, options.annotate);
        if (fix) {
          actions.push({
            title: fixTitle(choice),
            kind: CodeActionKind.QuickFix,
            diagnostics: [],
            isPreferred:
              !diagnostic.alternatives?.length &&
              choice.suggestion.applicability === "safe",
            edit: edit(document, spanRange(fix.span, document), fix.newText),
          });
        }
      }

      actions.push(disableOnLine(document, choice));
      actions.push(disableInFile(document, choice));
    }
  }

  if (
    diagnostics.some(
      (diagnostic) => diagnostic.suggestion?.replacement !== undefined,
    )
  ) {
    const all = fixAll(document, source, options);
    if (all) actions.push(all);
  }

  return actions;
}

/**
 * Runs the same lint-apply-repeat loop as `m68k-lint --fix`, so a document
 * fixed here matches one fixed at the command line. Restricted to improvements:
 * this action fires from "fix all" and on save, where nothing is reviewing each
 * trade-off individually.
 */
export function fixAll(
  document: TextDocument,
  source: string,
  options: ActionOptions,
): CodeAction | undefined {
  const accept = acceptedApplicabilities(options.conditional);
  const result = applyFixes(source, (text) => options.lint(text), {
    accept,
    acceptAssessments: FIX_ALL_ASSESSMENTS,
    annotate: options.annotate,
  });
  if (result.output === source || !result.applied.length) return undefined;

  const whole: Range = {
    start: { line: 0, character: 0 },
    end: document.positionAt(source.length),
  };
  return {
    title: `Fix all auto-fixable m68k-lint findings (${result.applied.length})`,
    kind: CodeActionKind.SourceFixAll,
    diagnostics: [],
    edit: edit(document, whole, result.output),
  };
}

function indentOf(line: string): string {
  return /^[ \t]*/.exec(line)?.[0] ?? "";
}

function lineText(document: TextDocument, line: number): string {
  return document.getText({
    start: { line, character: 0 },
    end: { line, character: Number.MAX_SAFE_INTEGER },
  });
}

function disableOnLine(
  document: TextDocument,
  diagnostic: Diagnostic,
): CodeAction {
  const line = (diagnostic.span?.startLine ?? diagnostic.loc.line ?? 1) - 1;
  const indent = indentOf(lineText(document, line));
  return {
    title: `Disable ${diagnostic.ruleId} for this line`,
    kind: CodeActionKind.QuickFix,
    diagnostics: [],
    edit: edit(
      document,
      { start: { line, character: 0 }, end: { line, character: 0 } },
      `${indent}; m68k-lint-disable-next-line ${diagnostic.ruleId}\n`,
    ),
  };
}

function disableInFile(
  document: TextDocument,
  diagnostic: Diagnostic,
): CodeAction {
  return {
    title: `Disable ${diagnostic.ruleId} for this file`,
    kind: CodeActionKind.QuickFix,
    diagnostics: [],
    edit: edit(
      document,
      { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
      `; m68k-lint-disable ${diagnostic.ruleId}\n`,
    ),
  };
}
