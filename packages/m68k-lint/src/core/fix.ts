import type {
  Applicability,
  Diagnostic,
  OptimizationAssessment,
} from "./diagnostic.js";

/**
 * Applying suggestions to source.
 *
 * A suggestion already carries everything needed: `span` says which lines it
 * stands for, and `replacement` is what goes there, indented to match, with the
 * label and comments of the lines it replaces already folded in. Rules that
 * cannot offer a faithful rewrite decline, so anything with replacement text is
 * safe to splice in as-is.
 */
export type FixAnnotation = "obfuscated" | "all" | "none";

export interface FixOptions {
  /** Which suggestions to apply. `conditional` ones rest on a stated assumption. */
  accept: readonly Applicability[];
  /**
   * Which measured outcomes to apply, defaulting to improvements alone.
   *
   * Applicability and outcome answer different questions. `safe` says the
   * rewrite means the same thing; it says nothing about whether it is worth
   * making. A trade-off is equivalent and costs bytes to save cycles, which is
   * a choice about what the code is for, and a neutral rewrite changes the file
   * for no measured gain at all. Neither is a decision to take unattended.
   *
   * Suggestions with no measurement are always eligible: a dead write is a
   * defect to remove whatever the timings say, and impact is only measured for
   * optimization rules on a 68000.
   */
  acceptAssessments?: readonly OptimizationAssessment[];
  /** Upper bound on lint-and-apply rounds, in case two rules undo each other. */
  maxPasses?: number;
  /**
   * Called with the text a round produced. Returning false rolls that round
   * back and stops.
   *
   * A rewrite that will not parse is worse than no rewrite, and rules have
   * managed to produce one: matching a sequence across an ENDC and replacing
   * the run deleted the directive. That particular fault is fixed, but a fixer
   * writing files should not depend on having found every such bug.
   */
  verify?: (candidate: string) => boolean;
  /**
   * Keep the original as comments: obfuscated (default), all, or none.
   *
   * The 68k idioms these rules produce are opaque: `muls.w #10,d0` becoming
   * five instructions, or a shift becoming a stack trick. The original is the
   * documentation for what the replacement is doing, and once it is gone
   * nothing in the file says what the sequence was for.
   */
  annotate?: FixAnnotation;
}

export interface FixResult {
  output: string;
  applied: { ruleId: string; startLine: number; endLine: number }[];
  /** Suggestions that were eligible but overlapped one already applied this pass. */
  deferred: number;
  passes: number;
  /** True when a round was rolled back because its result did not verify. */
  rejected: boolean;
}

const DEFAULT_MAX_PASSES = 10;

/**
 * The column the code sits in. Where a label occupies column zero, the gap
 * between it and the mnemonic is the instruction's own indentation, and the
 * annotation lines up with that rather than with the label.
 */
function indentOf(sourceLine: string): string {
  const leading = /^[ \t]+/.exec(sourceLine)?.[0];
  if (leading) return leading;
  return /^\S+([ \t]+)(?=\S)/.exec(sourceLine)?.[1] ?? "\t";
}

/**
 * Put the replaced lines above the replacement, commented out.
 *
 * `;` rather than `*`, because the block is indented to match the code and a
 * `*` comment is only a comment in column zero.
 */
function annotated(
  original: readonly string[],
  replacement: string,
  indent: string,
): string {
  const commented = original.map((line) => `${indent}; ${line.trim()}`);
  return [
    `${indent}; was:`,
    ...commented,
    `${indent};${"-".repeat(30)}`,
    replacement,
    `${indent};${"-".repeat(30)}`,
  ].join("\n");
}

export function annotateReplacement(
  lines: readonly string[],
  diagnostic: Diagnostic,
  mode: FixAnnotation = "obfuscated",
): string {
  const replacement = diagnostic.suggestion!.replacement!;
  if (
    mode !== "all" &&
    !(mode === "obfuscated" && diagnostic.suggestion?.obfuscated)
  )
    return replacement;
  const { startLine, endLine } = diagnostic.span!;
  const original = lines.slice(startLine - 1, endLine);
  return annotated(original, replacement, indentOf(original[0] ?? ""));
}

const DEFAULT_ASSESSMENTS: readonly OptimizationAssessment[] = ["improvement"];

function eligible(
  diagnostic: Diagnostic,
  accept: readonly Applicability[],
  assessments: readonly OptimizationAssessment[],
): boolean {
  if (diagnostic.alternatives?.length) return false;
  const suggestion = diagnostic.suggestion;
  if (
    suggestion === undefined ||
    suggestion.replacement === undefined ||
    diagnostic.span === undefined
  )
    return false;
  if (!accept.includes(suggestion.applicability)) return false;
  const assessment = suggestion.impact?.assessment;
  return assessment === undefined || assessments.includes(assessment);
}

/**
 * Splice one round of suggestions into the source.
 *
 * Applied from the bottom up so that the line numbers of the ones still to come
 * stay valid. Where two suggestions cover the same lines only the lower is
 * taken: the other is not discarded, it is simply left for the next round,
 * where it will be recomputed against the text that now exists.
 */
export function applyOnce(
  source: string,
  diagnostics: readonly Diagnostic[],
  accept: readonly Applicability[],
  annotate: FixAnnotation = "obfuscated",
  assessments: readonly OptimizationAssessment[] = DEFAULT_ASSESSMENTS,
): { output: string; applied: FixResult["applied"]; deferred: number } {
  const lines = source.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const candidates = diagnostics
    .filter((diagnostic) => eligible(diagnostic, accept, assessments))
    .sort((a, b) => b.span!.startLine - a.span!.startLine);

  const applied: FixResult["applied"] = [];
  let deferred = 0;
  let lowestTouched = Number.POSITIVE_INFINITY;

  for (const diagnostic of candidates) {
    const { startLine, endLine } = diagnostic.span!;
    if (endLine >= lowestTouched) {
      deferred++;
      continue;
    }
    const replacement = annotateReplacement(lines, diagnostic, annotate);
    // An empty replacement removes the lines outright rather than leaving a
    // blank one behind.
    const inserted = replacement === "" ? [] : replacement.split("\n");
    lines.splice(startLine - 1, endLine - startLine + 1, ...inserted);
    applied.push({ ruleId: diagnostic.ruleId, startLine, endLine });
    lowestTouched = startLine;
  }

  return { output: lines.join("\n"), applied: applied.reverse(), deferred };
}

/**
 * Lint, apply, and repeat until nothing changes.
 *
 * Repeating matters because one rewrite exposes another, and because
 * overlapping suggestions are deliberately left for a later round. The pass
 * limit is a backstop: a rule and its inverse can never both be live, so a
 * cycle should be impossible, but a limit turns a bug into a stopped run rather
 * than one that never finishes.
 */
export function applyFixes(
  source: string,
  lint: (source: string) => readonly Diagnostic[],
  options: FixOptions,
): FixResult {
  const maxPasses = options.maxPasses ?? DEFAULT_MAX_PASSES;
  let output = source;
  const applied: FixResult["applied"] = [];
  let deferred = 0;
  let passes = 0;
  let rejected = false;

  while (passes < maxPasses) {
    const round = applyOnce(
      output,
      lint(output),
      options.accept,
      options.annotate,
      options.acceptAssessments ?? DEFAULT_ASSESSMENTS,
    );
    if (round.applied.length === 0) {
      deferred = round.deferred;
      break;
    }
    if (options.verify && !options.verify(round.output)) {
      rejected = true;
      break;
    }
    passes++;
    output = round.output;
    applied.push(...round.applied);
    deferred = round.deferred;
  }

  return { output, applied, deferred, passes, rejected };
}
