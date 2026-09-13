import { parseFile } from "m68k-parser";
import {
  normalizeRuleImpactAuditSource,
  ruleImpactAuditCases,
} from "../audit/rule-impact.js";
import { lintParsedFile } from "../core/lint.js";
import { lintSource } from "../core/lint.js";
import { defaultRules } from "../rules/index.js";

/**
 * `manual` means there is no single mechanical rewrite to offer, not merely
 * that applying one needs thought. Where the rewrite is known and its
 * correctness rests on something we can state but not prove, that is
 * `conditional`, which carries the replacement text.
 *
 * Several rules produced replacement text and then marked it `manual`, which
 * showed the user a rewrite while declaring none existed.
 */
const byId = new Map(defaultRules.map((rule) => [rule.meta.id, rule]));

function suggestionsAcrossTheAuditCorpus() {
  const found: {
    ruleId: string;
    applicability: string;
    hasReplacement: boolean;
  }[] = [];
  for (const testCase of ruleImpactAuditCases) {
    if (testCase.exempt || testCase.source === undefined) continue;
    const rule = byId.get(testCase.ruleId);
    if (!rule) continue;
    const source = normalizeRuleImpactAuditSource(testCase.source);
    const diagnostics = lintParsedFile(
      parseFile(source),
      source,
      { processors: [testCase.processor ?? "mc68000"], measureImpact: false },
      [rule],
    );
    for (const diagnostic of diagnostics) {
      if (!diagnostic.suggestion) continue;
      found.push({
        ruleId: diagnostic.ruleId,
        applicability: diagnostic.suggestion.applicability,
        hasReplacement: diagnostic.suggestion.replacement !== undefined,
      });
    }
  }
  return found;
}

describe("applicability matches whether a rewrite is offered", () => {
  test("a manual suggestion offers no replacement", () => {
    const contradictions = suggestionsAcrossTheAuditCorpus()
      .filter((s) => s.applicability === "manual" && s.hasReplacement)
      .map((s) => s.ruleId);
    expect(contradictions).toEqual([]);
  });

  test("the corpus does exercise suggestions, so the check is not vacuous", () => {
    const all = suggestionsAcrossTheAuditCorpus();
    expect(all.length).toBeGreaterThan(50);
    expect(all.some((s) => s.hasReplacement)).toBe(true);
  });
});

describe("tail calls offer the rewrite", () => {
  const tail = (lines: string[], ruleId: string) =>
    lintSource(lines.join("\n"), { processors: ["mc68000"] }).find(
      (d) => d.ruleId === ruleId,
    )?.suggestion;

  test("BSR/RTS becomes BRA, conditional on the callee not reading the stack depth", () => {
    const suggestion = tail(
      ["\tbsr\t.sub", "\trts", ".sub:", "\trts"],
      "optimization/bsr-rts-tail-call",
    );
    expect(suggestion?.replacement).toBe("\tbra\t.sub");
    expect(suggestion?.applicability).toBe("conditional");
  });

  test("JSR/RTS becomes JMP", () => {
    const suggestion = tail(
      ["\tjsr\t.sub", "\trts", ".sub:", "\trts"],
      "optimization/jsr-rts-tail-call",
    );
    expect(suggestion?.replacement).toBe("\tjmp\t.sub");
    expect(suggestion?.applicability).toBe("conditional");
  });

  // Folding the pair away would take the label with it, and there is no one
  // rewrite that preserves an entry point other code may branch to.
  test("a label on the RTS leaves it a manual judgement with no rewrite", () => {
    const suggestion = tail(
      ["\tbsr\t.sub", ".ret:", "\trts", ".sub:", "\trts"],
      "optimization/bsr-rts-tail-call",
    );
    expect(suggestion?.applicability).toBe("manual");
    expect(suggestion?.replacement).toBeUndefined();
  });
});
