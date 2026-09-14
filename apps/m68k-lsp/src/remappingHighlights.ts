import type { RegisterUsageResult, Range } from "@m68k-lsp/protocol";

export interface RemappingHighlight {
  range: Range;
  destination: string;
  warning: boolean;
  hover: string;
}

export function remappingHighlights(
  usage: RegisterUsageResult | undefined,
  mappings: Record<string, string>,
  warnings: string[],
): RemappingHighlight[] {
  const used = new Set(usage?.registers.map((r) => r.name));
  const changes = Object.entries(mappings).filter(([a, b]) => a !== b);
  const sources = new Set(changes.map(([a]) => a));
  return changes.flatMap(([source, destination]) => {
    const conflict =
      changes.filter(([, d]) => d === destination).length > 1 ||
      (used.has(destination) && !sources.has(destination));
    return (usage?.registers.find((r) => r.name === source)?.references ?? [])
      .filter((ref) => ref.kind === "explicit")
      .map((ref) => {
        const issues = warnings.filter((w) =>
          w.startsWith(`Line ${ref.range.start.line + 1}:`),
        );
        return {
          range: ref.range,
          destination: destination.toUpperCase(),
          warning: conflict || issues.length > 0,
          hover: [
            `${source.toUpperCase()} → ${destination.toUpperCase()}`,
            ...(conflict ? ["Conflicting destination mapping"] : []),
            ...issues,
          ].join("\n\n"),
        };
      });
  });
}
