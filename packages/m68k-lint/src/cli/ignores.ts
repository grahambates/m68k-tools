import { matchesGlob } from "@m68k-lsp/workspace-files";

/** Never linted and never indexed, whatever the project config says. */
export const alwaysIgnored: readonly string[] = ["node_modules/**", ".git/**"];

/**
 * Whether a path is left out of linting by ignore patterns.
 *
 * @param relativePath slash-separated, relative to the directory the patterns
 *   are relative to: the project config's, or where the CLI was run
 * @param patterns the project's `ignores`; the always-ignored ones are added
 */
export function isIgnored(
  relativePath: string,
  patterns: readonly string[],
): boolean {
  return [...alwaysIgnored, ...patterns].some((pattern) =>
    matchesGlob(relativePath, pattern.replace(/^\.\//, "")),
  );
}
