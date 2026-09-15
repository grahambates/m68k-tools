import { type Line } from "./parse";
import { formatTiming, type TimingGroup, type Timing } from "./timings";

export interface Totals {
  /**
   * Does this show a range of values based on whether branches are followed or not?
   * i.e. are max and min different?
   */
  isRange: boolean;
  /** At least one instruction or unknown macro was omitted from timing totals. */
  incomplete?: true;
  /** Reference costs are kept separate from external-bus timing totals. */
  timingGroups?: TimingGroup[];
  /** Maximum total times */
  max: Timing;
  /** Minimum total times */
  min: Timing;
  /** Total bytes */
  bytes: number;
  /** BSS bytes */
  bssBytes: number;
  /** Object (non-BSS) bytes */
  objectBytes: number;
}

/**
 * Total timings and lengths across a range of lines
 */
export function calculateTotals(lines: Line[]): Totals {
  const groups = new Map<string, TimingGroup>();
  let hasReference = false;
  let incomplete = false;
  let bytes = 0;
  let bssBytes = 0;
  let objectBytes = 0;
  // Timing vectors vary in length by CPU (68000: clocks/read/write, 68020 adds
  // a prefetch column), so accumulate each component index independently.
  const min: number[] = [0, 0, 0];
  const max: number[] = [0, 0, 0];

  for (const line of lines) {
    // Reference lines (macro definition / REPT bodies) are shown for
    // information only and must not contribute to the totals.
    if (line.reference) {
      continue;
    }
    incomplete ||= !!line.timingUnavailable;
    if (line.bytes) {
      bytes += line.bytes;
      if (line.bss) {
        bssBytes += line.bytes;
      } else {
        objectBytes += line.bytes;
      }
    }
    const timing = line.timing;
    const timings = timing?.values;
    if (!timings) {
      continue;
    }

    hasReference ||= !!timing?.reference || !!timing?.groups;
    const additions = timing?.groups ?? [
      {
        model: timing?.reference
          ? `${timing.reference.cpu} cached ${timing.reference.basis} reference`
          : timings.some((t) => t.length === 4)
            ? "Bus clocks(reads/prefetches/writes)"
            : "Bus clocks(reads/writes)",
        min: Array.from(
          { length: Math.max(...timings.map((t) => t.length)) },
          (_, i) => Math.min(...timings.map((t) => t[i] ?? 0)),
        ),
        max: Array.from(
          { length: Math.max(...timings.map((t) => t.length)) },
          (_, i) => Math.max(...timings.map((t) => t[i] ?? 0)),
        ),
      },
    ];
    for (const addition of additions) {
      const group = groups.get(addition.model) ?? {
        model: addition.model,
        min: [],
        max: [],
      };
      addition.min.forEach((n, i) => (group.min[i] = (group.min[i] ?? 0) + n));
      addition.max.forEach((n, i) => (group.max[i] = (group.max[i] ?? 0) + n));
      groups.set(addition.model, group);
    }
    const components = Math.max(...timings.map((t) => t.length));
    for (let i = 0; i < components; i++) {
      const values = timings.map((t) => t[i] || 0);
      min[i] = (min[i] || 0) + Math.min(...values);
      max[i] = (max[i] || 0) + Math.max(...values);
    }
  }

  const isRange = min.some((v, i) => v !== max[i]);

  return {
    min,
    max,
    isRange,
    bytes,
    bssBytes,
    objectBytes,
    ...(hasReference ? { timingGroups: [...groups.values()] } : {}),
    ...(incomplete ? { incomplete: true as const } : {}),
  };
}

/** Display each timing basis separately whenever cached reference costs occur. */
export function formatTotalsTiming(totals: Totals): string {
  const range = (min: Timing, max: Timing) =>
    formatTiming(min) +
    (min.some((n, i) => n !== max[i]) ? "–" + formatTiming(max) : "");
  return totals.timingGroups
    ? totals.timingGroups
        .map((g) => `${g.model}: ${range(g.min, g.max)}`)
        .join("; ")
    : range(totals.min, totals.max);
}
