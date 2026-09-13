import { parseFile } from "m68k-parser";
import { applyFixes, applyOnce } from "../core/fix.js";
import { lintSource } from "../core/lint.js";

/**
 * Applying a suggestion is a splice: `span` says which lines it stands for and
 * `replacement` is what goes there. Everything that makes that safe was built
 * first — the replacement already carries the indentation, operand column,
 * label and comments of the lines it replaces, and a rule that cannot offer a
 * faithful rewrite declines instead.
 */
const lint = (source: string) =>
  lintSource(source, { processors: ["mc68000"] });
/** Trade-offs are opted into here, since several fixtures below are trade-offs. */
const fix = (source: string, accept: ("safe" | "conditional")[] = ["safe"]) =>
  applyFixes(source, lint, {
    accept,
    acceptAssessments: ["improvement", "tradeoff"],
    verify: (candidate) => parseFile(candidate).errors.length === 0,
  });

describe("applying suggestions", () => {
  test("rewrites a line and keeps its label, spacing and comment", () => {
    const result = fix("start:\n\tmove.l\t#100,d0\t; count\n\trts");
    expect(result.output).toBe("start:\n\tmoveq\t#100,d0\t; count\n\trts");
    expect(result.applied).toHaveLength(1);
  });

  test("applies several independent fixes in one pass", () => {
    const result = fix(
      "\tmove.l\t#100,d0\n\tmove.l\t#5,d1\n\tlea\t4(a0),a0\n\trts",
    );
    expect(result.output).toBe(
      "\tmoveq\t#100,d0\n\tmoveq\t#5,d1\n\taddq.w\t#4,a0\n\trts",
    );
    expect(result.passes).toBe(1);
  });

  test("an empty replacement removes the line rather than blanking it", () => {
    const result = fix(
      "\tmove.w\t#100,d0\n\tmove.w\t#200,d0\n\tmove.l\td0,(a0)\n\trts",
    );
    expect(result.output).toBe("\tmove.w\t#200,d0\n\tmove.l\td0,(a0)\n\trts");
  });

  test("keeps going while each round exposes more", () => {
    const result = fix(
      "\tmove.l\t#1,d0\n\tmove.l\t#2,d0\n\tmove.l\td0,(a0)\n\trts",
    );
    expect(result.output).toBe("\tmoveq\t#2,d0\n\tmove.l\td0,(a0)\n\trts");
    expect(result.passes).toBeGreaterThan(1);
  });

  test("clean source is left exactly as it was", () => {
    const source = "\tmoveq\t#1,d0\n\trts";
    const result = fix(source);
    expect(result.output).toBe(source);
    expect(result.applied).toEqual([]);
    expect(result.passes).toBe(0);
  });
});

describe("what it declines to touch", () => {
  // The rule offers no rewrite, so there is nothing to apply and the ENDC
  // survives. This is the case that deleted a directive before rules stopped
  // matching across one.
  test("a sequence broken by a directive", () => {
    const source = "\tifne\tLIGHTS\n\tbsr\tUpd\n\tendc\n\trts\nUpd:\n\trts";
    expect(fix(source).output).toBe(source);
  });

  test("a conditional suggestion needs asking for", () => {
    const source = "\tmuls.w\t#10,d0\n\tmove.l\td1,d2\n\trts";
    expect(fix(source).output).toBe(source);
    expect(fix(source, ["safe", "conditional"]).output).not.toBe(source);
  });

  test("a rewrite that would not parse is rolled back", () => {
    const source = "\tmove.l\t#100,d0\n\trts";
    const result = applyFixes(source, lint, {
      accept: ["safe"],
      verify: () => false,
    });
    expect(result.output).toBe(source);
    expect(result.rejected).toBe(true);
  });

  test("it stops rather than looping forever", () => {
    // A lint that always claims the same fix would otherwise never settle.
    const forever = (text: string) => [
      {
        ruleId: "test/loop",
        category: "optimization" as const,
        severity: "suggestion" as const,
        confidence: "certain" as const,
        message: "loop",
        loc: { line: 1, start: 0, end: 1 },
        span: { startLine: 1, endLine: 1 },
        suggestion: {
          description: "loop",
          replacement: `\tnop ; ${text.length}`,
          applicability: "safe" as const,
        },
      },
    ];
    const result = applyFixes("\tnop", forever, {
      accept: ["safe"],
      maxPasses: 4,
    });
    expect(result.passes).toBe(4);
  });
});

describe("overlapping suggestions", () => {
  test("one is applied and the other left for the next round", () => {
    // Both the dead write and the MOVEQ rewrite cover line 1.
    const round = applyOnce(
      "\tmove.l\t#1,d0\n\tmove.l\t#2,d0\n\tmove.l\td0,(a0)\n\trts",
      lint("\tmove.l\t#1,d0\n\tmove.l\t#2,d0\n\tmove.l\td0,(a0)\n\trts"),
      ["safe"],
    );
    const lines = round.output.split("\n").length;
    expect(lines).toBeLessThanOrEqual(4);
    expect(round.applied.length + round.deferred).toBeGreaterThan(0);
  });
});

/**
 * The 68k idioms these rules produce are opaque: a multiply becoming five
 * instructions, a shift becoming a stack trick. The original is the
 * documentation for what the replacement does, and once it is gone nothing in
 * the file says what the sequence was for.
 *
 * Two signals decide, both measurable rather than a matter of taste: the
 * replacement grew, or it dropped a name.
 */
describe("keeping the original above an opaque rewrite", () => {
  const annotate = (source: string) =>
    applyFixes(source, lint, {
      accept: ["safe", "conditional"],
      acceptAssessments: ["improvement", "tradeoff"],
      annotate: true,
    }).output;

  test("a rewrite that expands is annotated", () => {
    const output = annotate("start:\n\tasr.w\t#8,d0\n\tmove.l\td1,d2\n\trts");
    expect(output).toContain("\t; was:");
    expect(output).toContain("\t; asr.w\t#8,d0");
    expect(output).toContain("\tmove.w\td0,-(sp)");
  });

  // No expansion here, but SCALE is gone from the result.
  test("a rewrite that drops a name is annotated", () => {
    const output = annotate(
      "SCALE equ 8\n\tdivu.w\t#SCALE,d0\n\tmove.w\td0,d1\n\tmoveq\t#0,d0\n\trts",
    );
    expect(output).toContain("; divu.w\t#SCALE,d0");
    expect(output).toContain("\tlsr.l\t#3,d0");
  });

  test("a rewrite that is neither is left plain", () => {
    expect(annotate("\tmove.l\t#100,d0\n\trts")).toBe(
      "\tmoveq\t#100,d0\n\trts",
    );
  });

  test("it does nothing unless asked", () => {
    const source = "start:\n\tasr.w\t#8,d0\n\tmove.l\td1,d2\n\trts";
    expect(
      applyFixes(source, lint, {
        accept: ["safe", "conditional"],
        acceptAssessments: ["improvement", "tradeoff"],
      }).output,
    ).not.toContain("; was:");
  });

  // The commented copy is documentation; the live label must stay live.
  test("a label sharing the line stays on the replacement, not in the comment", () => {
    const output = annotate("start:\tmuls.w\t#10,d0\n\tmove.l\td1,d2\n\trts");
    expect(output).toContain("start:\text.l\td0");
    expect(parseFile(output).errors).toHaveLength(0);
  });

  test("the annotated result still parses", () => {
    const output = annotate("start:\n\tasr.w\t#8,d0\n\tmove.l\td1,d2\n\trts");
    expect(parseFile(output).errors).toHaveLength(0);
  });
});

/**
 * Applicability and outcome answer different questions. `safe` says the rewrite
 * means the same thing; it says nothing about whether it is worth making. A
 * trade-off is equivalent and costs bytes to save cycles, which is a choice
 * about what the code is for, and a neutral rewrite changes the file for no
 * measured gain at all.
 */
describe("what a fix is worth, not just whether it is equivalent", () => {
  const apply = (
    source: string,
    acceptAssessments?: ("improvement" | "tradeoff" | "neutral")[],
  ) =>
    applyFixes(source, lint, {
      accept: ["safe"],
      ...(acceptAssessments ? { acceptAssessments } : {}),
    }).output;

  // Safe, and still a decision: two bytes for thirty-two cycles.
  const tradeoff = "\tmulu.w\t#1,d0\n\tmove.l\td1,d2\n\trts";

  test("a safe trade-off is not applied by default", () => {
    expect(apply(tradeoff)).toBe(tradeoff);
  });

  test("it is applied once trade-offs are asked for", () => {
    expect(apply(tradeoff, ["improvement", "tradeoff"])).not.toBe(tradeoff);
  });

  // Changing the file for no measured gain is churn.
  test("a neutral rewrite is not applied even when asked for trade-offs", () => {
    const neutral = "\tmove.l\t#$12345,a0\n\tmoveq\t#0,d7\n\trts";
    expect(apply(neutral, ["improvement", "tradeoff"])).toBe(neutral);
  });

  test("an outright improvement is applied by default", () => {
    expect(apply("\tmove.l\t#100,d0\n\trts")).toBe("\tmoveq\t#100,d0\n\trts");
  });

  // A dead write is a defect to remove whatever the timings say, and impact is
  // only measured for optimization rules on a 68000.
  test("a suggestion with no measurement is applied", () => {
    const result = apply(
      "\tmove.w\t#100,d0\n\tmove.w\t#200,d0\n\tmove.l\td0,(a0)\n\trts",
    );
    expect(result).toBe("\tmove.w\t#200,d0\n\tmove.l\td0,(a0)\n\trts");
  });
});
