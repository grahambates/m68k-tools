import {
  DiagnosticSeverity,
  type Diagnostic as LspDiagnostic,
  type Range,
} from "vscode-languageserver";
import type { TextDocument } from "vscode-languageserver-textdocument";
import type {
  Diagnostic,
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

function metric(value: number | undefined, unit: string): string | undefined {
  if (value === undefined || value === 0) return undefined;
  return `${value > 0 ? "+" : "−"}${Math.abs(value)} ${unit}`;
}

/** A short "−2 bytes, −4 cycles" tail for action titles and hovers. */
export function formatImpact(
  impact: OptimizationImpact | undefined,
): string | undefined {
  if (!impact) return undefined;
  const parts = [
    metric(impact.sizeBytes?.delta, "bytes"),
    metric(impact.execution?.cpuCycles?.delta, "cycles"),
  ].filter((part): part is string => part !== undefined);
  return parts.length ? parts.join(", ") : undefined;
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
  // the only place a client will show that as something clickable.
  const notes = diagnostic.alternatives?.length
    ? [diagnostic, ...diagnostic.alternatives].flatMap((choice) => [
        {
          message: `${choice.suggestion?.description} [${choice.ruleId}]: ${formatImpact(choice.suggestion?.impact) ?? "unmeasured"}`,
        },
        ...(choice.notes ?? []),
      ])
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
