import { readdir, readFile } from "node:fs/promises";
import { join, relative, extname } from "node:path";
import { buildProjectSymbols, type ProjectSymbols } from "m68k-lint";

/**
 * Constants a file uses but does not define live in an include somewhere else
 * in the project, and several rules go quiet without them. The CLI indexes the
 * tree once per run; a server has to keep that index alive and drop it when the
 * tree changes underneath.
 */

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
): Promise<ProjectSymbols | undefined> {
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
  return buildProjectSymbols(files);
}

/**
 * Caches one index per workspace root.
 *
 * Invalidation is deliberately whole-root rather than per-file: the symbol
 * table is built from every file at once, and a constant's value can depend on
 * expressions defined in another file, so there is no sound way to patch a
 * single file's entries back into an existing table.
 */
export class ProjectIndexCache {
  private cache = new Map<string, Promise<ProjectSymbols | undefined>>();

  get(
    root: string,
    overrides: ReadonlyMap<string, string>,
  ): Promise<ProjectSymbols | undefined> {
    let index = this.cache.get(root);
    if (!index) {
      index = buildIndex(root, overrides);
      this.cache.set(root, index);
    }
    return index;
  }

  clear(): void {
    this.cache.clear();
  }
}
