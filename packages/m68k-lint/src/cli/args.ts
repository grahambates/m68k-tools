import type { FixAnnotation } from "../core/fix.js";
import type {
  OptimizationGoal,
  Platform,
  Processor,
  RulePreset,
  RuleSetting,
} from "../core/config.js";
import type { RuleCategory, Severity } from "../core/diagnostic.js";
import { normalizeExtensions } from "./file-discovery.js";
import { VERSION } from "./version.js";

export const processors: readonly Processor[] = [
  "mc68000",
  "mc68010",
  "mc68020",
  "mc68030",
  "mc68040",
  "mc68060",
  "cpu32",
];
export const categories: readonly RuleCategory[] = [
  "correctness",
  "suspicious",
  "optimization",
  "portability",
  "style",
];
export const settings: readonly RuleSetting[] = [
  "off",
  "error",
  "warning",
  "suggestion",
  "info",
];
export const goals: readonly OptimizationGoal[] = ["balanced", "speed", "size"];
export const platforms: readonly Platform[] = ["generic", "amiga", "atari"];
export const presets: readonly RulePreset[] = ["recommended", "style"];

export const severityRank: Record<Severity, number> = {
  error: 0,
  warning: 1,
  suggestion: 2,
  info: 3,
};

export type OutputFormat = "pretty" | "json";

export interface CliOptions {
  files: string[];
  configPath?: string;
  useConfig: boolean;
  extensions?: string[];
  ignorePatterns: string[];
  presets: RulePreset[];
  processors?: Processor[];
  platform?: Platform;
  goal?: OptimizationGoal;
  onlyCategories?: RuleCategory[];
  disabledCategories: RuleCategory[];
  rules: Record<string, RuleSetting>;
  format: OutputFormat;
  failOn: Severity;
  color: boolean;
  listRules: boolean;
  measureImpact?: boolean;
  inlineConfig?: boolean;
  impactSummary: boolean;
  auditRuleImpact: boolean;
  init: boolean;
  /** Rewrite files in place. Applies safe suggestions, plus conditional ones when asked. */
  fix: boolean;
  fixConditional: boolean;
  /** Report what would be rewritten without touching anything. */
  fixDryRun: boolean;
  /** Keep the original, commented out, above a rewrite that is hard to read back. */
  fixAnnotate?: FixAnnotation;
  /** Review each finding and choose what to do with it. */
  fixInteractive: boolean;
}

export function usage(): string {
  return `m68k-lint ${VERSION}

Usage:
  m68k-lint [options] <file|directory|glob ...>

Options:
  --config <path>               Use a specific JSON config file
  --no-config                   Disable config-file discovery
  --ext <ext[,ext...]>          Extensions for directory/glob discovery; default: .s,.asm,.i
  --ignore-pattern <glob>       Do not lint matching files; they are still read (repeatable)
  --cpu <cpu[,cpu...]>          Target processor(s), default: mc68000
  --platform <name>             generic, amiga, atari; default: generic
  --preset <name[,name...]>     Enable rule preset(s): recommended, style
  --goal <balanced|speed|size>  Filter known optimization trade-offs, default: balanced
  --impact                      Enable exact 68000 impact measurement
  --no-impact                   Disable exact 68000 impact measurement
  --inline-config               Honor m68k-lint comment directives (default)
  --no-inline-config            Ignore m68k-lint comment directives
  --impact-summary              Summarize measured outcomes by rule
  --audit-rule-impact           Run representative 68000 timing audit for every optimization rule
  --only <category[,category]>  Run only selected rule categories
  --disable-category <category> Disable a rule category (repeatable)
  --rule <id>=<setting>         Override a rule: off|error|warning|suggestion|info
  --fix                         Apply safe suggestions and rewrite the files
  --fix-conditional             Also apply conditional ones; read their notes first
  --fix-annotate <obfuscated|all|none>  Annotate fixes (default: obfuscated)
  -i, --fix-interactive         Review each finding and choose what to do with it
  --fix-dry-run                 Report what --fix would change, writing nothing
  --format <pretty|json>        Output format, default: pretty
  --fail-on <severity>          Exit 1 at this severity or higher, default: error
  --init                        Create a project config file interactively
  --list-rules                  List built-in rules and exit
  --color / --no-color          Force or disable ANSI colours; default: TTY only
  -h, --help                    Show this help
  -v, --version                 Show version

Examples:
  m68k-lint game.s
  m68k-lint src/
  m68k-lint "src/**/*.asm"
  m68k-lint --ext .s,.asm,.i,.inc src/
  m68k-lint --platform amiga --cpu mc68000 src/
  m68k-lint --rule suspicious/nop=warning --fail-on warning game.s
  m68k-lint --fix src/
`;
}

function requireValue(argv: string[], index: number, option: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith("--"))
    throw new Error(`${option} requires a value`);
  return value;
}

function parseCsv<T extends string>(
  value: string,
  allowed: readonly T[],
  option: string,
): T[] {
  const values = value
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  for (const item of values) {
    if (!allowed.includes(item as T)) {
      throw new Error(
        `${option}: unknown value '${item}'. Expected one of: ${allowed.join(", ")}`,
      );
    }
  }
  return values as T[];
}

/**
 * Read the command line.
 *
 * Returns `"help"` or `"version"` rather than printing, so that what the CLI
 * does with them stays in one place and the parse itself can be tested without
 * capturing output.
 */
export function parseArgs(
  argv: string[],
  isTTY = process.stdout.isTTY,
): CliOptions | "help" | "version" {
  const options: CliOptions = {
    files: [],
    useConfig: true,
    ignorePatterns: [],
    presets: [],
    disabledCategories: [],
    rules: {},
    format: "pretty",
    failOn: "error",
    color: Boolean(isTTY) && !process.env.NO_COLOR,
    listRules: false,
    impactSummary: false,
    auditRuleImpact: false,
    init: false,
    fix: false,
    fixConditional: false,
    fixDryRun: false,

    fixInteractive: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") return "help";
    if (arg === "-v" || arg === "--version") return "version";
    if (arg === "--no-color") {
      options.color = false;
      continue;
    }
    if (arg === "--color") {
      options.color = true;
      continue;
    }
    if (arg === "--impact") {
      options.measureImpact = true;
      continue;
    }
    if (arg === "--no-impact") {
      options.measureImpact = false;
      continue;
    }
    if (arg === "--no-config") {
      options.useConfig = false;
      continue;
    }
    if (arg === "--inline-config") {
      options.inlineConfig = true;
      continue;
    }
    if (arg === "--fix") {
      options.fix = true;
      continue;
    }
    if (arg === "--fix-conditional") {
      options.fix = true;
      options.fixConditional = true;
      continue;
    }
    if (arg === "--fix-interactive" || arg === "-i") {
      options.fixInteractive = true;
      continue;
    }
    if (arg === "--fix-annotate") {
      options.fix = true;
      const value = requireValue(argv, i, arg);
      if (value !== "obfuscated" && value !== "all" && value !== "none")
        throw new Error("--fix-annotate must be obfuscated, all, or none");
      options.fixAnnotate = value;
      i++;
      continue;
    }
    if (arg === "--fix-dry-run") {
      options.fix = true;
      options.fixDryRun = true;
      continue;
    }
    if (arg === "--no-inline-config") {
      options.inlineConfig = false;
      continue;
    }
    if (arg === "--impact-summary") {
      options.impactSummary = true;
      continue;
    }
    if (arg === "--audit-rule-impact") {
      options.auditRuleImpact = true;
      continue;
    }
    if (arg === "--init") {
      options.init = true;
      continue;
    }
    if (arg === "--list-rules") {
      options.listRules = true;
      continue;
    }
    if (arg === "--config") {
      options.configPath = requireValue(argv, i, arg);
      i++;
      continue;
    }
    if (arg === "--ext") {
      options.extensions = normalizeExtensions([
        ...(options.extensions ?? []),
        ...requireValue(argv, i, arg)
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean),
      ]);
      i++;
      continue;
    }
    if (arg === "--ignore-pattern") {
      options.ignorePatterns.push(requireValue(argv, i, arg));
      i++;
      continue;
    }
    if (arg === "--cpu") {
      options.processors = parseCsv(
        requireValue(argv, i, arg),
        processors,
        arg,
      );
      i++;
      continue;
    }
    if (arg === "--platform") {
      const value = requireValue(argv, i, arg) as Platform;
      if (!platforms.includes(value))
        throw new Error(`--platform must be one of: ${platforms.join(", ")}`);
      options.platform = value;
      i++;
      continue;
    }
    if (arg === "--preset") {
      options.presets.push(
        ...parseCsv(requireValue(argv, i, arg), presets, arg),
      );
      i++;
      continue;
    }
    if (arg === "--goal") {
      const value = requireValue(argv, i, arg) as OptimizationGoal;
      if (!goals.includes(value))
        throw new Error("--goal must be balanced, speed, or size");
      options.goal = value;
      i++;
      continue;
    }
    if (arg === "--only") {
      options.onlyCategories = parseCsv(
        requireValue(argv, i, arg),
        categories,
        arg,
      );
      i++;
      continue;
    }
    if (arg === "--disable-category") {
      options.disabledCategories.push(
        ...parseCsv(requireValue(argv, i, arg), categories, arg),
      );
      i++;
      continue;
    }
    if (arg === "--format") {
      const value = requireValue(argv, i, arg);
      if (value !== "pretty" && value !== "json")
        throw new Error("--format must be 'pretty' or 'json'");
      options.format = value;
      i++;
      continue;
    }
    if (arg === "--fail-on") {
      const value = requireValue(argv, i, arg) as Severity;
      if (!(value in severityRank))
        throw new Error(
          "--fail-on must be error, warning, suggestion, or info",
        );
      options.failOn = value;
      i++;
      continue;
    }
    if (arg === "--rule") {
      const value = requireValue(argv, i, arg);
      const split = value.lastIndexOf("=");
      if (split <= 0) throw new Error("--rule expects <rule-id>=<setting>");
      const id = value.slice(0, split);
      const setting = value.slice(split + 1) as RuleSetting;
      if (!settings.includes(setting))
        throw new Error(`Unknown rule setting '${setting}'`);
      options.rules[id] = setting;
      i++;
      continue;
    }
    if (arg.startsWith("-")) throw new Error(`Unknown option '${arg}'`);
    options.files.push(arg);
  }

  return options;
}
