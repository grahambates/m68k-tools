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

export interface ResolvedInclude {
  /** The file found. */
  path: string;
  /** The directory it was found in. */
  dir: string;
  /**
   * `vasm` if the assembler would find it there, `fallback` if only the
   * forgiving lookup did: a file vasm would not open from here.
   */
  via: "vasm" | "fallback";
}

/**
 * Find the file an include names, as vasm would and, failing that, more
 * forgivingly.
 *
 * vasm's own search comes first, so what is found is what the assembler opens.
 * Where the tools cannot know the inputs to it (which file is the main source,
 * where it is run from), more than one search may be given and each is tried
 * in turn. If none finds it, `fallbackDirs` are tried, such as the directory of
 * the including file: finding a file vasm would not is harmless for reading
 * what it defines or for navigating to it, and losing one vasm would find is
 * not, but the result says which it was so a caller can tell the user.
 *
 * @param find the file `name` is under `dir`, if there is one, as the caller's
 *   file system has it
 */
export async function resolveInclude(
  name: string,
  searches: readonly VasmSearch[],
  fallbackDirs: readonly string[] = [],
  find: (
    dir: string,
    name: string,
  ) => string | undefined | Promise<string | undefined>,
): Promise<ResolvedInclude | undefined> {
  // A directory that was looked in already, by an earlier search, has nothing more.
  const tried = new Set<string>();
  const attempt = async (
    dirs: readonly string[],
    via: ResolvedInclude["via"],
  ) => {
    for (const dir of dirs) {
      if (tried.has(dir)) continue;
      tried.add(dir);
      const path = await find(dir, name);
      if (path !== undefined) return { path, dir, via } as const;
    }
    return undefined;
  };
  for (const search of searches) {
    const found = await attempt(vasmSearchDirectories(search), "vasm");
    if (found) return found;
  }
  return attempt(fallbackDirs, "fallback");
}
