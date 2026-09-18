import { URI } from "vscode-uri";
import { defaultExclude, isExcluded } from "@m68k-lsp/workspace-files";

import type DocumentProcessor from "./DocumentProcessor";
import { getAsmFilesInDir } from "./files";
import { type Context } from "./context";

export { defaultExclude };

/**
 * Whether a workspace path should be skipped while indexing.
 *
 * The pattern matching itself -- which glob wins, and why a directory needs a
 * whole-subtree pattern rather than any match -- is shared with the linter's
 * own language server; this just adds this server's own config on top of the
 * built-in defaults.
 */
export function isIndexExcluded(
  uri: string,
  ctx: Context,
  isDirectory = false,
): boolean {
  const path = URI.parse(uri).fsPath;
  return isExcluded(
    path,
    [...defaultExclude, ...ctx.config.exclude],
    isDirectory,
  );
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
