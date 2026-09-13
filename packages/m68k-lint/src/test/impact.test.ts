import type { ParsedFile } from "m68k-parser";
import type { Diagnostic } from "../core/diagnostic.js";
import { measureDiagnosticImpact } from "../analysis/impact.js";

function diagnostic(replacement: string): Diagnostic {
  return {
    ruleId: "test/impact",
    category: "optimization",
    severity: "suggestion",
    confidence: "certain",
    message: "test",
    loc: { line: 1, start: 0, end: 4 },
    suggestion: {
      description: "test replacement",
      replacement,
      applicability: "safe",
    },
  };
}

const oneLineFile = {
  lines: [{ mnemonic: { loc: { line: 1, start: 0, end: 4 } } }],
} as unknown as ParsedFile;

describe("68000 impact measurement", () => {
  test("measures MOVE.L immediate to MOVEQ as an improvement", () => {
    const result = measureDiagnosticImpact(
      diagnostic("moveq #1,d0"),
      oneLineFile,
      "move.l #1,d0",
    );
    const impact = result.suggestion?.impact;
    expect(impact?.sizeBytes?.before).toBeGreaterThan(
      impact?.sizeBytes?.after ?? Infinity,
    );
    expect(impact?.execution?.cpuCycles?.before).toBeGreaterThan(
      impact?.execution?.cpuCycles?.after ?? Infinity,
    );
    expect(impact?.assessment).toBe("improvement");
  });

  test("preserves a historical size claim when exact measurement replaces it", () => {
    const d = diagnostic("moveq #1,d0");
    d.suggestion!.impact = { sizeBytes: { delta: -99, confidence: "source" } };
    const result = measureDiagnosticImpact(d, oneLineFile, "move.l #1,d0", {
      meta: { docs: { source: "historical-test" } },
    });
    expect(result.suggestion?.impact?.sizeBytes?.confidence).toBe("exact");
    expect(result.suggestion?.impact?.sourceClaims?.[0]?.source).toBe(
      "historical-test",
    );
    expect(result.suggestion?.impact?.sourceClaims?.[0]?.sizeBytes?.delta).toBe(
      -99,
    );
    // The claim stays in the data for auditing, but the note is phrased as our
    // own finding rather than attributed to a source.
    expect(
      result.notes?.some((n) => n.message.includes("unverified figure")),
    ).toBe(true);
    expect(
      result.notes?.every(
        (n) => !/ASP68K|Flamewing|68kcounter/.test(n.message),
      ),
    ).toBe(true);
  });

  test("measures empty replacement as zero bytes", () => {
    const result = measureDiagnosticImpact(diagnostic(""), oneLineFile, "nop");
    expect(result.suggestion?.impact?.sizeBytes?.after).toBe(0);
  });
});
