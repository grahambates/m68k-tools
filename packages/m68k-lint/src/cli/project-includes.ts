import { readFile, readdir, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { parseFile } from "m68k-parser";
import {
  resolveInclude,
  type ResolvedInclude,
} from "@m68k-lsp/assembly-options";

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

/**
 * Lets other work run. Following the includes of thousands of files is mostly
 * parsing and looking things up in memory, with nothing to wait on, so without
 * this it is one stretch that a server cannot answer anything during.
 */
const YIELD_EVERY = 50;
const yieldNow = () => new Promise<void>((resolve) => setImmediate(resolve));

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
  // The same name is looked for in the same directory from many files, and each
  // lookup is a system call. Nothing changes on disk while one file system is in
  // use, so a lookup is made once.
  const finds = new Map<string, Promise<string | undefined>>();

  // Most lookups are misses: an include is tried in every directory the search
  // reaches, and in a project of many main sources that is a great many, each
  // a system call. A directory is read once instead, and a name that is in no
  // entry of it, whatever the case, cannot be a file there. That holds on a
  // file system that ignores case and on one that does not, so it decides
  // nothing about case: anything that might be there is still asked of the
  // file system itself.
  const folded = new Map<string, Promise<Set<string>>>();
  const fold = (name: string) => name.normalize("NFC").toLowerCase();
  const namesIn = (dir: string) => {
    let names = folded.get(dir);
    if (!names) {
      names = (async () => new Set((await list(dir)).map(fold)))();
      folded.set(dir, names);
    }
    return names;
  };
  const list = (dir: string) => {
    let listing = listings.get(dir);
    if (!listing) {
      listing = readdir(dir).catch(() => []);
      listings.set(dir, listing);
    }
    return listing;
  };
  const lookUp = async (path: string): Promise<string | undefined> => {
    if (overrides.has(path)) return path;
    if (!(await namesIn(dirname(path))).has(fold(basename(path))))
      return undefined;
    return (await isFile(path)) ? path : undefined;
  };
  return {
    list,
    async read(path) {
      const open = overrides.get(path);
      if (open !== undefined) return open;
      try {
        return await readFile(path, "utf8");
      } catch {
        return undefined;
      }
    },
    find(dir, name) {
      const path = resolve(dir, name);
      let found = finds.get(path);
      if (!found) {
        found = lookUp(path);
        finds.set(path, found);
      }
      return found;
    },
  };
}

export interface IncludedFile {
  /** Absolute path. */
  path: string;
  source: string;
}

/** Where vasm is run and given to look, the part of the search the config decides. */
export interface IncludeSearchOptions {
  /**
   * The directory the assembler is run from, absolute, where the config says. It
   * looks there first, and a relative `-I` or `incdir` is tried from there.
   */
  sourceRoot?: string;
  /** Directories the assembler is given to search for includes with `-I`, as written. */
  includePaths: readonly string[];
}

export interface FollowOptions extends IncludeSearchOptions {
  fs: IncludeFs;
  /** Most files to add, a guard against an include that reaches a whole tree. Default 4000. */
  limit?: number;
}

/** The directives in a source that name a file or directory to search, as written. */
interface Names {
  include: string[];
  incdir: string[];
  incbin: string[];
}

/** What the directives of a source name, parsing each source once however often it is asked. */
function scanner() {
  const cache = new Map<string, Names>();
  return (source: string): Names => {
    const known = cache.get(source);
    if (known) return known;
    const names: Names = { include: [], incdir: [], incbin: [] };
    try {
      for (const line of parseFile(source).lines) {
        if (line.mnemonic?.type !== "directive") continue;
        const directive = line.mnemonic.directive.toLowerCase();
        const operand = line.operands?.[0];
        if (
          directive in names &&
          operand?.type === "string-literal" &&
          operand.content
        )
          names[directive as keyof Names].push(operand.content);
      }
    } catch {
      // A source that does not parse names nothing.
    }
    cache.set(source, names);
    return names;
  };
}

/** What a search needs beyond the config: which files are main sources and what `incdir` adds. */
interface SearchContext extends FollowOptions {
  namesOf: (source: string) => Names;
  /** The directories of the main sources, which vasm also looks in. */
  entryDirs: readonly string[];
  /** The `incdir`s in the sources, as written and in order. */
  incDirs: readonly string[];
  /** Answers already worked out, so an include named by many files is looked for once. */
  answers?: Map<string, Promise<ResolvedInclude | undefined>>;
}

/**
 * The file an include names, from where vasm looks and then, failing that,
 * beside the file that names it.
 *
 * vasm looks in the directory it is run in, then the main source's, then the
 * `-I` paths and `incdir`s, and never beside the including file. The main source
 * is not known here, so each candidate is tried in turn; the including file's
 * own directory is a fallback, since finding a file vasm would not is harmless
 * for reading what it defines.
 */
async function resolveFor(
  file: IncludedFile,
  name: string,
  search: SearchContext,
): Promise<ResolvedInclude | undefined> {
  const beside = dirname(file.path);
  const find = (dir: string, included: string) => search.fs.find(dir, included);
  const remember = (
    key: string,
    work: () => Promise<ResolvedInclude | undefined>,
  ) => {
    const answers = (search.answers ??= new Map<
      string,
      Promise<ResolvedInclude | undefined>
    >());
    let answer = answers.get(key);
    if (!answer) {
      answer = work();
      answers.set(key, answer);
    }
    return answer;
  };

  // vasm's own search does not depend on which file names the include when the
  // main sources are known, only on the name. With a project of many main
  // sources it tries a directory for each, so it is worth doing once. The
  // `incdir`s grow as files are reached, so what was found before one was seen
  // is not reused after.
  const mains = search.entryDirs.length ? search.entryDirs : [beside];
  const vasm = await remember(
    `vasm\0${search.incDirs.length}\0${search.entryDirs.length ? "" : beside}\0${name}`,
    () =>
      resolveInclude(
        name,
        mains.map((mainDir) => ({
          cwd: search.sourceRoot ?? mainDir,
          mainDir,
          includePaths: search.includePaths,
          incDirs: search.incDirs,
        })),
        [],
        find,
      ),
  );
  if (vasm) return vasm;
  // Failing that, beside the file that names it, which is the one part that
  // does depend on the file.
  return remember(`beside\0${beside}\0${name}`, () =>
    resolveInclude(name, [], [beside], find),
  );
}

/**
 * The directories of the main sources among these: the files nothing else
 * includes.
 *
 * vasm looks for an include in the directory it is run from, then in the
 * directory of the main source being assembled, then the include paths. It
 * never looks beside the file that names the include, so a file two levels
 * down that includes something next to the main source finds it there and not
 * beside itself. Nothing in the project says which file is the main source, so
 * it is worked out: a file none of the others includes is one.
 */
export async function entryDirectories(
  sources: readonly IncludedFile[],
  options: FollowOptions,
): Promise<string[]> {
  return entriesOf(sources, {
    ...options,
    namesOf: scanner(),
    entryDirs: [],
    incDirs: [],
  });
}

async function entriesOf(
  sources: readonly IncludedFile[],
  search: SearchContext,
): Promise<string[]> {
  const included = new Set<string>();
  let read = 0;
  for (const file of sources) {
    if (++read % YIELD_EVERY === 0) await yieldNow();
    for (const name of search.namesOf(file.source).include) {
      const found = await resolveFor(file, name, search);
      if (found) included.add(resolve(found.path));
    }
  }
  const dirs: string[] = [];
  for (const file of sources) {
    const dir = dirname(resolve(file.path));
    if (!included.has(resolve(file.path)) && !dirs.includes(dir))
      dirs.push(dir);
  }
  return dirs;
}

/**
 * The files a set of sources include that are not among them, and everything
 * those include in turn.
 *
 * Each `include` is found as vasm finds it: in the directory it is run in, the
 * directory of the main source, the include paths and any `incdir`, and failing
 * that beside the file that names it. That is how a project reaches includes
 * outside its own tree, such as NDK files shared between projects: nothing in
 * the source says where they are, and the paths are given to the assembler
 * instead.
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
  const namesOf = scanner();
  const entryDirs = await entriesOf(sources, {
    ...options,
    namesOf,
    entryDirs: [],
    incDirs: [],
  });
  // The `incdir`s, gathered from every file as it is reached.
  const incDirs: string[] = [];
  const addIncDirs = (file: IncludedFile) => {
    for (const name of namesOf(file.source).incdir)
      if (!incDirs.includes(name)) incDirs.push(name);
  };
  sources.forEach(addIncDirs);
  const search: SearchContext = { ...options, namesOf, entryDirs, incDirs };

  const limit = options.limit ?? 4000;
  const known = new Set(sources.map((file) => resolve(file.path)));
  const added: IncludedFile[] = [];
  const queue = [...sources];
  for (let next = 0; next < queue.length; next++) {
    if (next % YIELD_EVERY === 0) await yieldNow();
    const file = queue[next];
    for (const name of namesOf(file.source).include) {
      if (added.length >= limit) return added;
      const found = await resolveFor(file, name, search);
      if (!found) continue;
      const path = resolve(found.path);
      if (known.has(path)) continue;
      known.add(path);
      const source = await options.fs.read(path);
      if (source === undefined) continue;
      const included = { path, source };
      added.push(included);
      queue.push(included);
      addIncDirs(included);
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

  // The file is taken as a main source, with what it adds itself with `incdir`.
  const namesOf = scanner();
  const names = namesOf(file.source);
  const search: SearchContext = {
    ...options,
    namesOf,
    entryDirs: [],
    incDirs: names.incdir,
  };

  for (const name of [...names.include, ...names.incbin]) {
    if (differing.has(name)) continue;
    const resolved = await resolveFor(file, name, search);
    if (!resolved) continue;
    const dir = resolved.dir;

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
  }
  return differing;
}
