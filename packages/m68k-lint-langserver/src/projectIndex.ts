import { readFile } from "node:fs/promises";
import { relative } from "node:path";
import {
  buildProjectSymbols,
  buildProjectReferences,
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

  return {
    symbols: buildProjectSymbols(files, { caseSensitive }),
    references: needsReferences
      ? buildProjectReferences(files, { caseSensitive })
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
  private cache = new Map<string, Promise<ProjectIndex | undefined>>();
  private withReferences = new Set<string>();

  /**
   * One index per root, set of include paths and case mode: two configs under
   * one root can differ in any of them, and each must get an index built to
   * match, since the mode decides which names are the same name.
   */
  get(
    root: string,
    overrides: ReadonlyMap<string, string>,
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
    const cached = this.cache.get(key);
    if (cached && (!needsReferences || this.withReferences.has(key)))
      return cached;

    if (needsReferences) this.withReferences.add(key);
    const index = buildIndex(
      root,
      overrides,
      needsReferences,
      includes,
      caseSensitive,
    );
    this.cache.set(key, index);
    return index;
  }

  clear(): void {
    this.cache.clear();
    this.withReferences.clear();
  }
}
