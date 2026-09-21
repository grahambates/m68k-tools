import { defaultRules } from "../rules/index.js";
import {
  normalizeRuleImpactAuditSource,
  ruleImpactAuditCases,
  runRuleImpactAudit,
} from "../audit/rule-impact.js";
import { normalizeCounterSnippet } from "../analysis/impact.js";

describe("representative rule impact audit", () => {
  test("every optimization rule is accounted for", () => {
    const covered = new Set(ruleImpactAuditCases.map((c) => c.ruleId));
    const missing = defaultRules
      .filter((r) => r.meta.category === "optimization")
      .map((r) => r.meta.id)
      .filter((id) => !covered.has(id));
    expect(missing).toEqual([]);
  });

  test("representative 68000 cases trigger and are measurable", () => {
    const bad = runRuleImpactAudit().filter(
      (r) =>
        r.status === "missing-case" ||
        r.status === "not-triggered" ||
        r.status === "unmeasured",
    );
    expect(bad).toEqual([]);
  });

  test("representative 68000 cases are not outright resource regressions", () => {
    const regressions = runRuleImpactAudit().filter(
      (r) => r.status === "regression",
    );
    expect(regressions).toEqual([]);
  });

  test("audit fixtures are indented so instructions are not parsed as column-zero labels", () => {
    expect(normalizeRuleImpactAuditSource("move.l #42,d0\n.x:\nrts")).toBe(
      "\tmove.l #42,d0\n.x:\n\trts",
    );
  });

  test("column-zero label definitions are left in place", () => {
    // An indented `.x:` is neither a label nor a mnemonic, so indenting it would
    // delete the branch target rather than merely move it.
    expect(normalizeRuleImpactAuditSource("bra .x\n.x:\nrts")).toBe(
      "\tbra .x\n.x:\n\trts",
    );
    expect(normalizeRuleImpactAuditSource("loop: dbf d0,loop")).toBe(
      "loop: dbf d0,loop",
    );
    expect(
      normalizeRuleImpactAuditSource("answer equ 42\nmove.l #answer,d0"),
    ).toBe("answer equ 42\n\tmove.l #answer,d0");
  });

  test("generated replacement snippets are indented before 68kcounter parsing", () => {
    expect(normalizeCounterSnippet("moveq #42,d0\naddq.l #1,d0")).toBe(
      "\tmoveq #42,d0\n\taddq.l #1,d0",
    );
  });

  test("prefer-moveq representative case reaches the rule audit path", () => {
    const rule = defaultRules.find(
      (r) => r.meta.id === "optimization/prefer-moveq",
    );
    expect(rule).toBeDefined();
    const results = runRuleImpactAudit([rule!]);
    expect(results).toHaveLength(1);
    expect(results[0].status).not.toBe("not-triggered");
  });
});

test("sequence folds measure their full source span", () => {
  const audit = runRuleImpactAudit();
  for (const id of [
    "optimization/combine-consecutive-addq",
    "optimization/combine-address-adjustments",
    "optimization/cancel-addq-predecrement-move",
    "optimization/negate-sub-to-add",
    "optimization/negate-add-to-sub",
    "optimization/negate-add-mask-to-eor",
  ]) {
    const results = audit.filter((r) => r.ruleId === id);
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.status === "regression")).toBe(false);
  }
});
