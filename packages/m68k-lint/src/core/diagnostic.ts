import type { Location } from "m68k-parser";
import type { SourceSpan } from "./span.js";

export type RuleCategory =
  "correctness" | "suspicious" | "optimization" | "portability" | "style";

export type Severity = "error" | "warning" | "suggestion" | "info";
export type Confidence = "certain" | "high" | "medium" | "low";
export type Applicability = "safe" | "conditional" | "manual";

export interface DiagnosticNote {
  message: string;
  loc?: Location;
}

export interface OptimizationMetric {
  before?: number;
  after?: number;
  delta: number;
  /** exact = measured/derived for the selected CPU, source = historical source claim, estimated = modelled approximation */
  confidence: "exact" | "source" | "estimated";
}

export interface OptimizationExecutionImpact {
  processor: string;
  /** Internal CPU execution cycles. Negative delta means faster. */
  cpuCycles?: OptimizationMetric;
  /** External memory read bus cycles. Negative delta means fewer reads. */
  readCycles?: OptimizationMetric;
  /** External memory write bus cycles. Negative delta means fewer writes. */
  writeCycles?: OptimizationMetric;
}

export interface OptimizationSourceClaim {
  /** Historical/reference source for this claim, when known. */
  source?: string;
  sizeBytes?: OptimizationMetric;
  execution?: OptimizationExecutionImpact;
}

export type OptimizationAssessment =
  "improvement" | "tradeoff" | "neutral" | "regression";

export interface OptimizationImpact {
  /** Machine-code bytes. Negative delta means smaller. */
  sizeBytes?: OptimizationMetric;
  /** Per-CPU execution/bus-cycle measurements. 68000 can be supplied exactly by 68kcounter. */
  execution?: OptimizationExecutionImpact;
  /** Preserved historical/source metrics when exact measurement supersedes them. */
  sourceClaims?: OptimizationSourceClaim[];
  /** Derived from exact measurements only. */
  assessment?: OptimizationAssessment;
}

export interface Suggestion {
  /** Inherited from the rule; requests annotation in the default obfuscated mode. */
  obfuscated?: boolean;
  description: string;
  replacement?: string;
  applicability: Applicability;
  /** Optional measured/derived impact. Kept separate from rule validity so unsupported CPUs can simply omit it. */
  impact?: OptimizationImpact;
}

export interface Diagnostic {
  ruleId: string;
  category: RuleCategory;
  severity: Severity;
  confidence: Confidence;
  message: string;
  loc: Location;
  /** Display extent, distinct from the full lines replaced by a fix. */
  highlight?: { start: Location; end: Location };
  /**
   * The source lines this finding covers, inclusive. A suggestion's replacement
   * stands in for the whole run, so applying or measuring one needs this.
   */
  span?: SourceSpan;
  notes?: DiagnosticNote[];
  suggestion?: Suggestion;
  /** Other safe replacements for the same span; each retains its rule and notes. */
  alternatives?: Diagnostic[];
  data?: Record<string, unknown>;
}
