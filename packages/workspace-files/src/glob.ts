import { minimatch } from "minimatch";

/**
 * Glob patterns pruned from a workspace walk by default.
 *
 * A build directory usually contains a second copy of every source file,
 * which would otherwise appear as a duplicate definition of every symbol, and
 * as a duplicate entry point for every program.
 */
export const defaultExclude = [
  "**/node_modules/**",
  "**/.git/**",
  "**/build/**",
  "**/out/**",
  "**/dist/**",
  "**/target/**",
];

/**
 * Whether a path should be treated as excluded.
 *
 * A directory is pruned only by a pattern that unambiguously covers its whole
 * subtree (`**\/name/**`), and never by a negated one: a glob can match a
 * folder's own name without proving every descendant is also excluded, and a
 * negated pattern cannot prove the opposite either, so neither is grounds to
 * stop descending. Both still apply normally to files.
 */
export function isExcluded(
  path: string,
  patterns: readonly string[],
  isDirectory = false,
): boolean {
  return patterns.some((pattern) => {
    if (isDirectory && (!pattern.endsWith("/**") || pattern.startsWith("!"))) {
      return false;
    }
    return minimatch(
      isDirectory ? `${path.replace(/\/$/, "")}/` : path,
      pattern,
      { dot: true },
    );
  });
}

/** Whether a slash-separated path matches a glob, dotfiles included. */
export function matchesGlob(path: string, pattern: string): boolean {
  return minimatch(path, pattern, { dot: true });
}
