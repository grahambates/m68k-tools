import { readFile } from "node:fs/promises";
import { relative } from "node:path";
import {
  buildProjectSymbolsAsync,
  buildProjectReferencesAsync,
  type ProjectSymbols,
  type ProjectReferences,
} from "m68k-lint";
import {
  followIncludes,
  type IncludeSearchOptions,
  nodeIncludeFs,
  type IncludedFile,
} from "m68k-lint/project-config";
import { discoverAssemblyFiles } from "@m68k-lsp/workspace-files";
import { RefreshingCache } from "./refreshingCache.js";

/**
 * Constants a file uses but does not define live in an include somewhere else
 * in the project, and several rules go quiet without them; whether a global
 * label is referenced at all is the same kind of question, answered from the
 * same scan. The CLI indexes the tree once per run; a server has to keep that
 * index alive and drop it when the tree changes underneath.
 *
 * The walk itself -- which directories to skip, which extensions count as
 * assembly source -- is shared with the assembly language server, rather than
 * this package keeping its own copy.
 */

export interface ProjectIndex {
  symbols: ProjectSymbols;
  /** Undefined when nothing has asked for it yet -- see `ProjectIndexCache`. */
  references?: ProjectReferences;
}

/**
 * Wider than the assembly server's own default: headers are often excluded
 * from linting but are exactly where constants and cross-file XDEF/XREF pairs
 * live, so `.inc`/`.h`/`.a68` count here even though they would not for
 * symbol indexing.
 */
const EXTENSIONS = [".s", ".asm", ".a68", ".i", ".inc", ".h"];
/** A guard against indexing a home directory someone opened by accident. */
const MAX_FILES = 4000;

/**
 * Indexes one workspace root.
 *
 * `overrides` carries the open documents' unsaved text, so a constant the user
 * just typed into an include resolves before they save it.
 */
export async function buildIndex(
  root: string,
  overrides: ReadonlyMap<string, string>,
  needsReferences: boolean,
  includes: IncludeSearchOptions = { includePaths: [] },
  caseSensitive = true,
): Promise<ProjectIndex | undefined> {
  const paths = await discoverAssemblyFiles(root, {
    extensions: EXTENSIONS,
    limit: MAX_FILES,
  });
  if (!paths.length) return undefined;

  const files: { path: string; source: string }[] = [];
  const read: IncludedFile[] = [];
  for (const path of paths) {
    const override = overrides.get(path);
    if (override !== undefined) {
      files.push({ path: relative(root, path) || path, source: override });
      read.push({ path, source: override });
      continue;
    }
    try {
      const source = await readFile(path, "utf8");
      files.push({ path: relative(root, path) || path, source });
      read.push({ path, source });
    } catch {
      // Unreadable files simply contribute nothing to the index.
    }
  }

  // What the project includes from outside its tree, found beside the files or
  // through the config's include paths. Read for what it defines, never linted.
  const included = await followIncludes(read, {
    ...includes,
    fs: nodeIncludeFs(overrides),
  });
  for (const { path, source } of included)
    files.push({ path: relative(root, path) || path, source });

  // Each of these is seconds of work on a large project, so they let the server
  // answer other requests as they go instead of blocking it until they finish.
  return {
    symbols: await buildProjectSymbolsAsync(files, { caseSensitive }),
    references: needsReferences
      ? await buildProjectReferencesAsync(files, { caseSensitive })
      : undefined,
  };
}

/**
 * Caches one index per workspace root.
 *
 * Invalidation is deliberately whole-root rather than per-file: the symbol
 * table is built from every file at once, and a constant's value can depend on
 * expressions defined in another file, so there is no sound way to patch a
 * single file's entries back into an existing table.
 *
 * `needsReferences` is decided per document (from that document's own resolved
 * config), but the cache is shared across every document under one root, so a
 * `false` from an early caller must never stick and starve a later one that
 * asks for references: this tracks which roots have been built with them and
 * rebuilds -- once -- the first time a document actually needs them. It never
 * downgrades back, since a root already carrying references costs nothing
 * extra to keep serving to a document that does not need them.
 */
export class ProjectIndexCache {
  private readonly indexes: RefreshingCache<ProjectIndex | undefined>;
  private withReferences = new Set<string>();

  /**
   * @param onRefreshed called when an index that was out of date has been
   *   replaced, so what was worked out from the old one can be done again
   * @param quietMs how long after the last `invalidate` the rebuild starts
   */
  constructor(onRefreshed: () => void = () => {}, quietMs?: number) {
    this.indexes = new RefreshingCache({ onRefreshed, quietMs });
  }

  /**
   * One index per root, set of include paths and case mode: two configs under
   * one root can differ in any of them, and each must get an index built to
   * match, since the mode decides which names are the same name.
   *
   * An index that has been `invalidate`d is still returned, and rebuilt in the
   * background once things have been quiet for a while. `overrides` may be a
   * function so that a rebuild that starts later reads the open documents as
   * they are then, not as they were when it was asked for.
   */
  get(
    root: string,
    overrides:
      ReadonlyMap<string, string> | (() => ReadonlyMap<string, string>),
    needsReferences: boolean,
    includes: IncludeSearchOptions = { includePaths: [] },
    caseSensitive = true,
  ): Promise<ProjectIndex | undefined> {
    const key = [
      root,
      caseSensitive ? "case" : "nocase",
      includes.sourceRoot ?? "",
      ...includes.includePaths,
    ].join("\0");
    const build = (withReferences: boolean) =>
      buildIndex(
        root,
        typeof overrides === "function" ? overrides() : overrides,
        withReferences,
        includes,
        caseSensitive,
      );

    // Wanted now and not there: the caller is waiting for this one.
    if (needsReferences && !this.withReferences.has(key)) {
      this.withReferences.add(key);
      return this.indexes.set(key, () => build(true));
    }
    return this.indexes.get(key, () => build(this.withReferences.has(key)));
  }

  /** Everything is out of date, not wrong: keep serving it while it is rebuilt. */
  invalidate(): void {
    this.indexes.invalidate();
  }

  /** Everything is wrong: serve none of it. */
  clear(): void {
    this.indexes.clear();
    this.withReferences.clear();
  }
}
