import { readFile, writeFile } from "node:fs/promises";
import { statSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { parseFile } from "m68k-parser";
import {
  lintParsedFile,
  needsIncludeCase,
  needsProjectReferences,
} from "../core/lint.js";
import type { FileFacts } from "../core/facts.js";
import { applyFixes, type FixResult } from "../core/fix.js";
import type {
  Applicability,
  Diagnostic,
  OptimizationAssessment,
  RuleCategory,
  Severity,
} from "../core/diagnostic.js";
import {
  buildProjectSymbols,
  type ProjectSymbols,
} from "../analysis/project-symbols.js";
import {
  buildProjectReferences,
  type ProjectReferences,
} from "../analysis/project-references.js";
import { defaultConfig, type LintConfig } from "../core/config.js";
import { formatDiagnostic, formatImpactSummary, paint } from "./format.js";
import { runInit } from "./init.js";
import { runRuleImpactAudit } from "../audit/rule-impact.js";
import { defaultAssemblyExtensions, discoverFiles } from "./file-discovery.js";
import { alwaysIgnored } from "./ignores.js";
import {
  configIncludePaths,
  findProjectConfig,
  followIncludes,
  includeCaseOnDisk,
  loadProjectConfig,
  nodeIncludeFs,
  type IncludedFile,
  type ProjectConfig,
} from "./project-config.js";
import {
  categories,
  parseArgs,
  severityRank,
  usage,
  type CliOptions,
} from "./args.js";
import {
  ruleImpactAuditFailed,
  ruleImpactAuditLines,
  ruleListLines,
} from "./reports.js";
import { runInteractiveFixes } from "./review.js";
import { VERSION } from "./version.js";

export function buildConfig(
  options: CliOptions,
  project: ProjectConfig = {},
): LintConfig {
  const config: LintConfig = {
    ...defaultConfig,
    fixAnnotate:
      options.fixAnnotate ?? project.fixAnnotate ?? defaultConfig.fixAnnotate,
    processors:
      options.processors ?? project.processors ?? defaultConfig.processors,
    platform: options.platform ?? project.platform ?? defaultConfig.platform,
    goal: options.goal ?? project.goal ?? defaultConfig.goal,
    measureImpact:
      options.measureImpact ??
      project.measureImpact ??
      defaultConfig.measureImpact,
    inlineConfig:
      options.inlineConfig ??
      project.inlineConfig ??
      defaultConfig.inlineConfig,
    presets: [
      ...new Set([
        ...(defaultConfig.presets ?? []),
        ...(project.presets ?? []),
        ...options.presets,
      ]),
    ],
    rules: { ...(project.rules ?? {}), ...options.rules },
  };

  const categoryConfig: Partial<Record<RuleCategory, boolean>> = {
    ...(project.categories ?? {}),
  };
  if (options.onlyCategories) {
    for (const category of categories)
      categoryConfig[category] = options.onlyCategories.includes(category);
  }
  for (const category of options.disabledCategories)
    categoryConfig[category] = false;
  if (Object.keys(categoryConfig).length) config.categories = categoryConfig;
  if (!Object.keys(config.rules ?? {}).length) config.rules = undefined;
  return config;
}

export function failsThreshold(
  diagnostics: readonly Diagnostic[],
  threshold: Severity,
): boolean {
  const rank = severityRank[threshold];
  return diagnostics.some((d) => severityRank[d.severity] <= rank);
}

async function lintOne(
  path: string,
  options: CliOptions,
  config: LintConfig,
  projectIndex?: ProjectIndex,
  includePaths: readonly string[] = [],
) {
  let source = await readFile(path, "utf8");
  // What the file system calls each include, for the rule that compares it with
  // what the source says. Found once, from the text as read.
  const facts: FileFacts | undefined = needsIncludeCase(config)
    ? {
        includeCase: await includeCaseOnDisk(
          { path: resolve(path), source },
          { includePaths, fs: nodeIncludeFs() },
        ),
      }
    : undefined;
  let fixed: FixResult | undefined;

  if (options.fix) {
    const accept: Applicability[] = options.fixConditional
      ? ["safe", "conditional"]
      : ["safe"];
    // A trade-off is only a decision once you have said which resource matters.
    // Under an explicit goal the filtering has already dropped the ones that
    // hurt it, so what is left genuinely helps the axis asked for; under
    // balanced it is a coin-flip the linter should not call. Neutral rewrites
    // are never applied: changing the file for no measured gain is churn.
    const goal = config.goal ?? "balanced";
    const acceptAssessments: OptimizationAssessment[] =
      goal === "balanced" ? ["improvement"] : ["improvement", "tradeoff"];
    // A rewrite that will not parse is worse than no rewrite, so a round whose
    // result reads worse than what went in is rolled back rather than written.
    const errorCount = parseFile(source).errors.length;
    fixed = applyFixes(
      source,
      (text) =>
        lintParsedFile(
          parseFile(text),
          text,
          config,
          undefined,
          projectIndex?.symbols,
          projectIndex?.references,
          facts,
        ),
      {
        accept,
        acceptAssessments,
        annotate: config.fixAnnotate,
        verify: (candidate) => parseFile(candidate).errors.length <= errorCount,
      },
    );
    if (fixed.applied.length && !options.fixDryRun) {
      await writeFile(path, fixed.output, "utf8");
      source = fixed.output;
    } else if (fixed.applied.length) {
      source = fixed.output;
    }
  }

  const parsed = parseFile(source);
  const diagnostics = lintParsedFile(
    parsed,
    source,
    config,
    undefined,
    projectIndex?.symbols,
    projectIndex?.references,
    facts,
  );
  return { path, source, parseErrors: parsed.errors, diagnostics, fixed };
}

/**
 * Where to look for constants when no config file marks the project.
 *
 * `process.cwd()` is the wrong guess for `m68k-lint ../game/src`: it would index
 * the directory the command was typed in rather than the one being linted. The
 * inputs themselves say what the project is.
 */
export function inputRoot(inputs: readonly string[], fallback: string): string {
  const directories = inputs.map((input) => {
    const absolute = resolve(fallback, input);
    return statSync(absolute, { throwIfNoEntry: false })?.isDirectory()
      ? absolute
      : dirname(absolute);
  });
  if (directories.length === 0) return fallback;

  let common = directories[0].split(sep);
  for (const directory of directories.slice(1)) {
    const parts = directory.split(sep);
    let i = 0;
    while (i < common.length && i < parts.length && common[i] === parts[i]) i++;
    common = common.slice(0, i);
  }
  return common.join(sep) || fallback;
}

export interface ProjectIndex {
  symbols: ProjectSymbols;
  /** Undefined when no live rule needs it -- see `needsProjectReferences`. */
  references?: ProjectReferences;
}

/**
 * Index the project once for what it's built from: what a constant resolves
 * to, and, only when something will use it, whether a name is referenced at
 * all.
 *
 * Deliberately wider than the lint set, and the project's ignore patterns do not
 * narrow it: a file left out of linting is still read. It also reaches past the
 * project: what the files include, found beside them or through the config's
 * `includePaths`, is read too. Headers are often
 * excluded from linting -- a system include the project only borrows from, whose
 * every unused symbol would otherwise be reported -- but are exactly where
 * constants, macros and cross-file XDEF/XREF pairs live. Reading them costs one
 * pass and each index answers conservatively -- constants only for names the
 * whole project agrees on, references only for names it actually finds -- so a
 * project with conflicting definitions or files this cannot read is no worse off
 * than before. This is also what the language server does.
 *
 * The reference index re-parses every file on top of the constant pass, so
 * `needsReferences` is checked before paying for it: `unused-global-label`
 * ships off, and almost every run has no rule that reads it at all.
 */
async function buildProjectIndex(
  root: string,
  extensions: readonly string[],
  needsReferences: boolean,
  includePaths: readonly string[],
): Promise<ProjectIndex | undefined> {
  let paths: string[];
  try {
    paths = await discoverFiles([root], {
      cwd: root,
      extensions: [
        ...new Set([...extensions, ...defaultAssemblyExtensions, ".inc", ".h"]),
      ],
      ignorePatterns: alwaysIgnored,
    });
  } catch {
    return undefined;
  }

  const files = [];
  const read: IncludedFile[] = [];
  for (const path of paths) {
    try {
      const source = await readFile(path, "utf8");
      files.push({ path: relative(root, path) || path, source });
      read.push({ path, source });
    } catch {
      // Unreadable files simply contribute nothing to the index.
    }
  }

  // What the project includes from outside its tree -- shared NDK files, say --
  // is found through the include paths and read for what it defines, never linted.
  const included = await followIncludes(read, {
    includePaths,
    fs: nodeIncludeFs(),
  });
  for (const { path, source } of included)
    files.push({ path: relative(root, path) || path, source });

  return {
    symbols: buildProjectSymbols(files),
    references: needsReferences ? buildProjectReferences(files) : undefined,
  };
}

type LintResult =
  Awaited<ReturnType<typeof lintOne>> | { path: string; ioError: string };

/**
 * Print the findings, then what changed on disk, then what could not be read.
 *
 * Two blank lines between findings, three between files. Printing each file
 * with its own console.log gave the opposite: a blank line inside a file and
 * only a newline at the boundary between two, so the last finding of one ran
 * straight into the first of the next.
 */
function reportPretty(
  results: readonly LintResult[],
  options: CliOptions,
): void {
  const blocks = results
    .filter(
      (result): result is Extract<LintResult, { source: string }> =>
        "source" in result,
    )
    .map((result) =>
      result.diagnostics
        .map((d) =>
          formatDiagnostic(result.path, result.source, d, options.color),
        )
        .join("\n\n\n"),
    )
    .filter((block) => block.length > 0);
  if (blocks.length) console.log(blocks.join("\n\n\n"));

  // What changed on disk is the first thing to say, before what remains.
  for (const result of results) {
    const fixed = "fixed" in result ? result.fixed : undefined;
    if (!fixed || fixed.applied.length === 0) continue;
    const verb = options.fixDryRun ? "would fix" : "fixed";
    const counts = new Map<string, number>();
    for (const one of fixed.applied)
      counts.set(one.ruleId, (counts.get(one.ruleId) ?? 0) + 1);
    const detail = [...counts]
      .sort()
      .map(([ruleId, n]) => `${ruleId}${n > 1 ? ` x${n}` : ""}`)
      .join(", ");
    console.log(
      `\n${result.path}: ${verb} ${fixed.applied.length} ${fixed.applied.length === 1 ? "issue" : "issues"} ` +
        `${paint(options.color, 90, `(${detail})`)}`,
    );
  }

  for (const result of results) {
    const outcome = "fixed" in result ? result.fixed : undefined;
    if (outcome?.rejected) {
      console.log(
        paint(
          options.color,
          33,
          `\n${result.path}: a rewrite was rolled back because the result would not have parsed.`,
        ),
      );
    }
  }

  // Syntax belongs to the assembler, which reports it against its own grammar
  // rather than this parser's more permissive one. What is worth saying is
  // that a file was not fully read, so an empty result is not mistaken for a
  // verified one.
  for (const result of results) {
    if (!("parseErrors" in result) || result.parseErrors.length === 0) continue;
    console.log(
      paint(
        options.color,
        90,
        `\n${result.path}: ${result.parseErrors.length} line${result.parseErrors.length === 1 ? "" : "s"} could not be parsed; findings for this file may be incomplete.`,
      ),
    );
  }

  const diagnostics = results.flatMap((r) =>
    "diagnostics" in r ? r.diagnostics : [],
  );
  if (options.impactSummary) {
    const summary = formatImpactSummary(diagnostics);
    if (summary) console.log(`\n${summary}`);
  }

  const counts = {
    error: 0,
    warning: 0,
    suggestion: 0,
    info: 0,
  } satisfies Record<Severity, number>;
  for (const d of diagnostics) counts[d.severity]++;
  const total = diagnostics.length;
  if (!total) return;

  const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? "s" : ""}`;
  const groups: string[] = [];
  if (counts.error)
    groups.push(paint(options.color, 31, plural(counts.error, "error")));
  if (counts.warning)
    groups.push(paint(options.color, 33, plural(counts.warning, "warning")));
  if (counts.suggestion)
    groups.push(
      paint(options.color, 36, plural(counts.suggestion, "suggestion")),
    );
  if (counts.info) groups.push(paint(options.color, 90, `${counts.info} info`));
  console.log(
    `\n\n${total} issue${total === 1 ? "" : "s"}: ${groups.join(", ")}`,
  );
}

/**
 * The whole command, as an exit code.
 *
 * Takes the argument vector and returns rather than exiting, so that the
 * behaviour can be exercised without spawning a process. `main.ts` is only the
 * shebang and the call.
 */
export async function run(argv: string[]): Promise<number> {
  let parsedArgs: CliOptions | "help" | "version";
  try {
    parsedArgs = parseArgs(argv);
  } catch (error) {
    console.error(
      `m68k-lint: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    console.error(usage());
    return 2;
  }

  if (parsedArgs === "help") {
    console.log(usage());
    return 0;
  }
  if (parsedArgs === "version") {
    console.log(VERSION);
    return 0;
  }

  const options = parsedArgs;
  if (options.init) return runInit(options.color);
  if (options.listRules) {
    console.log(ruleListLines().join("\n"));
    return 0;
  }
  if (options.auditRuleImpact) {
    const audit = runRuleImpactAudit();
    if (options.format === "json")
      console.log(JSON.stringify({ version: VERSION, audit }, null, 2));
    else console.log(ruleImpactAuditLines(audit).join("\n"));
    return ruleImpactAuditFailed(audit) ? 1 : 0;
  }

  let projectConfig: ProjectConfig = {};
  let projectConfigPath: string | undefined;
  if (options.configPath && !options.useConfig) {
    console.error("m68k-lint: --config cannot be combined with --no-config");
    return 2;
  }
  try {
    projectConfigPath = options.configPath
      ? resolve(options.configPath)
      : options.useConfig
        ? await findProjectConfig()
        : undefined;
    if (projectConfigPath)
      projectConfig = await loadProjectConfig(projectConfigPath);
  } catch (error) {
    console.error(
      `m68k-lint: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 2;
  }

  const projectRoot = projectConfigPath
    ? dirname(projectConfigPath)
    : process.cwd();
  const rawInputs = options.files.length
    ? options.files.map((input) => resolve(process.cwd(), input))
    : (projectConfig.files ?? projectConfig.include ?? []).map((input) =>
        resolve(projectRoot, input),
      );
  if (!rawInputs.length) {
    console.error(
      "m68k-lint: no input files, directories, or globs (and config has no include patterns)\n",
    );
    console.error(usage());
    return 2;
  }

  const extensions =
    options.extensions ?? projectConfig.extensions ?? defaultAssemblyExtensions;
  const ignorePatterns = [
    ...alwaysIgnored,
    ...(projectConfig.ignores ?? projectConfig.ignorePatterns ?? []),
    ...options.ignorePatterns,
  ];

  let inputFiles: string[];
  try {
    inputFiles = await discoverFiles(rawInputs, {
      cwd: projectRoot,
      extensions,
      ignorePatterns,
    });
  } catch (error) {
    console.error(
      `m68k-lint: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 2;
  }
  if (!inputFiles.length) {
    console.error(
      `m68k-lint: no matching assembly files (extensions: ${extensions.join(", ")})`,
    );
    return 2;
  }

  const config = buildConfig(options, projectConfig);

  if (options.fixInteractive) {
    return runInteractiveFixes(inputFiles, config, {
      color: options.color,
      projectConfigPath,
      projectRoot,
    });
  }

  const includePaths = projectConfigPath
    ? configIncludePaths(projectConfig, dirname(projectConfigPath))
    : [];
  const projectIndex =
    config.projectSymbols === false
      ? undefined
      : await buildProjectIndex(
          projectConfigPath ? projectRoot : inputRoot(rawInputs, projectRoot),
          extensions,
          needsProjectReferences(config),
          includePaths,
        );

  const results: LintResult[] = [];
  let ioFailed = false;
  for (const file of inputFiles) {
    try {
      results.push(
        await lintOne(file, options, config, projectIndex, includePaths),
      );
    } catch (error) {
      ioFailed = true;
      const message = error instanceof Error ? error.message : String(error);
      if (options.format === "json")
        results.push({ path: file, ioError: message });
      else
        console.error(
          `${file}: ${paint(options.color, 31, "error")}: ${message}`,
        );
    }
  }

  if (options.format === "json") {
    console.log(
      JSON.stringify(
        {
          version: VERSION,
          configFile: projectConfigPath,
          processors: config.processors,
          platform: config.platform,
          goal: config.goal,
          files: results,
        },
        null,
        2,
      ),
    );
  } else {
    reportPretty(results, options);
  }

  const allDiagnostics = results.flatMap((r) =>
    "diagnostics" in r ? r.diagnostics : [],
  );
  // A file this parser cannot read is not a lint failure. The assembler decides
  // what is valid syntax, and its grammar is the narrower one.
  return ioFailed || failsThreshold(allDiagnostics, options.failOn) ? 1 : 0;
}
