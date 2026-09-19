import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { parseFile } from "m68k-parser";

/** What following includes needs from a file system, so a caller can supply its own. */
export interface IncludeFs {
  /** The text of a file, or undefined if it cannot be read. */
  read(path: string): Promise<string | undefined>;
  /**
   * The path of `name` (which may be `dir/file.i`) under `dir`, or undefined if
   * there is no such file. Case is the file system's business: one that ignores
   * it finds a name in either case, as the assembler run on it would, and one
   * that does not finds only the exact name, as the assembler run on it would.
   */
  find(dir: string, name: string): Promise<string | undefined>;
  /** The names in a directory, as the file system spells them. Needed to check case. */
  list?(dir: string): Promise<readonly string[]>;
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/**
 * Node's file system for following includes.
 *
 * Names are looked up as the operating system looks them up, so an include in
 * the wrong case resolves on macOS and Windows and not on Linux, which is what
 * assembling the project there would do. Folding case here would make the linter
 * accept a project that does not build on a case-sensitive machine.
 *
 * @param overrides text to use for a path instead of what is on disk, such as
 *   the unsaved contents of open editors
 */
export function nodeIncludeFs(
  overrides: ReadonlyMap<string, string> = new Map(),
): IncludeFs {
  const listings = new Map<string, Promise<string[]>>();
  return {
    list(dir) {
      let listing = listings.get(dir);
      if (!listing) {
        listing = readdir(dir).catch(() => []);
        listings.set(dir, listing);
      }
      return listing;
    },
    async read(path) {
      const open = overrides.get(path);
      if (open !== undefined) return open;
      try {
        return await readFile(path, "utf8");
      } catch {
        return undefined;
      }
    },
    async find(dir, name) {
      const path = resolve(dir, name);
      return (await isFile(path)) || overrides.has(path) ? path : undefined;
    },
  };
}

export interface IncludedFile {
  /** Absolute path. */
  path: string;
  source: string;
}

export interface FollowOptions {
  /** Directories the assembler is given to search for includes, absolute. */
  includePaths: readonly string[];
  fs: IncludeFs;
  /** Most files to add, a guard against an include that reaches a whole tree. Default 4000. */
  limit?: number;
}

/** The paths named by directives like `include` in a source, as written. */
function pathsIn(source: string, directives: readonly string[]): string[] {
  let parsed;
  try {
    parsed = parseFile(source);
  } catch {
    return [];
  }
  const names: string[] = [];
  for (const line of parsed.lines) {
    if (line.mnemonic?.type !== "directive") continue;
    if (!directives.includes(line.mnemonic.directive.toLowerCase())) continue;
    const operand = line.operands?.[0];
    if (operand?.type === "string-literal" && operand.content)
      names.push(operand.content);
  }
  return names;
}

/**
 * The files a set of sources include that are not among them, and everything
 * those include in turn.
 *
 * Each `include` is looked for beside the file that names it, then in each of
 * the include paths in order, as an assembler given them with `-I` would. That is
 * how a project reaches includes outside its own tree, such as NDK files shared
 * between projects: nothing in the source says where they are, and the paths are
 * given to the assembler instead.
 *
 * An include that cannot be found is skipped, and so is one already known, which
 * also ends a cycle. Only the added files are returned, in the order found.
 *
 * @param sources absolute path and text of each file already in hand
 */
export async function followIncludes(
  sources: readonly IncludedFile[],
  options: FollowOptions,
): Promise<IncludedFile[]> {
  const limit = options.limit ?? 4000;
  const known = new Set(sources.map((file) => resolve(file.path)));
  const added: IncludedFile[] = [];
  const queue = [...sources];

  for (let next = 0; next < queue.length; next++) {
    const file = queue[next];
    for (const name of pathsIn(file.source, ["include"])) {
      if (added.length >= limit) return added;
      for (const dir of [dirname(file.path), ...options.includePaths]) {
        const found = await options.fs.find(dir, name);
        if (found === undefined) continue;
        const path = resolve(found);
        if (!known.has(path)) {
          known.add(path);
          const source = await options.fs.read(path);
          if (source !== undefined) {
            const included = { path, source };
            added.push(included);
            queue.push(included);
          }
        }
        // First place that has it, as an assembler's search order does.
        break;
      }
    }
  }
  return added;
}

/**
 * What each include a source names is called on disk, where that differs from
 * how the source writes it.
 *
 * On a file system that ignores case, `include "Exec/Types.i"` finds
 * `exec/types.i` and the assembler says nothing, but the same project on a
 * case-sensitive one does not build. Such an include resolves here and is
 * spelled differently there, and this is what tells them apart. `INCBIN`, which
 * names a data file the same way, is included.
 *
 * The answer is a map from the path as written to the path as it is on disk,
 * holding only the ones that differ. It is empty where the file system cannot list
 * directories, and for anything that does not resolve at all, which is the
 * assembler's to report.
 */
export async function includeCaseOnDisk(
  file: IncludedFile,
  options: FollowOptions,
): Promise<Map<string, string>> {
  const differing = new Map<string, string>();
  const { fs } = options;
  if (!fs.list) return differing;

  for (const name of pathsIn(file.source, ["include", "incbin"])) {
    if (differing.has(name)) continue;
    for (const dir of [dirname(file.path), ...options.includePaths]) {
      if ((await fs.find(dir, name)) === undefined) continue;

      // Walk the name a segment at a time, taking each as the directory has it.
      const parts = name.split(/([\\/]+)/);
      let current = dir;
      let actual = "";
      for (const [index, part] of parts.entries()) {
        if (index % 2 === 1 || part === "" || part === "." || part === "..") {
          actual += part;
          if (index % 2 === 0) current = resolve(current, part);
          continue;
        }
        const entries = (await fs.list(current)) ?? [];
        const match = entries.includes(part)
          ? part
          : entries.find((entry) => entry.toLowerCase() === part.toLowerCase());
        if (match === undefined) {
          actual = "";
          break;
        }
        actual += match;
        current = join(current, match);
      }
      if (actual && actual !== name) differing.set(name, actual);
      break;
    }
  }
  return differing;
}
