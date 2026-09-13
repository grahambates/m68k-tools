import { parseFile } from "m68k-parser";
import type {
  Applicability,
  Diagnostic,
  OptimizationImpact,
  Severity,
} from "../core/diagnostic.js";
import type { SourceSpan } from "../core/span.js";

export function paint(enabled: boolean, code: number, text: string): string {
  return enabled ? `\u001b[${code}m${text}\u001b[0m` : text;
}

/**
 * One number from a measured delta, expressed as a saving: positive is less of
 * the resource than before. Green for a saving, red for a cost.
 */
export function saving(delta: number | undefined, color: boolean): string {
  if (delta === undefined) return "?";
  const saved = -delta;
  return paint(color, saved > 0 ? 32 : saved < 0 ? 31 : 90, `${saved}`);
}

/**
 * Condense a measurement to one line, using the cycles(reads,writes) shape the
 * 68k manuals and 68kcounter use:
 *
 *   saves: 4 bytes, 8(2,0) cycles
 */
export function formatImpact(
  impact: OptimizationImpact,
  color: boolean,
): string | undefined {
  const parts: string[] = [];
  if (impact.sizeBytes)
    parts.push(`${saving(impact.sizeBytes.delta, color)} bytes`);

  const execution = impact.execution;
  if (execution?.cpuCycles) {
    const reads = saving(execution.readCycles?.delta, color);
    const writes = saving(execution.writeCycles?.delta, color);
    parts.push(
      `${saving(execution.cpuCycles.delta, color)}(${reads},${writes}) cycles`,
    );
  }
  if (!parts.length) return undefined;

  if (impact.assessment) {
    if (impact.assessment === "regression")
      parts.push(paint(color, 31, `(regression)`));
    if (impact.assessment === "neutral")
      parts.push(paint(color, 90, `(neutral)`));
    if (impact.assessment === "improvement")
      parts.push(paint(color, 32, `(overall improvement)`));
    if (impact.assessment === "tradeoff")
      parts.push(paint(color, 33, `(tradeoff)`));
  }

  const confidences = [
    impact.sizeBytes?.confidence,
    execution?.cpuCycles?.confidence,
    execution?.readCycles?.confidence,
    execution?.writeCycles?.confidence,
  ].filter((value): value is NonNullable<typeof value> => value !== undefined);
  const inexact = confidences.find((value) => value !== "exact");

  return `${paint(color, 90, "saves:")} ${parts.join(", ")}${inexact ? ` (${inexact})` : ""}`;
}

/**
 * Assembly syntax highlighting for terminal output.
 *
 * Structure comes from the parser rather than from a second set of rules here.
 * It already knows where the label, the mnemonic, the size qualifier, each
 * operand and the comment begin and end, including the edge cases -- a label
 * only in column zero, a semicolon inside a string, a dot that is a size on
 * `move.l` but part of the name on `.loop`. An earlier version re-derived that
 * with a regex and got it wrong: on an indented line the mnemonic was taken for
 * a label and never coloured.
 *
 * Only the inside of an operand is tokenised here, which is the one thing the
 * parser does not break down: it gives an operand's extent, not the split
 * between the registers, numbers and punctuation within it.
 *
 * Colours never change the visible width of a line, which matters: the caret
 * underlining a diagnostic is positioned from the uncoloured text, and escape
 * sequences occupy no columns.
 */
export const COLORS = {
  mnemonic: 34,
  size: 34,
  register: 33,
  literal: 35,
  punctuation: 90,
  comment: 90,
} as const;

const REGISTER = /^(?:d[0-7]|a[0-7]|sp|usp|ssp|pc|sr|ccr|fp[0-7])$/i;

/** Numbers in every base an assembler accepts, strings, identifiers, punctuation. */
const OPERAND_TOKEN =
  /(\$[0-9A-Fa-f]+|%[01]+|@[0-7]+|\d[0-9A-Fa-f]*)|("[^"]*"|'[^']*')|([A-Za-z_.][\w.$]*)|(\s+)|(.)/g;

/** Colour the registers, numbers and punctuation inside one operand. */
function highlightOperand(text: string, color: boolean): string {
  return text.replace(
    OPERAND_TOKEN,
    (match: string, num: string, str: string, word: string, space: string) => {
      if (num || str) return paint(color, COLORS.literal, match);
      // Symbols are left plain so the names carrying the meaning stay the most
      // readable thing on the line.
      if (word)
        return REGISTER.test(word)
          ? paint(color, COLORS.register, match)
          : match;
      return space ? match : paint(color, COLORS.punctuation, match);
    },
  );
}

interface Span {
  start: number;
  end: number;
  kind: "mnemonic" | "size" | "operand" | "comment";
}

export function highlightAsm(text: string, color: boolean): string {
  if (!color || !text.trim()) return text;

  let line;
  try {
    line = parseFile(text).lines[0];
  } catch {
    return text;
  }
  if (!line) return text;

  const spans: Span[] = [];
  if (line.mnemonic) spans.push({ ...line.mnemonic.loc, kind: "mnemonic" });
  if (line.qualifier) {
    // The qualifier covers the size letter alone, so take the dot with it.
    const start = line.qualifier.loc.start;
    spans.push({
      start: text[start - 1] === "." ? start - 1 : start,
      end: line.qualifier.loc.end,
      kind: "size",
    });
  }
  for (const operand of line.operands ?? [])
    spans.push({ ...operand.loc, kind: "operand" });
  if (line.comment) spans.push({ ...line.comment.loc, kind: "comment" });
  spans.sort((a, b) => a.start - b.start);

  const mnemonicEnd = line.mnemonic?.loc.end ?? Infinity;
  const out: string[] = [];
  let cursor = 0;
  for (const span of spans) {
    if (span.start < cursor) continue;
    out.push(gap(text.slice(cursor, span.start), cursor >= mnemonicEnd, color));
    const body = text.slice(span.start, span.end);
    out.push(
      span.kind === "operand"
        ? highlightOperand(body, color)
        : paint(color, COLORS[span.kind === "size" ? "size" : span.kind], body),
    );
    cursor = span.end;
  }
  out.push(gap(text.slice(cursor), cursor >= mnemonicEnd, color));
  return out.join("");
}

/**
 * Text between the spans the parser identified. After the mnemonic this is
 * operand punctuation, mostly the separating commas; before it, the label and
 * the whitespace around it, which are left plain.
 */
function gap(text: string, afterMnemonic: boolean, color: boolean): string {
  if (!afterMnemonic || !text.trim()) return text;
  return text.replace(/\S+/g, (match) =>
    paint(color, COLORS.punctuation, match),
  );
}

/** The severity word, coloured the way the report colours that severity elsewhere. */
export function severityLabel(severity: Severity, color: boolean): string {
  const code =
    severity === "error"
      ? 31
      : severity === "warning"
        ? 33
        : severity === "suggestion"
          ? 36
          : 90;
  return paint(color, code, severity);
}

/**
 * The source a finding covers.
 *
 * Every line of the match is shown, because a match is a run of instructions:
 * BSR followed by RTS is one finding about two lines, and drawing only the
 * first hid what the suggestion was going to replace.
 *
 * There is no caret. Rules point at a mnemonic -- all but one of them -- so an
 * underline never said more than "this instruction", which the line itself
 * already says, and under a multi-line match it marked one line of several as
 * though the others were context.
 */
export function sourceContext(
  source: string,
  span: SourceSpan | undefined,
  color: boolean,
): string[] {
  if (!span) return [];
  const lines = source.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const text: string[] = [];
  for (let line = span.startLine; line <= span.endLine; line++) {
    const content = lines[line - 1];
    if (content === undefined) continue;
    text.push(highlightAsm(content, color));
  }
  return text;
}

export function formatApplicability(
  applicability: Applicability,
  color: boolean,
): string {
  const colors = {
    safe: 32,
    conditional: 33,
    manual: 34,
  };
  return paint(color, colors[applicability], applicability);
}

/** One finding, as the pretty reporter prints it: location, header, source, action, notes. */
export function formatDiagnostic(
  file: string,
  source: string,
  diagnostic: Diagnostic,
  color: boolean,
): string {
  const line = diagnostic.loc.line ?? 1;
  const col = diagnostic.loc.start + 1;
  const location = paint(color, 34, `${file}:${line}:${col}`);
  const header = `${severityLabel(diagnostic.severity, color)}  ${diagnostic.message}  ${paint(color, 90, `[${diagnostic.ruleId}]`)}`;
  const lines = [
    location,
    header,
    ...sourceContext(source, diagnostic.span, color),
  ];
  if (diagnostic.suggestion) {
    const replacement = diagnostic.suggestion.replacement;
    const applicability = formatApplicability(
      diagnostic.suggestion.applicability,
      color,
    );
    lines.push(
      `${paint(color, 90, "action:")} ${diagnostic.suggestion.description} (${applicability})`,
    );
    if (replacement) {
      lines.push(
        ...replacement.split("\n").map((text) => highlightAsm(text, color)),
      );
    }
    const impact = diagnostic.suggestion.impact;
    if (impact) {
      const summary = formatImpact(impact, color);
      if (summary) lines.push(summary);
    }
  }
  const notes = diagnostic.notes ?? [];
  if (notes.length) {
    lines.push(
      `${paint(color, 90, "notes:")}`,
      ...notes.map((n) => " - " + n.message),
    );
  }
  return lines.join("\n");
}

/** Measured outcomes grouped by rule, worst first, for `--impact-summary`. */
export function formatImpactSummary(
  diagnostics: readonly Diagnostic[],
): string | undefined {
  const byRule = new Map<
    string,
    Record<"improvement" | "tradeoff" | "neutral" | "regression", number>
  >();
  for (const d of diagnostics) {
    const assessment = d.suggestion?.impact?.assessment;
    if (!assessment) continue;
    const counts = byRule.get(d.ruleId) ?? {
      improvement: 0,
      tradeoff: 0,
      neutral: 0,
      regression: 0,
    };
    counts[assessment]++;
    byRule.set(d.ruleId, counts);
  }
  if (!byRule.size) return undefined;

  const rank = (counts: Record<string, number>) =>
    counts.regression * 1000 +
    counts.tradeoff * 100 +
    counts.neutral * 10 +
    counts.improvement;
  const rows = [...byRule.entries()].sort(
    (a, b) => rank(b[1]) - rank(a[1]) || a[0].localeCompare(b[0]),
  );
  const lines = ["68000 impact summary by rule:", "assessment\trule\tcount"];
  for (const [rule, counts] of rows) {
    for (const assessment of [
      "regression",
      "tradeoff",
      "neutral",
      "improvement",
    ] as const) {
      if (counts[assessment])
        lines.push(`${assessment}\t${rule}\t${counts[assessment]}`);
    }
  }
  return lines.join("\n");
}
