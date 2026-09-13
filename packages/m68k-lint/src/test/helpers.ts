import { parseFile, type ParsedFile } from "m68k-parser";
import { normalizeRuleImpactAuditSource } from "../audit/rule-impact.js";
import type { LintConfig } from "../core/config.js";
import { DefaultRuleContext } from "../core/context.js";
import type { Diagnostic } from "../core/diagnostic.js";
import { lintSource } from "../core/lint.js";

/**
 * Test fixtures are written in a compact column-zero form for readability, but
 * m68k-parser applies real assembler column rules: a token starting in column 0
 * is a label. Without indenting, `move.l #42,d3` parses as a label named `move`
 * followed by a comment, every rule matches nothing, and the assertions fail for
 * a reason that has nothing to do with the rule under test.
 *
 * This shares one definition of the indent rule with the impact audit so the two
 * fixture corpora cannot drift apart.
 */
export const fixture = normalizeRuleImpactAuditSource;

/** Lint a compact fixture. Prefer this over calling `lintSource` directly. */
export function lint(source: string, config?: LintConfig): Diagnostic[] {
  return lintSource(fixture(source), config);
}

/** Rule IDs reported for a compact fixture, in report order. */
export function ids(source: string, config?: LintConfig): string[] {
  return lint(source, config).map((d) => d.ruleId);
}

/** Parse a compact fixture. */
export function parseFixture(source: string): ParsedFile {
  return parseFile(fixture(source));
}

/** Build a rule context over a compact fixture, for direct analysis assertions. */
export function fixtureContext(
  source: string,
  config: LintConfig = { processors: ["mc68000"] },
): DefaultRuleContext {
  const normalized = fixture(source);
  return new DefaultRuleContext(parseFile(normalized), normalized, config);
}
