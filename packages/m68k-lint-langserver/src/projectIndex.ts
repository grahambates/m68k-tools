import { readdir, readFile } from "node:fs/promises";
import { join, relative, extname } from "node:path";
import {
  buildProjectSymbols,
  buildProjectReferences,
  type ProjectSymbols,
  type ProjectReferences,
} from "m68k-lint";

/**
 * Constants a file uses but does not define live in an include somewhere else
 * in the project, and several rules go quiet without them; whether a global
 * label is referenced at all is the same kind of question, answered from the
 * same scan. The CLI indexes the tree once per run; a server has to keep that
 * index alive and drop it when the tree changes underneath.
 */

export interface ProjectIndex {
  symbols: ProjectSymbols;
  /** Undefined when nothing has asked for it yet -- see `ProjectIndexCache`. */
  references?: ProjectReferences;
}

const EXTENSIONS = new Set([".s", ".asm", ".a68", ".i", ".inc", ".h"]);
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "out",
  "dist",
  "build",
  ".vscode",
]);
/** A guard against indexing a home directory someone opened by accident. */
const MAX_FILES = 4000;

async function collect(
  root: string,
  dir: string,
  found: string[],
): Promise<void> {
  if (found.length >= MAX_FILES) return;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return; // An unreadable directory contributes nothing.
  }
  for (const entry of entries) {
    if (found.length >= MAX_FILES) return;
    if (entry.name.startsWith(".") && entry.name !== ".") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await collect(root, path, found);
    } else if (
      entry.isFile() &&
      EXTENSIONS.has(extname(entry.name).toLowerCase())
    ) {
      found.push(path);
    }
  }
}

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
): Promise<ProjectIndex | undefined> {
  const paths: string[] = [];
  await collect(root, root, paths);
  if (!paths.length) return undefined;

  const files: { path: string; source: string }[] = [];
  for (const path of paths) {
    const override = overrides.get(path);
    if (override !== undefined) {
      files.push({ path: relative(root, path) || path, source: override });
      continue;
    }
    try {
      files.push({
        path: relative(root, path) || path,
        source: await readFile(path, "utf8"),
      });
    } catch {
      // Unreadable files simply contribute nothing to the index.
    }
  }
  return {
    symbols: buildProjectSymbols(files),
    references: needsReferences ? buildProjectReferences(files) : undefined,
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

  get(
    root: string,
    overrides: ReadonlyMap<string, string>,
    needsReferences: boolean,
  ): Promise<ProjectIndex | undefined> {
    const cached = this.cache.get(root);
    if (cached && (!needsReferences || this.withReferences.has(root)))
      return cached;

    if (needsReferences) this.withReferences.add(root);
    const index = buildIndex(root, overrides, needsReferences);
    this.cache.set(root, index);
    return index;
  }

  clear(): void {
    this.cache.clear();
    this.withReferences.clear();
  }
}
