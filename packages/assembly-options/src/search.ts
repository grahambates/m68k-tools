import { isAbsolute, resolve } from "node:path";

export interface VasmSearch {
  /** The directory vasm is run from. */
  cwd: string;
  /** The directory of the main source being assembled, vasm's compile directory. */
  mainDir: string;
  /** `-I` paths as they were written: absolute, or relative. */
  includePaths?: readonly string[];
  /** `incdir` directives as they were written, in the order they appear. */
  incDirs?: readonly string[];
}

/**
 * Where vasm looks for an include, in order.
 *
 * The directory it is run from, then the directory of the main source, then the
 * `-I` paths, then any `incdir`s. A relative path among the last two is tried
 * from the run directory and then from the main source's. It does not look
 * beside the file that names the include. Checked against vasm 1.9, and set out
 * in its documentation.
 */
export function vasmSearchDirectories(search: VasmSearch): string[] {
  const dirs = [search.cwd, search.mainDir];
  for (const path of [
    ...(search.includePaths ?? []),
    ...(search.incDirs ?? []),
  ]) {
    if (isAbsolute(path)) dirs.push(path);
    else dirs.push(resolve(search.cwd, path), resolve(search.mainDir, path));
  }
  return dirs.filter((dir, i) => dirs.indexOf(dir) === i);
}

/**
 * The file vasm would open for an include, or undefined if it would not find one.
 *
 * @param exists whether a file is there
 */
export function findVasmInclude(
  name: string,
  search: VasmSearch,
  exists: (path: string) => boolean,
): string | undefined {
  if (isAbsolute(name)) return exists(name) ? name : undefined;
  for (const dir of vasmSearchDirectories(search)) {
    const path = resolve(dir, name);
    if (exists(path)) return path;
  }
  return undefined;
}

/** The `-I` paths among vasm arguments, as written, in order. */
export function includeArguments(args: readonly string[]): string[] {
  const paths: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "-I" && args[i + 1] !== undefined) paths.push(args[++i]);
    else if (args[i].startsWith("-I") && args[i].length > 2)
      paths.push(args[i].slice(2));
  }
  return paths;
}
