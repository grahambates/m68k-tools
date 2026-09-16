import { annotateReplacement, type FixAnnotation } from "./fix.js";
import type { Diagnostic } from "./diagnostic.js";

/**
 * What to do with one finding.
 *
 * The two ways of silencing something differ in scope rather than sentiment,
 * which is the only distinction worth encoding. `allow` says this occurrence is
 * fine and writes a directive beside it; `disable` says the rule does not suit
 * this project at all and belongs in the config, where one entry replaces a
 * comment on every occurrence.
 *
 * An earlier pair, "acknowledge" and "ignore", tried to record how the reader
 * felt about the finding. It read as a claim about intent, but equally as
 * "I have applied this by hand", which is not a suppression at all -- a finding
 * you have actually fixed stops being reported on its own.
 */
export type Decision =
  | "apply"
  | "apply-rule"
  | "skip"
  | "skip-rule"
  | "allow"
  | "disable"
  | "quit"
  | { alternative: number };

export interface InteractiveResult {
  output: string;
  applied: Diagnostic[];
  suppressed: Diagnostic[];
  /** Rules the reader turned off for the whole project. */
  disabledRules: string[];
  /** True when the review was ended early; decisions already made still stand. */
  quit: boolean;
}

/** The indentation of a line, so an inserted directive lines up with the code. */
function indentOf(line: string | undefined): string {
  if (line === undefined) return "";
  const leading = /^[ \t]+/.exec(line)?.[0];
  if (leading) return leading;
  return /^\S+([ \t]+)(?=\S)/.exec(line)?.[1] ?? "";
}

function suppressionFor(diagnostic: Diagnostic, indent: string): string {
  return `${indent}; m68k-lint-disable-next-line ${[diagnostic, ...(diagnostic.alternatives ?? [])].map((d) => d.ruleId).join(", ")} -- allowed here`;
}

/**
 * Walk the findings, asking about each, then edit.
 *
 * Asked in file order, because that is how a person reads, and edited
 * afterwards from the bottom up, because that is the only order in which line
 * numbers stay valid. Separating the two also means a decision is never taken
 * against text that has already shifted under it.
 *
 * A finding overlapping one already acted on is left alone: the edit it was
 * decided against no longer exists. Running again picks it up against the file
 * as it now stands.
 */
export async function runInteractive(
  source: string,
  diagnostics: readonly Diagnostic[],
  decide: (diagnostic: Diagnostic) => Promise<Decision>,
  annotate: FixAnnotation = "obfuscated",
): Promise<InteractiveResult> {
  const reviewable = diagnostics
    .filter((diagnostic) => diagnostic.span !== undefined)
    .slice()
    .sort((a, b) => a.span!.startLine - b.span!.startLine);

  const decisions: { diagnostic: Diagnostic; decision: "apply" | "allow" }[] =
    [];
  const disabledRules = new Set<string>();
  const acceptedRules = new Set<string>();
  const skippedRules = new Set<string>();
  let quit = false;
  for (const original of reviewable) {
    let diagnostic = original;
    // Once a rule is off for the project, or set aside for this run, there is
    // nothing left to ask about it.
    if (
      disabledRules.has(diagnostic.ruleId) ||
      skippedRules.has(diagnostic.ruleId)
    )
      continue;

    const fixable = diagnostic.suggestion?.replacement !== undefined;
    // A rule already accepted wholesale is not asked about again. A finding of
    // it with no rewrite still is: there is nothing to apply, so the standing
    // answer does not reach it.
    if (
      acceptedRules.has(diagnostic.ruleId) &&
      fixable &&
      !diagnostic.alternatives?.length
    ) {
      decisions.push({ diagnostic, decision: "apply" });
      continue;
    }

    const answer = await decide(diagnostic);
    if (typeof answer === "object") {
      const selected = [diagnostic, ...(diagnostic.alternatives ?? [])][
        answer.alternative
      ];
      if (!selected) continue;
      diagnostic = { ...selected, alternatives: undefined };
    }
    const decision = typeof answer === "object" ? "apply" : answer;
    if (decision === "quit") {
      quit = true;
      break;
    }
    if (decision === "skip") continue;
    if (decision === "skip-rule") {
      skippedRules.add(diagnostic.ruleId);
      continue;
    }
    if (decision === "disable") {
      for (const choice of [diagnostic, ...(diagnostic.alternatives ?? [])])
        disabledRules.add(choice.ruleId);
      continue;
    }
    if (decision === "apply-rule") {
      acceptedRules.add(diagnostic.ruleId);
      if (fixable) decisions.push({ diagnostic, decision: "apply" });
      continue;
    }
    decisions.push({ diagnostic, decision });
  }

  const lines = source.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const applied: Diagnostic[] = [];
  const suppressed: Diagnostic[] = [];
  let lowestTouched = Number.POSITIVE_INFINITY;

  for (const { diagnostic, decision } of decisions
    .slice()
    .sort(
      (a, b) => b.diagnostic.span!.startLine - a.diagnostic.span!.startLine,
    )) {
    const { startLine, endLine } = diagnostic.span!;
    if (endLine >= lowestTouched) continue;

    if (decision === "apply") {
      if (diagnostic.suggestion?.replacement === undefined) continue;
      const replacement = annotateReplacement(lines, diagnostic, annotate);
      lines.splice(
        startLine - 1,
        endLine - startLine + 1,
        ...(replacement === "" ? [] : replacement.split("\n")),
      );
      applied.push(diagnostic);
    } else {
      lines.splice(
        startLine - 1,
        0,
        suppressionFor(diagnostic, indentOf(lines[startLine - 1])),
      );
      suppressed.push(diagnostic);
    }
    lowestTouched = startLine;
  }

  return {
    output: lines.join("\n"),
    applied: applied.reverse(),
    suppressed: suppressed.reverse(),
    disabledRules: [...disabledRules],
    quit,
  };
}
