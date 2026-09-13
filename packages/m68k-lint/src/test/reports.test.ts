import type { RuleImpactAuditResult } from "../audit/rule-impact.js";
import {
  ruleImpactAuditFailed,
  ruleImpactAuditLines,
  ruleListLines,
} from "../cli/reports.js";
import { defaultRules } from "../rules/index.js";

/** An audit row with only the fields a given assertion cares about. */
function result(
  over: Partial<RuleImpactAuditResult> &
    Pick<RuleImpactAuditResult, "ruleId" | "status">,
): RuleImpactAuditResult {
  return over;
}

describe("ruleListLines", () => {
  test("prints one tab-separated line per built-in rule", () => {
    const lines = ruleListLines();
    expect(lines).toHaveLength(defaultRules.length);
    for (const line of lines)
      expect(line.split("\t").length).toBeGreaterThanOrEqual(4);
  });

  test("names the default severity, or says the rule is off", () => {
    const lines = ruleListLines();
    const off = defaultRules.find((r) => r.meta.enabledByDefault === false);
    const on = defaultRules.find((r) => r.meta.enabledByDefault !== false);
    if (off)
      expect(lines.find((l) => l.startsWith(`${off.meta.id}\t`))).toContain(
        "off by default",
      );
    if (on)
      expect(lines.find((l) => l.startsWith(`${on.meta.id}\t`))).toContain(
        on.meta.defaultSeverity,
      );
  });

  test("marks the platform and preset a rule is scoped to", () => {
    const scoped = defaultRules.find((r) => r.meta.platforms?.length);
    if (scoped) {
      expect(
        ruleListLines().find((l) => l.startsWith(`${scoped.meta.id}\t`)),
      ).toContain(`[${scoped.meta.platforms!.join(",")}]`);
    }
    const preset = defaultRules.find((r) => r.meta.presets?.length);
    if (preset) {
      expect(
        ruleListLines().find((l) => l.startsWith(`${preset.meta.id}\t`)),
      ).toContain(`[preset:${preset.meta.presets!.join(",")}]`);
    }
  });
});

describe("ruleImpactAuditFailed", () => {
  test("fails on a regression, a bad example, or a missing case", () => {
    for (const status of [
      "regression",
      "not-triggered",
      "missing-case",
    ] as const) {
      expect(ruleImpactAuditFailed([result({ ruleId: "a/b", status })])).toBe(
        true,
      );
    }
  });

  test("fails on unmeasured, so a rule cannot escape validation silently", () => {
    // A rule the 68000 counter cannot measure has to carry an explicit
    // exemption instead.
    expect(
      ruleImpactAuditFailed([result({ ruleId: "a/b", status: "unmeasured" })]),
    ).toBe(true);
    expect(
      ruleImpactAuditFailed([result({ ruleId: "a/b", status: "exempt" })]),
    ).toBe(false);
  });

  test("passes a clean audit", () => {
    expect(ruleImpactAuditFailed([])).toBe(false);
    expect(
      ruleImpactAuditFailed([
        result({ ruleId: "a/b", status: "improvement" }),
        result({ ruleId: "c/d", status: "neutral" }),
        result({ ruleId: "e/f", status: "tradeoff" }),
      ]),
    ).toBe(false);
  });
});

describe("ruleImpactAuditLines", () => {
  const audit = [
    result({
      ruleId: "z/improvement",
      status: "improvement",
      sizeDelta: -2,
      cpuDelta: -4,
    }),
    result({
      ruleId: "a/regression",
      status: "regression",
      sizeDelta: 2,
      cpuDelta: 4,
    }),
    result({ ruleId: "m/exempt", status: "exempt", exempt: "not measurable" }),
  ];

  test("puts the worst status first, so a regression is read first", () => {
    const lines = ruleImpactAuditLines(audit);
    expect(lines[0].startsWith("regression\ta/regression")).toBe(true);
    expect(lines[1].startsWith("improvement\tz/improvement")).toBe(true);
    expect(lines[2].startsWith("exempt\tm/exempt")).toBe(true);
  });

  test("shows deltas only for statuses that carry a measurement", () => {
    const lines = ruleImpactAuditLines(audit);
    expect(lines[0]).toContain("size 2\tcpu 4\tr ?\tw ?");
    // Exempt was never measured, so it reports its reason instead of deltas.
    expect(lines[2]).not.toContain("size ");
    expect(lines[2]).toContain("not measurable");
  });

  test("ends with a blank line and a counted summary", () => {
    const lines = ruleImpactAuditLines(audit);
    expect(lines.at(-2)).toBe("");
    expect(lines.at(-1)).toContain("3 cases across 3 rules");
    expect(lines.at(-1)).toContain("1 regressions");
    expect(lines.at(-1)).toContain("1 improvements");
    expect(lines.at(-1)).toContain("1 exempt");
  });

  test("counts cases and rules separately when a rule has several cases", () => {
    const summary = ruleImpactAuditLines([
      result({ ruleId: "a/b", status: "improvement" }),
      result({ ruleId: "a/b", status: "improvement" }),
    ]).at(-1);
    expect(summary).toContain("2 cases across 1 rules");
  });
});
