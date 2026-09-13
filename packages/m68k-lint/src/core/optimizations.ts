import type { Diagnostic } from "./diagnostic.js";

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

/** Compare only proven-safe rewrites of the same complete source span. */
export function consolidateOptimizations(
  diagnostics: readonly Diagnostic[],
  compareCosts: boolean,
): Diagnostic[] {
  const groups = new Map<string, Diagnostic[]>();
  for (const d of diagnostics) {
    if (
      d.category !== "optimization" ||
      !d.span ||
      !["certain", "high"].includes(d.confidence) ||
      d.suggestion?.applicability !== "safe" ||
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
          // Notes can describe benefits the counter cannot model (e.g. assembler relaxation).
          if (!a || d.notes?.length || other.notes?.length) return false;
          return (
            a.every((v, i) => (i % 2 === 0 ? v === b[i] : v <= b[i])) &&
            a.some((v, i) => i % 2 === 1 && v < b[i])
          );
        });
      if (dominated) removed.add(d);
      return !dominated;
    });
    if (survivors.length > 1) {
      const [first, ...alternatives] = survivors;
      replacements.set(first, {
        ...first,
        message: "Alternative optimizations for this instruction sequence",
        alternatives,
      });
      alternatives.forEach((d) => removed.add(d));
    }
  }
  return diagnostics
    .filter((d) => !removed.has(d))
    .map((d) => replacements.get(d) ?? d);
}
