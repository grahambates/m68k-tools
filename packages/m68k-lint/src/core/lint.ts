import { consolidateOptimizations } from "./optimizations.js";
import { parseFile, type ParsedFile } from "m68k-parser";
import { DefaultRuleContext } from "./context.js";
import { defaultConfig, type LintConfig } from "./config.js";
import type { Diagnostic, Severity } from "./diagnostic.js";
import type { Rule } from "./rule.js";
import {
  defaultRules,
  unusedGlobalLabel,
  unusedConstant,
} from "../rules/index.js";
import { measureDiagnosticImpact } from "../analysis/impact.js";
import { createInlineSuppression } from "./inline-config.js";
import type { ExternalSymbols } from "../analysis/symbols.js";
import type { ProjectReferences } from "../analysis/project-references.js";

function matchesOptimizationGoal(
  diagnostic: Diagnostic,
  rule: Rule | undefined,
  config: LintConfig,
): boolean {
  const goal = config.goal ?? "balanced";
  if (goal === "balanced" || !diagnostic.suggestion) return true;
  if (diagnostic.category !== "optimization") return true;

  const impact = diagnostic.suggestion.impact;
  if (goal === "size") {
    if (impact?.sizeBytes) return impact.sizeBytes.delta <= 0;
    return true;
  }

  // For speed, only suppress when we have affirmative evidence that the
  // replacement is slower. Unknown timing remains visible.
  if (impact?.execution?.cpuCycles)
    return impact.execution.cpuCycles.delta <= 0;
  return true;
}

/** Whether impact figures will be available to decide a goal per diagnostic. */
function willMeasure(config: LintConfig): boolean {
  return (
    config.measureImpact !== false && config.processors.includes("mc68000")
  );
}

/**
 * Both members of every inverse pair in a rule set.
 *
 * Needed on both sides: the rule declaring `inverseOf` knows it is one half,
 * but the rule it names has no idea it is the other. Defaulted from the built-in
 * rules so that a caller which does not supply it still gets the exclusivity,
 * rather than silently letting a pair run together.
 */
function inversePairs(rules: readonly Rule[]): Set<string> {
  const paired = new Set<string>();
  for (const rule of rules) {
    if (!rule.meta.inverseOf) continue;
    paired.add(rule.meta.id);
    paired.add(rule.meta.inverseOf);
  }
  return paired;
}

let builtInPairs: Set<string> | undefined;

export function effectiveSeverity(
  rule: Rule,
  config: LintConfig,
  paired?: ReadonlySet<string>,
): Severity | "off" {
  const pairs = paired ?? (builtInPairs ??= inversePairs(defaultRules));
  if (config.categories?.[rule.meta.category] === false) return "off";
  if (
    rule.meta.platforms &&
    !rule.meta.platforms.includes(config.platform ?? "generic")
  )
    return "off";

  const goal = config.goal ?? "balanced";
  // Balanced runs keep the canonical direction of a pair, which is the rule
  // that does not declare itself the inverse of another.
  if (rule.meta.inverseOf && goal === "balanced") return "off";

  if (rule.meta.serves && goal !== "balanced" && rule.meta.serves !== goal) {
    // Where the figures exist they decide, per diagnostic, which is finer than
    // the declaration: a rule that usually costs bytes can be neutral on a
    // particular input, and a free win on the other axis belongs in the run.
    // Two rules that undo each other are gated regardless, since both being
    // live would let each recreate the other's input.
    if (!willMeasure(config) || pairs.has(rule.meta.id)) return "off";
  }

  const explicit = config.rules?.[rule.meta.id];
  if (explicit) return explicit;

  if (rule.meta.enabledByDefault === false) {
    const enabledByPreset = rule.meta.presets?.some((preset) =>
      config.presets?.includes(preset),
    );
    return enabledByPreset ? rule.meta.defaultSeverity : "off";
  }
  return rule.meta.defaultSeverity;
}

/**
 * Rules that need a project-wide reference index to do anything at all.
 *
 * Building one costs a second parse of every project file on top of the
 * constant index's own pass, so a caller building that index (the CLI, an
 * editor session) should skip it unless a rule that actually reads
 * `ctx.projectReferences` is live under this config. Kept here rather than
 * left for each caller to decide so the two callers cannot drift: adding a
 * second rule that needs the index is one line in this list, not a change
 * duplicated in the CLI and the language server.
 */
const PROJECT_REFERENCE_RULES: readonly Rule[] = [
  unusedGlobalLabel,
  unusedConstant,
];

export function needsProjectReferences(config: LintConfig): boolean {
  return PROJECT_REFERENCE_RULES.some(
    (rule) => effectiveSeverity(rule, config) !== "off",
  );
}

export function lintParsedFile(
  file: ParsedFile,
  source: string,
  config: LintConfig = defaultConfig,
  rules: readonly Rule[] = defaultRules,
  external?: ExternalSymbols,
  projectReferences?: ProjectReferences,
): Diagnostic[] {
  const ctx = new DefaultRuleContext(
    file,
    source,
    config,
    external,
    projectReferences,
  );

  const paired = inversePairs(rules);
  for (const rule of rules) {
    const severity = effectiveSeverity(rule, config, paired);
    if (severity === "off") continue;

    const before = ctx.getDiagnostics().length;

    if (rule.checkLine) {
      file.lines.forEach((line, index) => {
        // Constants resolved while checking one line belong to that line's
        // diagnostics, not to a later one that happened to follow.
        ctx.forgetExternalUses();
        rule.checkLine?.(ctx, line, index);
      });
    }
    rule.checkFile?.(ctx);

    // Rule authors use defaultSeverity in diagnostics. Apply user override in
    // one central place so rules stay configuration-agnostic.
    const diagnostics = ctx.getDiagnostics() as Diagnostic[];
    for (let i = before; i < diagnostics.length; i++) {
      const diagnostic = diagnostics[i];
      diagnostics[i] = {
        ...diagnostic,
        severity,
        ...(diagnostic.suggestion && rule.meta.obfuscated
          ? { suggestion: { ...diagnostic.suggestion, obfuscated: true } }
          : {}),
      };
    }
  }

  const ruleById = new Map(rules.map((rule) => [rule.meta.id, rule] as const));
  const rawDiagnostics = [...ctx.getDiagnostics()];
  const suppression =
    config.inlineConfig === false ? undefined : createInlineSuppression(source);
  const unsuppressed = suppression
    ? rawDiagnostics.filter((diagnostic) => !suppression(diagnostic))
    : rawDiagnostics;
  const measured = unsuppressed.map((diagnostic) => {
    if (
      config.measureImpact === false ||
      !config.processors.includes("mc68000")
    )
      return diagnostic;
    if (!diagnostic.suggestion || diagnostic.category !== "optimization")
      return diagnostic;
    return measureDiagnosticImpact(
      diagnostic,
      file,
      source,
      ruleById.get(diagnostic.ruleId),
      (expression) => {
        const result = ctx.evaluate(expression);
        return result.known ? result.value : undefined;
      },
    );
  });
  const reported = measured.filter((diagnostic) =>
    matchesOptimizationGoal(
      diagnostic,
      ruleById.get(diagnostic.ruleId),
      config,
    ),
  );

  // Rules run in registration order, so without this diagnostics come back
  // grouped by rule rather than in the order a reader encounters them in the
  // file. Sort by position, keeping rule order as the tie-break so output stays
  // deterministic for two rules matching the same spot.
  const consolidated =
    config.consolidateOptimizations === false
      ? reported
      : consolidateOptimizations(
          reported,
          config.processors.length === 1 && config.processors[0] === "mc68000",
        );
  return consolidated
    .map((diagnostic, order) => ({ diagnostic, order }))
    .sort(
      (a, b) =>
        (a.diagnostic.loc.line ?? 0) - (b.diagnostic.loc.line ?? 0) ||
        a.diagnostic.loc.start - b.diagnostic.loc.start ||
        a.order - b.order,
    )
    .map((entry) => entry.diagnostic);
}

export function lintSource(
  source: string,
  config: LintConfig = defaultConfig,
  rules: readonly Rule[] = defaultRules,
  external?: ExternalSymbols,
  projectReferences?: ProjectReferences,
): Diagnostic[] {
  return lintParsedFile(
    parseFile(source),
    source,
    config,
    rules,
    external,
    projectReferences,
  );
}
