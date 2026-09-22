import {
  DiagnosticSeverity,
  type Diagnostic as LspDiagnostic,
  type Range,
} from "vscode-languageserver";
import type { TextDocument } from "vscode-languageserver-textdocument";
import type {
  Diagnostic,
  DiagnosticNote,
  OptimizationImpact,
  Severity,
  SourceSpan,
} from "m68k-lint";

export const DIAGNOSTIC_SOURCE = "m68k-lint";

const RULES_DOC =
  "https://github.com/grahambates/m68k-lint/blob/main/docs/rules.md";

/**
 * `suggestion` lands on Information rather than Hint deliberately. Hint renders
 * as three faint dots in VS Code and is invisible in most other clients, which
 * is the wrong home for the optimization findings that are the point of this
 * linter. Hint is left for `info`, which is genuinely incidental.
 */
const SEVERITIES: Record<Severity, DiagnosticSeverity> = {
  error: DiagnosticSeverity.Error,
  warning: DiagnosticSeverity.Warning,
  suggestion: DiagnosticSeverity.Information,
  info: DiagnosticSeverity.Hint,
};

/** Use the rule display extent, falling back to its precise diagnostic location. */
export function diagnosticRange(
  diagnostic: Diagnostic,
  document: TextDocument,
): Range {
  const from = diagnostic.highlight?.start ?? diagnostic.loc;
  const to = diagnostic.highlight?.end ?? diagnostic.loc;
  const line = (from.line ?? 1) - 1;
  const start = { line, character: from.start };
  const end = {
    line: (to.line ?? from.line ?? 1) - 1,
    character: to.end,
  };
  // Clamp through the document so a stale or out-of-range loc cannot produce a
  // range the client will reject.
  return {
    start: document.positionAt(document.offsetAt(start)),
    end: document.positionAt(document.offsetAt(end)),
  };
}

/** The full extent a fix would replace, as a range. */
export function spanRange(span: SourceSpan, document: TextDocument): Range {
  const startLine = span.startLine - 1;
  const endLine = span.endLine - 1;
  return {
    start: { line: startLine, character: 0 },
    end: document.positionAt(
      document.offsetAt({ line: endLine + 1, character: 0 }),
    ),
  };
}

/** Savings in CPU(read,write) notation, matching the CLI; negative means a cost. */
export function formatImpact(
  impact: OptimizationImpact | undefined,
): string | undefined {
  if (!impact) return undefined;
  const saving = (delta: number | undefined): string =>
    delta === undefined ? "?" : `${-delta}`;
  const parts: string[] = [];
  if (impact.sizeBytes) parts.push(`${saving(impact.sizeBytes.delta)} bytes`);
  const execution = impact.execution;
  if (
    execution &&
    (execution.cpuCycles || execution.readCycles || execution.writeCycles)
  ) {
    parts.push(
      `${saving(execution.cpuCycles?.delta)}(${saving(execution.readCycles?.delta)},${saving(execution.writeCycles?.delta)}) cycles`,
    );
  }
  return parts.length ? `saves: ${parts.join(", ")}` : undefined;
}

/**
 * relatedInformation for several choices on one diagnostic, each shown as its
 * own numbered block -- a client cannot nest one choice's notes under its
 * heading, so the numbering is what keeps a flat list readable as separate
 * options rather than one run-on list.
 *
 * A caveat worded identically in every choice (typically one that does not
 * depend on which one was picked, such as whether a register's old value is
 * provably unused) is said once up front instead of once per choice, the same
 * way the CLI already collapses a cost figure shared across every choice.
 * Only an unlocated note is eligible: one that points elsewhere in the file
 * is kept with the choice it belongs to.
 */
function notesForChoices(
  primary: Diagnostic,
  alternatives: readonly Diagnostic[],
): DiagnosticNote[] {
  const choices = [primary, ...alternatives];
  const shared = (primary.notes ?? []).filter(
    (note) =>
      !note.loc &&
      choices.every((choice) =>
        (choice.notes ?? []).some(
          (other) => !other.loc && other.message === note.message,
        ),
      ),
  );
  return [
    ...shared,
    ...choices.flatMap((choice, index) => [
      {
        message: `Option ${index + 1} of ${choices.length} -- ${choice.suggestion?.description} [${choice.ruleId}]: ${formatImpact(choice.suggestion?.impact) ?? "unmeasured"}`,
      },
      ...(choice.notes ?? []).filter(
        (note) => note.loc || !shared.some((s) => s.message === note.message),
      ),
    ]),
  ];
}

export function toLspDiagnostic(
  diagnostic: Diagnostic,
  document: TextDocument,
): LspDiagnostic {
  const impact = diagnostic.alternatives?.length
    ? undefined
    : formatImpact(diagnostic.suggestion?.impact);
  const lsp: LspDiagnostic = {
    range: diagnosticRange(diagnostic, document),
    severity: SEVERITIES[diagnostic.severity],
    code: diagnostic.ruleId,
    codeDescription: { href: RULES_DOC },
    source: DIAGNOSTIC_SOURCE,
    message: impact ? `${diagnostic.message} (${impact})` : diagnostic.message,
  };

  // Notes carry the reasoning a rule wants the reader to check before acting on
  // it, and several are located elsewhere in the file. relatedInformation is
  // the only place a client will show that as something clickable, and it is
  // a flat list -- a client cannot nest one choice's notes under its heading
  // -- so with several choices this is built to still read as separate blocks
  // rather than one run-on list.
  const notes = diagnostic.alternatives?.length
    ? notesForChoices(diagnostic, diagnostic.alternatives)
    : (diagnostic.notes ?? []);
  if (notes.length) {
    lsp.relatedInformation = notes.map((note) => ({
      location: {
        uri: document.uri,
        range: note.loc
          ? diagnosticRange(
              { ...diagnostic, highlight: undefined, loc: note.loc },
              document,
            )
          : lsp.range,
      },
      message: note.message,
    }));
  }

  return lsp;
}
