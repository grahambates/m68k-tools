import type { FixAnnotation } from "./fix.js";
import type { RuleCategory, Severity } from "./diagnostic.js";

export type Processor =
  | "mc68000"
  | "mc68010"
  | "mc68020"
  | "mc68030"
  | "mc68040"
  | "mc68060"
  | "cpu32";

export type RuleSetting = "off" | Severity;
export type OptimizationGoal = "balanced" | "speed" | "size";
export type Platform = "generic" | "amiga" | "atari";
export type RulePreset = "recommended" | "style";

export interface LintConfig {
  /** Which applied fixes retain the original source as comments. */
  fixAnnotate?: FixAnnotation;
  processors: Processor[];
  /** Target platform for platform-specific safety and correctness rules. */
  platform?: Platform;
  /** How optimization suggestions should be filtered when their trade-off is known. */
  goal?: OptimizationGoal;
  /** Measure 68000 replacement impact with 68kcounter when mc68000 is targeted. */
  measureImpact?: boolean;
  /** Disable consolidation when auditing individual rule output. */
  consolidateOptimizations?: boolean;
  /** Honor m68k-lint directives embedded in assembly comments. */
  inlineConfig?: boolean;
  /** Optional rule presets. `style` enables subjective convention rules. */
  presets?: RulePreset[];
  /**
   * Resolve constants a file does not define by indexing the rest of the
   * project. On by default; set false to analyse each file strictly alone.
   */
  projectSymbols?: boolean;
  rules?: Record<string, RuleSetting>;
  categories?: Partial<Record<RuleCategory, boolean>>;
}

export const defaultConfig: LintConfig = {
  fixAnnotate: "obfuscated",
  processors: ["mc68000"],
  platform: "generic",
  goal: "balanced",
  measureImpact: true,
  inlineConfig: true,
  projectSymbols: true,
  presets: ["recommended"],
};

/**
 * Whether every processor being targeted is one of these.
 *
 * A rewrite is only worth offering when it holds on all the targets, so rules
 * list the processors they were verified on and stand down for any other.
 */
export function targetsOnly(
  config: Pick<LintConfig, "processors">,
  allowed: readonly Processor[],
): boolean {
  return config.processors.every((cpu) => allowed.includes(cpu));
}

/** Whether any processor being targeted is one of these. */
export function targetsAny(
  config: Pick<LintConfig, "processors">,
  listed: readonly Processor[],
): boolean {
  return config.processors.some((cpu) => listed.includes(cpu));
}
