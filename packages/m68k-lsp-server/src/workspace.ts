import { minimatch } from "minimatch";
import { URI } from "vscode-uri";

import type DocumentProcessor from "./DocumentProcessor";
import { getAsmFilesInDir } from "./files";
import { type Context } from "./context";

/**
 * Directories that hold copies of the sources rather than sources.
 *
 * A build directory usually contains a second copy of every file, which would
 * otherwise appear as a second definition of every symbol, and as a second
 * entry point for every program.
 */
export const defaultExclude = [
  "**/node_modules/**",
  "**/.git/**",
  "**/build/**",
  "**/out/**",
  "**/dist/**",
  "**/target/**",
];

export function isIndexExcluded(
  uri: string,
  ctx: Context,
  isDirectory = false,
): boolean {
  const path = URI.parse(uri).fsPath;
  return [...defaultExclude, ...ctx.config.exclude].some((pattern) => {
    // Prune only explicit subtree exclusions. A file glob can match a folder
    // name without excluding its children; negated globs cannot prove that
    // every descendant is excluded either.
    if (isDirectory && (!pattern.endsWith("/**") || pattern.startsWith("!"))) {
      return false;
    }
    return minimatch(
      isDirectory ? path.replace(/\/$/, "") + "/" : path,
      pattern,
      { dot: true },
    );
  });
}

/**
 * Index every assembly file in the workspace.
 *
 * Resolution is only as complete as the set of files it knows about: without
 * this, a symbol's references are whichever ones happen to have been opened,
 * so results change as tabs are opened. Indexing keeps symbols and include
 * edges but discards syntax trees, which is what makes covering a whole
 * workspace affordable.
 *
 * Runs to completion in the background. Requests arriving while it is still
 * going see whatever has been indexed so far, which is no worse than the
 * lazily populated store they saw before.
 */
export async function indexWorkspace(
  ctx: Context,
  processor: DocumentProcessor,
): Promise<number> {
  const started = Date.now();
  let indexed = 0;

  for (const folder of ctx.workspaceFolders) {
    const uris = await getAsmFilesInDir(folder.uri, (uri, isDirectory) =>
      isIndexExcluded(uri, ctx, isDirectory),
    );
    for (const uri of uris) {
      if (isIndexExcluded(uri, ctx)) {
        continue;
      }
      if (ctx.store.has(uri)) {
        continue;
      }
      try {
        if (await processor.index(uri)) {
          indexed++;
        }
      } catch (err) {
        ctx.logger.warn(`Failed to index ${uri}: ${String(err)}`);
      }
    }
  }

  ctx.logger.info(`Indexed ${indexed} file(s) in ${Date.now() - started}ms`);
  return indexed;
}
