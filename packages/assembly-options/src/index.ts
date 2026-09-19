import { statSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { dirname, join, parse, resolve } from "node:path";

/**
 * How a project's source is assembled.
 *
 * Every field is optional, so a source of options that says nothing about one
 * leaves it to the next. None of these is reliably written in the source: they
 * are arguments given to the assembler.
 */
export interface AssemblyOptions {
  /** Target processors, in the `mc68020` spelling. */
  processors?: string[];
  /** Directories the assembler searches for includes, absolute. */
  includePaths?: string[];
  /** Whether `Foo` and `foo` are different symbols. They are unless vasm was given `-nocase`. */
  caseSensitive?: boolean;
  /**
   * The directory relative paths in the source, such as an `include`, resolve
   * from: the directory the assembler is run in. Absolute. Unset means each
   * file's own directory.
   */
  sourceRoot?: string;
}

/** A project config file: a name containing `.m68krc`, as the assembly server matches it. */
export const configFileNames = [".m68krc.json", ".m68krc"] as const;

const PROCESSOR_ARG = /^-m(680[0-9]0|cpu32)$/;

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/** The project config that applies at `start`, found by walking up, or undefined if there is none. */
export async function findAssemblyConfig(
  start: string,
): Promise<string | undefined> {
  let dir = resolve(start);
  const root = parse(dir).root;
  for (;;) {
    for (const name of configFileNames) {
      const candidate = join(dir, name);
      if (await isFile(candidate)) return candidate;
    }
    if (dir === root) return undefined;
    dir = dirname(dir);
  }
}

/** As `findAssemblyConfig`, for callers that cannot wait. */
export function findAssemblyConfigSync(start: string): string | undefined {
  let dir = resolve(start);
  const root = parse(dir).root;
  for (;;) {
    for (const name of configFileNames) {
      const candidate = join(dir, name);
      try {
        if (statSync(candidate).isFile()) return candidate;
      } catch {
        // not there
      }
    }
    if (dir === root) return undefined;
    dir = dirname(dir);
  }
}

/**
 * What vasm arguments say about how the source is assembled.
 *
 * `-Idir` (or `-I dir`) is an include path, `-nocase` folds symbol case, and
 * `-m68020` names a processor. Relative paths are taken from `base`.
 */
export function optionsFromVasmArgs(
  args: readonly string[],
  base = process.cwd(),
): AssemblyOptions {
  const options: AssemblyOptions = {};
  const includePaths: string[] = [];
  const processors: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "-nocase") options.caseSensitive = false;
    else if (PROCESSOR_ARG.test(arg)) processors.push(`mc${arg.slice(2)}`);
    else if (arg === "-I" && args[i + 1] !== undefined)
      includePaths.push(resolve(base, args[++i]));
    else if (arg.startsWith("-I") && arg.length > 2)
      includePaths.push(resolve(base, arg.slice(2)));
  }
  if (includePaths.length) options.includePaths = includePaths;
  if (processors.length) options.processors = processors;
  return options;
}

/**
 * The options in a layered order: later layers win field by field, except that
 * include paths are joined, earlier ones first and each only once, since a
 * tool's own directories add to the project's rather than replacing them.
 */
export function mergeOptions(
  ...layers: readonly AssemblyOptions[]
): AssemblyOptions {
  const merged: AssemblyOptions = {};
  const paths: string[] = [];
  for (const layer of layers) {
    if (layer.processors) merged.processors = layer.processors;
    if (layer.caseSensitive !== undefined)
      merged.caseSensitive = layer.caseSensitive;
    if (layer.sourceRoot !== undefined) merged.sourceRoot = layer.sourceRoot;
    for (const path of layer.includePaths ?? [])
      if (!paths.includes(path)) paths.push(path);
  }
  if (paths.length) merged.includePaths = paths;
  return merged;
}

export interface LoadedOptions {
  options: AssemblyOptions;
  /** Things the file says that do not fit together, for the caller to log. */
  warnings: string[];
}

const isStrings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

/**
 * The options in a project config file.
 *
 * Only the shared keys are read, and anything else in the file, which is the
 * tool's own, is left alone and never an error. A key set outright wins over
 * what the `vasm.args` in the same file imply, and where the two disagree the
 * caller is told. Relative paths are taken from the file's directory.
 *
 * @throws if the file cannot be read or is not JSON
 */
export async function loadAssemblyOptions(
  path: string,
): Promise<LoadedOptions> {
  const dir = dirname(resolve(path));
  const text = await readFile(path, "utf8");
  const json = JSON.parse(text) as Record<string, unknown> | null;
  if (!json || typeof json !== "object" || Array.isArray(json))
    throw new Error(`${path} must contain a JSON object`);

  const warnings: string[] = [];
  const vasm = json.vasm as { args?: unknown } | undefined;
  const fromArgs = isStrings(vasm?.args)
    ? optionsFromVasmArgs(vasm.args, dir)
    : {};

  const stated: AssemblyOptions = {};
  if (isStrings(json.processors)) stated.processors = json.processors;
  if (isStrings(json.includePaths))
    stated.includePaths = json.includePaths.map((p) => resolve(dir, p));
  if (typeof json.caseSensitive === "boolean")
    stated.caseSensitive = json.caseSensitive;
  if (typeof json.sourceRoot === "string")
    stated.sourceRoot = resolve(dir, json.sourceRoot);

  if (stated.caseSensitive === true && fromArgs.caseSensitive === false)
    warnings.push(
      `caseSensitive is true but the vasm arguments include -nocase; the setting is used for analysis, and vasm still folds case`,
    );

  return { options: mergeOptions(fromArgs, stated), warnings };
}

/**
 * The directories to look in for an include after the including file's own:
 * the source root, where the assembler runs and so looks first, then the
 * include paths in order, each once.
 */
export function searchPaths(
  includePaths: readonly string[] = [],
  sourceRoot?: string,
): string[] {
  const paths = sourceRoot ? [sourceRoot, ...includePaths] : [...includePaths];
  return paths.filter((path, i) => paths.indexOf(path) === i);
}

/**
 * The vasm arguments to run with: the ones the user gave, then those that follow
 * from the options, each only if it is not already there.
 *
 * Lets someone write `includePaths` and `caseSensitive` once, in the friendly
 * form, and have vasm told the same thing as everything else that reads them.
 */
export function vasmArgs(
  options: AssemblyOptions,
  custom: readonly string[] = [],
): string[] {
  const args = [...custom];
  const has = (arg: string) => args.includes(arg);

  const hasInclude = (path: string) =>
    args.some(
      (arg, i) => arg === `-I${path}` || (arg === "-I" && args[i + 1] === path),
    );
  for (const path of options.includePaths ?? [])
    if (!hasInclude(path)) args.push(`-I${path}`);
  for (const processor of options.processors ?? []) {
    const arg = `-m${processor.replace(/^mc/, "")}`;
    if (!has(arg)) args.push(arg);
  }
  if (options.caseSensitive === false && !has("-nocase")) args.push("-nocase");
  return args;
}
