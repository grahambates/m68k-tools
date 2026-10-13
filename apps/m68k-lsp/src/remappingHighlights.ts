import type {
  RegisterUsageReference,
  RegisterUsageResult,
  Range,
} from "@m68k-lsp/protocol";

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

/**
 * Groups reference lines for whole-line usage highlights. A line counts as a
 * write when any reference on it may write the register, matching the strong
 * highlight VS Code uses for write occurrences; other lines are reads.
 */
export function usageHighlightLines(references: RegisterUsageReference[]): {
  read: number[];
  write: number[];
} {
  const write = new Set(
    references
      .filter(({ access }) => access === "write" || access === "readwrite")
      .map(({ range }) => range.start.line),
  );
  const read = new Set(
    references
      .map(({ range }) => range.start.line)
      .filter((line) => !write.has(line)),
  );
  return { read: [...read], write: [...write] };
}
