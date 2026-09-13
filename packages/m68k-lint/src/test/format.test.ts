import type { OptimizationImpact } from "../core/diagnostic.js";
import { formatImpact, saving } from "../cli/format.js";

const exact = (delta: number) => ({
  before: 0,
  after: delta,
  delta,
  confidence: "exact" as const,
});

function impact(
  size: number,
  cpu: number,
  reads: number,
  writes: number,
): OptimizationImpact {
  return {
    sizeBytes: exact(size),
    execution: {
      processor: "mc68000",
      cpuCycles: exact(cpu),
      readCycles: exact(reads),
      writeCycles: exact(writes),
    },
  };
}

describe("CLI impact formatting", () => {
  test("reports deltas as savings, so positive means cheaper than before", () => {
    // A delta of -4 bytes is 4 bytes saved.
    expect(formatImpact(impact(-4, -8, -2, 0), false)).toBe(
      "saves: 4 bytes, 8(2,0) cycles",
    );
  });

  test("shows a cost as a negative saving rather than flipping the label", () => {
    expect(formatImpact(impact(4, -4, 2, 0), false)).toBe(
      "saves: -4 bytes, 4(-2,0) cycles",
    );
  });

  test("shows a neutral measurement rather than hiding it", () => {
    // Useful signal: it says the rewrite is not a size or speed win.
    expect(formatImpact(impact(0, 0, 0, 0), false)).toBe(
      "saves: 0 bytes, 0(0,0) cycles",
    );
  });

  test("colours savings green, costs red and no change grey", () => {
    const coloured = formatImpact(impact(-4, 4, 0, 0), true)!;
    expect(coloured).toContain("[32m4[0m bytes");
    expect(coloured).toContain("[31m-4[0m(");
    expect(coloured).toContain("[90m0[0m,[90m0[0m");
  });

  test("omits missing metrics instead of inventing them", () => {
    expect(formatImpact({ sizeBytes: exact(-2) }, false)).toBe(
      "saves: 2 bytes",
    );
    // Conditional branches have range timing, so cycles can be absent.
    expect(
      formatImpact(
        { sizeBytes: exact(-2), execution: { processor: "mc68000" } },
        false,
      ),
    ).toBe("saves: 2 bytes");
    expect(formatImpact({}, false)).toBeUndefined();
  });

  test("marks a measurement that is not exact", () => {
    expect(
      formatImpact(
        { sizeBytes: { before: 6, after: 4, delta: -2, confidence: "source" } },
        false,
      ),
    ).toBe("saves: 2 bytes (source)");
  });

  test("renders an unknown component rather than dropping the shape", () => {
    expect(saving(undefined, false)).toBe("?");
  });
});
