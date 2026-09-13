import type { RuleImpactAuditResult } from "../audit/rule-impact.js";
import { defaultRules } from "../rules/index.js";

/** One tab-separated line per built-in rule, for `--list-rules`. */
export function ruleListLines(): string[] {
  return defaultRules.map((rule) => {
    const state =
      rule.meta.enabledByDefault === false
        ? "off by default"
        : rule.meta.defaultSeverity;
    const scope = rule.meta.platforms?.length
      ? ` [${rule.meta.platforms.join(",")}]`
      : "";
    const preset = rule.meta.presets?.length
      ? ` [preset:${rule.meta.presets.join(",")}]`
      : "";
    return `${rule.meta.id}\t${rule.meta.category}\t${state}\t${rule.meta.description}${scope}${preset}`;
  });
}

/** Worst outcomes first, so a regression is the first thing read. */
const AUDIT_STATUS_ORDER = {
  regression: 0,
  tradeoff: 1,
  partial: 2,
  neutral: 3,
  unmeasured: 4,
  "not-triggered": 5,
  "missing-case": 6,
  improvement: 7,
  exempt: 8,
} as const;

/** The statuses that carry measured deltas worth printing. */
const MEASURED = new Set([
  "improvement",
  "tradeoff",
  "neutral",
  "regression",
  "partial",
]);

/**
 * The statuses that fail the audit.
 *
 * "unmeasured" is a failure too: a rule the 68000 counter cannot measure must
 * carry an explicit exemption, so that a new rule cannot silently escape
 * validation.
 */
const FAILING = new Set([
  "regression",
  "not-triggered",
  "missing-case",
  "unmeasured",
]);

export function ruleImpactAuditFailed(
  audit: readonly RuleImpactAuditResult[],
): boolean {
  return audit.some((result) => FAILING.has(result.status));
}

export function ruleImpactAuditLines(
  audit: readonly RuleImpactAuditResult[],
): string[] {
  const sorted = [...audit].sort(
    (a, b) =>
      AUDIT_STATUS_ORDER[a.status] - AUDIT_STATUS_ORDER[b.status] ||
      a.ruleId.localeCompare(b.ruleId),
  );
  const lines = sorted.map((r) => {
    const deltas = MEASURED.has(r.status)
      ? `\tsize ${r.sizeDelta ?? "?"}\tcpu ${r.cpuDelta ?? "?"}\tr ${r.readDelta ?? "?"}\tw ${r.writeDelta ?? "?"}`
      : "";
    return `${r.status}\t${r.ruleId}${deltas}${r.exempt ? `\t${r.exempt}` : ""}${r.detail ? `\t${r.detail}` : ""}`;
  });

  const counts = new Map<string, number>();
  for (const r of audit) counts.set(r.status, (counts.get(r.status) ?? 0) + 1);
  const at = (status: string) => counts.get(status) ?? 0;
  const auditedRuleCount = new Set(audit.map((r) => r.ruleId)).size;
  lines.push(
    "",
    `Rule impact audit: ${audit.length} cases across ${auditedRuleCount} rules; ${at("regression")} regressions, ` +
      `${at("tradeoff")} tradeoffs, ${at("partial")} partial, ${at("improvement")} improvements, ` +
      `${at("unmeasured")} unmeasured, ${at("not-triggered")} bad examples, ${at("missing-case")} missing cases, ` +
      `${at("exempt")} exempt.`,
  );
  return lines;
}
