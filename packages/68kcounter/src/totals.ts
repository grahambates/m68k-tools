import { type Line } from "./parse";
import { type Timing } from "./timings";

export interface Totals {
  /**
   * Does this show a range of values based on whether branches are followed or not?
   * i.e. are max and min different?
   */
  isRange: boolean;
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
    if (line.bytes) {
      bytes += line.bytes;
      if (line.bss) {
        bssBytes += line.bytes;
      } else {
        objectBytes += line.bytes;
      }
    }
    const timings = line.timing?.values;
    if (!timings) {
      continue;
    }

    const components = Math.max(...timings.map((t) => t.length));
    for (let i = 0; i < components; i++) {
      const values = timings.map((t) => t[i] || 0);
      min[i] = (min[i] || 0) + Math.min(...values);
      max[i] = (max[i] || 0) + Math.max(...values);
    }
  }

  const isRange = min.some((v, i) => v !== max[i]);

  return { min, max, isRange, bytes, bssBytes, objectBytes };
}
