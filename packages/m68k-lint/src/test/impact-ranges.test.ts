import { lintSource } from "../core/lint.js";

/**
 * A shift by a register is a range only because the count is unknown in
 * general: 68kcounter records it as `base + multiplier * n` over n in 0..63.
 * These rules fire only once constant propagation has proven the count, so
 * substituting it is the same arithmetic 68kcounter does for a literal count.
 *
 * Without that, only the size was comparable, and a rule that saves cycles at a
 * cost in bytes was reported as an outright regression.
 */
const impactOf = (lines: string[], ruleId: string) =>
  lintSource(lines.join("\n"), { processors: ["mc68000"] }).find(
    (d) => d.ruleId === ruleId,
  )?.suggestion?.impact;

describe("timing that depends on a proven shift count", () => {
  test("a known register count is measured rather than left a range", () => {
    const impact = impactOf(
      [
        "\tmoveq #24,d1",
        "\tlsr.l d1,d0",
        "\tmoveq #0,d1",
        "\tmoveq #0,d7",
        "\trts",
      ],
      "optimization/stack-known-register-shift",
    );
    // LSR.L Dn,Dn is 8 + 2n, so 56 for n=24, plus 4 for the MOVEQ it replaces.
    expect(impact?.execution?.cpuCycles?.before).toBe(60);
    expect(impact?.execution?.cpuCycles?.confidence).toBe("exact");
    expect(impact?.execution?.cpuCycles?.delta).toBe(-36);
  });

  test("saving cycles at a cost in bytes reads as a trade-off, not a regression", () => {
    const impact = impactOf(
      [
        "\tmoveq #24,d1",
        "\tlsr.l d1,d0",
        "\tmoveq #0,d1",
        "\tmoveq #0,d7",
        "\trts",
      ],
      "optimization/stack-known-register-shift",
    );
    expect(impact?.sizeBytes?.delta).toBeGreaterThan(0);
    expect(impact?.assessment).toBe("tradeoff");
  });

  test("a literal count was already measurable and is unchanged", () => {
    const impact = impactOf(
      ["\tlsl.w #8,d0", "\tmoveq #0,d7", "\trts"],
      "optimization/stack-word-shift-eight",
    );
    expect(impact?.execution?.cpuCycles?.delta).toBe(-2);
    expect(impact?.assessment).toBe("tradeoff");
  });

  test("an equivalent conditional branch measures the not-taken path", () => {
    const impact = impactOf(
      ["\tbtst #7,d0", "\tbne .x", ".x:", "\tmoveq #0,d7", "\trts"],
      "optimization/btst-sign-branch",
    );
    expect(impact).toBeDefined();
    expect(impact?.sizeBytes?.confidence).toBe("exact");
    expect(impact?.execution?.cpuCycles?.delta).toBe(-6);
    expect(impact?.execution?.cpuCycles?.confidence).toBe("exact");
  });
});

describe("counts recorded under other names", () => {
  // Rotates prove their count exactly as shifts do, but recorded it as
  // `rotateCount`, so the resolver never saw it and the saving never appeared.
  test("a proven rotate count resolves the range", () => {
    const impact = lintSource(
      ["\tmoveq #12,d1", "\trol.w d1,d0", "\tmoveq #0,d1", "\trts"].join("\n"),
      {
        processors: ["mc68000"],
      },
    ).find((d) => d.ruleId === "optimization/known-register-rotate")?.suggestion
      ?.impact;
    expect(impact?.execution?.cpuCycles?.confidence).toBe("exact");
    expect(impact?.execution?.cpuCycles?.delta).toBeLessThan(0);
  });
});

describe("a redundant size on a bit instruction", () => {
  // BSET on a data register is always long, so `.l` adds nothing the encoding
  // does not fix. yacht.txt gives `#<data>,Dn .L` as 10(2/0): two word fetches,
  // four bytes. 68kcounter bills the spelled-out form an extra extension word.
  test("does not cost the measurement two bytes", () => {
    const impact = lintSource(
      ["\tor.l #8,d0", "\tmoveq #0,d7", "\trts"].join("\n"),
      { processors: ["mc68000"] },
    ).find((d) => d.ruleId === "optimization/prefer-bset")?.suggestion?.impact;
    expect(impact?.sizeBytes?.after).toBe(4);
    expect(impact?.sizeBytes?.delta).toBe(-2);
  });

  test("the suggestion keeps the spelling the rule chose", () => {
    const suggestion = lintSource(
      ["\tor.l #8,d0", "\tmoveq #0,d7", "\trts"].join("\n"),
      {
        processors: ["mc68000"],
      },
    ).find((d) => d.ruleId === "optimization/prefer-bset")?.suggestion;
    expect(suggestion?.replacement).toContain("bset.l");
  });
});
