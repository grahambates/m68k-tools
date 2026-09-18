import { promises as fsp } from "node:fs";
import { extname, join } from "node:path";
import { defaultExclude, isExcluded } from "./glob.js";

export const defaultExtensions = [".s", ".asm", ".i"];

export function isAssemblySource(
  path: string,
  extensions: readonly string[] = defaultExtensions,
): boolean {
  return extensions.includes(extname(path).toLowerCase());
}

export interface WalkOptions {
  /** Whether a file's path counts as a result. */
  include: (path: string) => boolean;
  /** Whether a directory's contents are skipped entirely. */
  prune?: (path: string) => boolean;
  /** Stop once this many results have been found. */
  limit?: number;
}

/**
 * Recursively collect files under `root` matching `include`, skipping a
 * directory outright where `prune` says to.
 *
 * Kept low-level and predicate-driven rather than opinionated about excludes
 * or extensions, because not every caller wants the same defaults applied: a
 * file-rename operation wants every matching file in a directory
 * unconditionally, while indexing a workspace wants the usual excludes and a
 * cap on how much it will walk. `discoverAssemblyFiles` below is the
 * opinionated default for that second, far more common case.
 *
 * An unreadable directory, at any depth, contributes nothing rather than
 * failing the whole walk: a permissions error or a race with a delete should
 * not stop everything else in the workspace from being found.
 */
export async function walkFiles(
  root: string,
  options: WalkOptions,
): Promise<string[]> {
  const found: string[] = [];
  const atLimit = () =>
    options.limit !== undefined && found.length >= options.limit;

  const visit = async (dir: string): Promise<void> => {
    if (atLimit() || options.prune?.(dir)) return;
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (atLimit()) return;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isFile() && options.include(path)) {
        found.push(path);
      }
    }
  };

  await visit(root);
  return found;
}

export interface DiscoverOptions {
  /** Extensions counted as assembly source, each including its leading dot. */
  extensions?: readonly string[];
  /** Glob patterns pruned from the walk. */
  exclude?: readonly string[];
  /** Stop once this many files have been found, as a guard against an unexpectedly large tree. */
  limit?: number;
}

/**
 * Find every assembly source file under a directory, with the exclusions a
 * workspace index wants applied.
 */
export async function discoverAssemblyFiles(
  root: string,
  options: DiscoverOptions = {},
): Promise<string[]> {
  const extensions = options.extensions ?? defaultExtensions;
  const exclude = options.exclude ?? defaultExclude;

  const files = await walkFiles(root, {
    prune: (dir) => isExcluded(dir, exclude, true),
    include: (path) =>
      isAssemblySource(path, extensions) && !isExcluded(path, exclude),
    limit: options.limit,
  });

  return files.sort((a, b) => a.localeCompare(b));
}
