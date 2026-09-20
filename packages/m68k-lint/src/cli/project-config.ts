import type { FixAnnotation } from "../core/fix.js";
import { readFile, stat } from "node:fs/promises";
import { dirname, join, parse, resolve } from "node:path";
import type {
  LintConfig,
  OptimizationGoal,
  Platform,
  Processor,
  RulePreset,
  RuleSetting,
} from "../core/config.js";
import type { RuleCategory } from "../core/diagnostic.js";

export { addIgnoreToConfigText, newConfigText } from "./config-edit.js";
export { alwaysIgnored, isIgnored } from "./ignores.js";
export {
  entryDirectories,
  followIncludes,
  includeCaseOnDisk,
  nodeIncludeFs,
  type FollowOptions,
  type IncludeSearchOptions,
  type IncludedFile,
  type IncludeFs,
} from "./project-includes.js";

export const configFileNames = ["m68k-lint.json", ".m68klintrc.json"] as const;

const processors = new Set<Processor>([
  "mc68000",
  "mc68010",
  "mc68020",
  "mc68030",
  "mc68040",
  "mc68060",
  "cpu32",
]);
const platforms = new Set<Platform>(["generic", "amiga", "atari"]);
const goals = new Set<OptimizationGoal>(["balanced", "speed", "size"]);
const ruleSettings = new Set<RuleSetting>([
  "off",
  "error",
  "warning",
  "suggestion",
  "info",
]);
const presets = new Set<RulePreset>(["recommended", "style"]);
const categories = new Set<RuleCategory>([
  "correctness",
  "suspicious",
  "optimization",
  "portability",
  "style",
]);

/** The names in a list that are processors this linter knows, or undefined if there are none. */
export function knownProcessors(
  names: readonly string[] | undefined,
): Processor[] | undefined {
  const known = (names ?? []).filter((name): name is Processor =>
    processors.has(name as Processor),
  );
  return known.length ? known : undefined;
}

export interface ProjectConfig {
  fixAnnotate?: FixAnnotation;
  processors?: Processor[];
  platform?: Platform;
  goal?: OptimizationGoal;
  measureImpact?: boolean;
  inlineConfig?: boolean;
  /**
   * Whether `Foo` and `foo` are different symbols. They are unless the assembler
   * was given `-nocase`, which nothing in the source says, so this is here.
   * True if omitted.
   */
  caseSensitive?: boolean;
  /** Whether the assembler reads backslash escapes in strings (`vasm -esc`). False if omitted. */
  escapeSequences?: boolean;
  presets?: RulePreset[];
  rules?: Record<string, RuleSetting>;
  categories?: Partial<Record<RuleCategory, boolean>>;
  extensions?: string[];
  /** File globs used when the CLI has no explicit targets. */
  files?: string[];
  /** Global file globs to exclude from discovery. */
  ignores?: string[];
  /** Backward-friendly aliases accepted by the loader. */
  ignorePatterns?: string[];
  /**
   * Directories the assembler is given to find includes in, `-I` for vasm.
   * Absolute, or relative to the config file. Includes found through them are
   * read for the constants and macros they define, never linted.
   */
  includePaths?: string[];
  /**
   * The directory relative paths in the source resolve from, where the assembler
   * is run. Absolute, or relative to the config file. Looked in for includes
   * before the include paths.
   */
  sourceRoot?: string;
  include?: string[];
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

export async function findProjectConfig(
  start = process.cwd(),
): Promise<string | undefined> {
  let dir = resolve(start);
  const root = parse(dir).root;
  while (true) {
    for (const name of configFileNames) {
      const candidate = join(dir, name);
      if (await isFile(candidate)) return candidate;
    }
    if (dir === root) return undefined;
    dir = dirname(dir);
  }
}

function assertStringArray(
  value: unknown,
  field: string,
): asserts value is string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${field} must be an array of strings`);
  }
}

export async function loadProjectConfig(path: string): Promise<ProjectConfig> {
  const absolute = resolve(path);
  let raw: string;
  try {
    raw = await readFile(absolute, "utf8");
  } catch (error) {
    throw new Error(
      `Unable to read config ${path}: ${error instanceof Error ? error.message : String(error)}`,
      {
        cause: error,
      },
    );
  }

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Invalid JSON in ${path}: ${error instanceof Error ? error.message : String(error)}`,
      {
        cause: error,
      },
    );
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${path} must contain a JSON object`);
  const config = value as Record<string, unknown>;
  const knownFields = new Set([
    "$schema",
    "fixAnnotate",
    "processors",
    "platform",
    "goal",
    "measureImpact",
    "inlineConfig",
    "caseSensitive",
    "escapeSequences",
    "presets",
    "rules",
    "categories",
    "extensions",
    "files",
    "ignores",
    "include",
    "ignorePatterns",
    "includePaths",
    "sourceRoot",
  ]);
  for (const field of Object.keys(config)) {
    if (!knownFields.has(field))
      throw new Error(`Unknown config field '${field}'`);
  }

  for (const field of [
    "processors",
    "presets",
    "extensions",
    "files",
    "ignores",
    "ignorePatterns",
    "include",
    "includePaths",
  ] as const) {
    if (config[field] !== undefined) assertStringArray(config[field], field);
  }
  if (
    config.processors !== undefined &&
    (config.processors as string[]).some(
      (item) => !processors.has(item as Processor),
    )
  )
    throw new Error("processors contains an unknown CPU");
  if (
    config.presets !== undefined &&
    (config.presets as string[]).some(
      (item) => !presets.has(item as RulePreset),
    )
  )
    throw new Error("presets contains an unknown preset");
  if (
    config.platform !== undefined &&
    (typeof config.platform !== "string" ||
      !platforms.has(config.platform as Platform))
  )
    throw new Error("platform must be generic or amiga");
  if (
    config.goal !== undefined &&
    (typeof config.goal !== "string" ||
      !goals.has(config.goal as OptimizationGoal))
  )
    throw new Error("goal must be balanced, speed, or size");
  if (
    config.measureImpact !== undefined &&
    typeof config.measureImpact !== "boolean"
  )
    throw new Error("measureImpact must be a boolean");
  if (config.sourceRoot !== undefined && typeof config.sourceRoot !== "string")
    throw new Error("sourceRoot must be a string");
  if (
    config.caseSensitive !== undefined &&
    typeof config.caseSensitive !== "boolean"
  )
    throw new Error("caseSensitive must be a boolean");
  if (
    config.escapeSequences !== undefined &&
    typeof config.escapeSequences !== "boolean"
  )
    throw new Error("escapeSequences must be a boolean");
  if (
    config.inlineConfig !== undefined &&
    typeof config.inlineConfig !== "boolean"
  )
    throw new Error("inlineConfig must be a boolean");

  if (
    config.fixAnnotate !== undefined &&
    !["obfuscated", "all", "none"].includes(config.fixAnnotate as string)
  )
    throw new Error("fixAnnotate must be obfuscated, all, or none");

  if (config.rules !== undefined) {
    if (
      !config.rules ||
      typeof config.rules !== "object" ||
      Array.isArray(config.rules)
    )
      throw new Error("rules must be an object");
    for (const [id, setting] of Object.entries(config.rules)) {
      if (
        typeof setting !== "string" ||
        !ruleSettings.has(setting as RuleSetting)
      )
        throw new Error(`rules.${id} has invalid setting '${String(setting)}'`);
    }
  }
  if (config.categories !== undefined) {
    if (
      !config.categories ||
      typeof config.categories !== "object" ||
      Array.isArray(config.categories)
    )
      throw new Error("categories must be an object");
    for (const [category, enabled] of Object.entries(config.categories)) {
      if (!categories.has(category as RuleCategory))
        throw new Error(`Unknown category '${category}'`);
      if (typeof enabled !== "boolean")
        throw new Error(`categories.${category} must be a boolean`);
    }
  }

  return config;
}

export function lintConfigFromProject(
  config: ProjectConfig,
): Partial<LintConfig> {
  return {
    fixAnnotate: config.fixAnnotate,
    processors: config.processors,
    platform: config.platform,
    goal: config.goal,
    measureImpact: config.measureImpact,
    inlineConfig: config.inlineConfig,
    caseSensitive: config.caseSensitive,
    escapeSequences: config.escapeSequences,
    presets: config.presets,
    rules: config.rules,
    categories: config.categories,
  };
}

/** The ignore patterns a project config lists, under either of their names. */
export function configIgnores(config: ProjectConfig): string[] {
  return config.ignores ?? config.ignorePatterns ?? [];
}

/** The config's include paths as absolute directories, relative ones taken from the config's own. */
export function configIncludePaths(
  config: ProjectConfig,
  configDir: string,
): string[] {
  return (config.includePaths ?? []).map((path) => resolve(configDir, path));
}

/** The config's source root as an absolute directory, a relative one taken from the config's own. */
export function configSourceRoot(
  config: ProjectConfig,
  configDir: string,
): string | undefined {
  return config.sourceRoot ? resolve(configDir, config.sourceRoot) : undefined;
}
