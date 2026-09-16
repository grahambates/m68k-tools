import type { ParsedLine } from "m68k-parser";
import type { RuleContext } from "./context.js";
import type { RuleCategory, Severity } from "./diagnostic.js";
import type {
  LintConfig,
  OptimizationGoal,
  Platform,
  RulePreset,
} from "./config.js";

export interface RuleMeta {
  id: string;
  category: RuleCategory;
  defaultSeverity: Severity;
  enabledByDefault?: boolean;
  /** Presets which opt this rule in when it is otherwise disabled by default. */
  presets?: RulePreset[];
  /** If present, this rule only runs for these platform modes. */
  platforms?: Platform[];
  /**
   * Which goal this rule serves, for a rewrite that trades one resource for the
   * other. A rule that wins on both axes leaves this unset and always applies.
   *
   * Declared rather than inferred because impact is only measured for 68000
   * targets, and only when measurement is enabled; without it a size-costing
   * rewrite would be offered in a size-focused run. A test checks the
   * declaration against what the audit measures, so it cannot drift.
   */
  serves?: OptimizationGoal;
  /**
   * The rule this one undoes.
   *
   * Two rules that reverse each other must never both be active: applying one
   * recreates the other's input, so a fixer running to a fixpoint would loop.
   * Only the goal each serves decides which is live, and in balanced runs the
   * one carrying this is off, leaving the other as the canonical direction.
   */
  inverseOf?: string;
  /**
   * Retain the original when a rewrite loses a constant/expression or encodes
   * its intent through an opaque trick (e.g. stack shifts or carry masks).
   * Multiple lines and routine idioms alone do not qualify.
   * Mark the rule if any supported form needs this; expression-preserving
   * substitutions and simple removal of redundant code normally stay unmarked.
   */
  obfuscated?: boolean;
  description: string;
  tags?: string[];
  docs?: {
    source?: string;
    note?: string;
    /**
     * A minimal source snippet that triggers this rule, used to render a
     * before/after example in docs/rules.md. The generator lints it against
     * this rule alone and applies the resulting fix to produce "after", so an
     * example that does not trigger the rule or produce a change fails the
     * doc build rather than silently documenting the wrong thing.
     */
    example?: {
      source: string;
      /** Overrides the generator's default lint config (mc68000, generic). */
      config?: Partial<LintConfig>;
    };
  };
}

export interface Rule {
  meta: RuleMeta;
  checkLine?(ctx: RuleContext, line: ParsedLine, index: number): void;
  checkFile?(ctx: RuleContext): void;
}
