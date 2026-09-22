import { fixtureContext } from "./helpers.js";

/**
 * A rule can report a finding alongside `alternatives` -- other complete,
 * independently applicable replacements for the same span, typically a
 * cheaper one that depends on something only the developer can confirm. Each
 * one goes through the same processing as the primary diagnostic: span,
 * symbol-loss note, highlight.
 */
describe("ctx.report with alternatives", () => {
  test("an alternative is attached to the primary, fully processed", () => {
    const ctx = fixtureContext("SCALE equ 8\n\tmove.l #100,d0");
    ctx.report({
      ruleId: "test/primary",
      category: "optimization",
      severity: "suggestion",
      confidence: "certain",
      message: "primary",
      loc: { line: 2, start: 0, end: 7 },
      suggestion: {
        description: "safe",
        replacement: "nop",
        applicability: "safe",
      },
      alternatives: [
        {
          ruleId: "test/alternative",
          category: "optimization",
          severity: "suggestion",
          confidence: "medium",
          message: "cheaper but conditional",
          loc: { line: 2, start: 0, end: 7 },
          suggestion: {
            description: "cheaper",
            replacement: "moveq #100,d0",
            applicability: "conditional",
          },
        },
      ],
    });
    const [d] = ctx.getDiagnostics();
    expect(d.ruleId).toBe("test/primary");
    expect(d.alternatives).toHaveLength(1);
    const [alt] = d.alternatives!;
    expect(alt.ruleId).toBe("test/alternative");
    // Processed the same way the primary is: a span was computed for it too.
    expect(alt.span).toEqual(d.span);
  });

  test("a name lost by one alternative but not another is reported on each independently", () => {
    const ctx = fixtureContext("SCALE equ 8\n\tmove.l #SCALE,d0");
    ctx.report({
      ruleId: "test/primary",
      category: "optimization",
      severity: "suggestion",
      confidence: "certain",
      message: "primary",
      loc: { line: 2, start: 0, end: 7 },
      // Keeps the name: nothing lost.
      suggestion: {
        description: "keeps the name",
        replacement: "moveq #SCALE,d0",
        applicability: "safe",
      },
      alternatives: [
        {
          ruleId: "test/alternative",
          category: "optimization",
          severity: "suggestion",
          confidence: "medium",
          message: "alternative",
          loc: { line: 2, start: 0, end: 7 },
          // Works the value out: SCALE is gone.
          suggestion: {
            description: "computed",
            replacement: "moveq #8,d0",
            applicability: "conditional",
          },
        },
      ],
    });
    const [d] = ctx.getDiagnostics();
    expect((d.notes ?? []).some((n) => /does not appear/.test(n.message))).toBe(
      false,
    );
    expect(
      (d.alternatives![0].notes ?? []).some((n) =>
        /does not appear/.test(n.message),
      ),
    ).toBe(true);
  });

  test("an alternative that cannot apply is dropped, not the whole report", () => {
    // A span crossing an inline conditional (`iif`) is refused -- the same
    // rule that drops a primary diagnostic in that shape. Only the
    // alternative's own span reaches into it; the primary's does not.
    const ctx = fixtureContext(
      "\tmove.l #1,d0\n\tiif DEBUG nop\n\tadd.l #2,d0",
    );
    ctx.report({
      ruleId: "test/primary",
      category: "optimization",
      severity: "suggestion",
      confidence: "certain",
      message: "primary",
      loc: { line: 1, start: 0, end: 6 },
      suggestion: {
        description: "fine",
        replacement: "nop",
        applicability: "safe",
      },
      alternatives: [
        {
          ruleId: "test/alternative",
          category: "optimization",
          severity: "suggestion",
          confidence: "medium",
          message: "spans the conditional",
          loc: { line: 1, start: 0, end: 6 },
          // 0-based index 1 is line 2, the `iif` line, pulling this
          // alternative's span across it.
          data: { sourceEndIndex: 1 },
          suggestion: {
            description: "spans it",
            replacement: "nop",
            applicability: "conditional",
          },
        },
      ],
    });
    const [d] = ctx.getDiagnostics();
    expect(d).toBeDefined();
    expect(d.alternatives ?? []).toHaveLength(0);
  });
});
