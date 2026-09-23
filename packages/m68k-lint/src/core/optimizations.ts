import type { Applicability, Confidence, Diagnostic } from "./diagnostic.js";

const APPLICABILITY_RANK: Record<Applicability, number> = {
  safe: 0,
  conditional: 1,
  manual: 2,
};
const CONFIDENCE_RANK: Record<Confidence, number> = {
  certain: 0,
  high: 1,
  medium: 2,
  low: 3,
};

/**
 * The most straightforward choice first: safe over conditional, and within
 * that the one the analysis is more sure of. Grouping mixes rules that would
 * never have compared themselves to each other -- a proven-safe rewrite from
 * one rule and a cheaper one from another that only applies if the reader
 * confirms something -- so which one leads is decided here rather than by
 * which rule happened to run first.
 */
function leadRank(d: Diagnostic): number {
  return (
    APPLICABILITY_RANK[d.suggestion!.applicability] * 10 +
    CONFIDENCE_RANK[d.confidence]
  );
}

function costs(d: Diagnostic): number[] | undefined {
  const impact = d.suggestion?.impact;
  const metrics = [
    impact?.sizeBytes,
    impact?.execution?.cpuCycles,
    impact?.execution?.readCycles,
    impact?.execution?.writeCycles,
  ];
  if (
    impact?.execution?.processor !== "mc68000" ||
    metrics.some(
      (m) =>
        m?.confidence !== "exact" ||
        m.before === undefined ||
        m.after === undefined,
    )
  )
    return;
  return metrics.flatMap((m) => [m!.before!, m!.after!]);
}

/**
 * Compare rewrites of the same complete source span, from rules that have no
 * idea of each other -- a divide-by-shift rule and a reciprocal-multiply rule
 * both matching the same DIVU, say. Only "manual" (no complete replacement to
 * compare) is left out: a conditional rewrite is not silently dropped for a
 * safe one that costs more, it survives alongside it as a listed alternative,
 * exactly as a single rule offering its own alternatives already does.
 */
export function consolidateOptimizations(
  diagnostics: readonly Diagnostic[],
  compareCosts: boolean,
): Diagnostic[] {
  const groups = new Map<string, Diagnostic[]>();
  for (const d of diagnostics) {
    if (
      d.category !== "optimization" ||
      !d.span ||
      !d.suggestion ||
      d.suggestion.applicability === "manual" ||
      d.suggestion.replacement === undefined
    )
      continue;
    const key = `${d.span.startLine}:${d.span.endLine}:${d.severity}`;
    const group = groups.get(key) ?? [];
    group.push(d);
    groups.set(key, group);
  }
  const removed = new Set<Diagnostic>();
  const replacements = new Map<Diagnostic, Diagnostic>();
  for (const group of groups.values()) {
    const unique = group.filter((d, i) => {
      const duplicate = group
        .slice(0, i)
        .some(
          (other) =>
            other.suggestion!.replacement === d.suggestion!.replacement &&
            JSON.stringify(other.notes) === JSON.stringify(d.notes),
        );
      if (duplicate) removed.add(d);
      return !duplicate;
    });
    const survivors = unique.filter((d) => {
      const b = compareCosts ? costs(d) : undefined;
      const dominated =
        b &&
        unique.some((other) => {
          const a = costs(other);
          // Notes can describe benefits the counter cannot model (e.g. assembler
          // relaxation). And only a *safe* rewrite is a trustworthy enough witness
          // to drop another outright rather than merely rank ahead of it as an
          // alternative -- a cheaper conditional one is not grounds to make an
          // unconditional rewrite disappear, only to sit below it.
          if (
            !a ||
            d.notes?.length ||
            other.notes?.length ||
            other.suggestion!.applicability !== "safe"
          )
            return false;
          return (
            a.every((v, i) => (i % 2 === 0 ? v === b[i] : v <= b[i])) &&
            a.some((v, i) => i % 2 === 1 && v < b[i])
          );
        });
      if (dominated) removed.add(d);
      return !dominated;
    });
    if (survivors.length > 1) {
      const [first, ...rest] = survivors
        .slice()
        .sort((a, b) => leadRank(a) - leadRank(b));
      // A survivor can already carry its own alternatives -- a rule that
      // reported a few of its own choices (divu-word-by-constant's cheaper
      // scales, say) can still turn out to share a span with another rule
      // entirely. Flattened in rather than replaced, so grouping here never
      // discards what a rule already offered on its own account.
      const alternatives = [
        ...(first.alternatives ?? []),
        ...rest.flatMap((d) => [
          { ...d, alternatives: undefined },
          ...(d.alternatives ?? []),
        ]),
      ];
      replacements.set(first, {
        ...first,
        message: "Alternative optimizations for this instruction sequence",
        alternatives,
      });
      rest.forEach((d) => removed.add(d));
    }
  }
  return diagnostics
    .filter((d) => !removed.has(d))
    .map((d) => replacements.get(d) ?? d);
}
