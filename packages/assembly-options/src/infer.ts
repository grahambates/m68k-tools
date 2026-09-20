import { sep } from "node:path";

/** A directory that would make some unresolved includes resolve. */
export interface InferredDirectory {
  /** Absolute. */
  dir: string;
  /** The include names, as written, that it resolves. */
  names: string[];
  /**
   * What it is likely to be: `sourceRoot` if it is a directory the project is
   * built from, `includePath` if it is a directory of includes. From vasm's
   * point of view they are the same, since it finds the file either way.
   */
  kind: "sourceRoot" | "includePath";
}

export interface InferOptions {
  /**
   * Directories the project is built from or lives in, such as the workspace
   * folders and the directories of the main sources. A candidate that is one of
   * them, or holds one, is more likely a source root than a directory of includes.
   */
  roots?: readonly string[];
}

const toPosix = (path: string) =>
  sep === "\\" ? path.replaceAll("\\", "/") : path;

/**
 * Guess where includes that did not resolve are meant to be found.
 *
 * Nothing in the source says which directory the assembler was run from, or
 * which include paths it was given. But an `include "lib/defs.i"` that does not
 * resolve names a path, and if the project has a file ending in `lib/defs.i`,
 * the directory in front of that suffix is where the assembler was looking.
 * Whether that was the directory it ran in or one of its `-I` paths makes no
 * difference to finding the file, so both come out the same.
 *
 * Directories are chosen greedily by how many of the names they resolve. A name
 * that could be resolved in more than one way, by files in different places, is
 * only taken where one directory clearly resolves more, and a bare name with no
 * directory in it is only taken when a single file has that name: both are too
 * likely to be a guess at the wrong file.
 *
 * @param unresolved include names, as written
 * @param files absolute paths of the files the project has
 */
export function inferSearchDirectories(
  unresolved: readonly string[],
  files: readonly string[],
  options: InferOptions = {},
): InferredDirectory[] {
  const posixFiles = files.map(toPosix);
  const roots = (options.roots ?? []).map(toPosix);

  // Candidate directories for each name.
  const candidates = new Map<string, Set<string>>();
  for (const written of new Set(unresolved)) {
    const name = toPosix(written).replace(/^\.\//, "");
    // A name that climbs out of a directory says where it is relative to, not
    // what it is called, so there is no suffix to look for.
    if (!name || name.startsWith("/") || name.split("/").includes(".."))
      continue;
    const suffix = `/${name}`;
    const dirs = new Set<string>();
    for (const file of posixFiles) {
      if (file.endsWith(suffix)) dirs.add(file.slice(0, -suffix.length) || "/");
    }
    if (!name.includes("/") && dirs.size !== 1) continue;
    if (dirs.size) candidates.set(written, dirs);
  }

  const result: InferredDirectory[] = [];
  const remaining = new Map(candidates);
  while (remaining.size) {
    const tally = new Map<string, string[]>();
    for (const [name, dirs] of remaining)
      for (const dir of dirs) tally.set(dir, [...(tally.get(dir) ?? []), name]);

    const ranked = [...tally.entries()].sort(
      (a, b) =>
        b[1].length - a[1].length ||
        a[0].length - b[0].length ||
        a[0].localeCompare(b[0]),
    );
    const [best, next] = ranked;
    if (!best) break;
    // Two directories that resolve the same number of names: a guess between them
    // would as likely be wrong, unless they are for different names altogether.
    if (next && next[1].length === best[1].length) {
      const same = best[1].some((name) => next[1].includes(name));
      if (same) {
        for (const name of best[1]) remaining.delete(name);
        continue;
      }
    }
    const [dir, names] = best;
    const isRoot = roots.some(
      (root) => root === dir || root.startsWith(`${dir}/`),
    );
    result.push({
      dir,
      names,
      kind: isRoot ? "sourceRoot" : "includePath",
    });
    for (const name of names) remaining.delete(name);
  }
  return result;
}
