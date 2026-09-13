import { IndexChangedNotification } from "@m68k-lsp/protocol";
import * as lsp from "vscode-languageserver";
import type { FileOperationFilter } from "vscode-languageserver-protocol/lib/common/protocol.fileOperations";
import { type Definition, type Symbols } from "../symbols";

import { type Provider } from ".";
import { type Context } from "../context";
import DocumentProcessor, { isProcessed } from "../DocumentProcessor";
import { getAsmFilesInDir, isAsmExt, isDir } from "../files";
import { isIndexExcluded } from "../workspace";
import { TextDocument } from "vscode-languageserver-textdocument";

export default class FileOperationsProvider implements Provider {
  constructor(protected readonly ctx: Context) {}

  private fileDeletesMap: Map<string, Set<string>> = new Map();

  async onWillDeleteFiles({ files }: lsp.DeleteFilesParams): Promise<null> {
    for (const { uri } of files) {
      let fileDeletes = this.fileDeletesMap.get(uri);
      if (!fileDeletes) {
        fileDeletes = new Set<string>();
        this.fileDeletesMap.set(uri, fileDeletes);
      }

      if (await isDir(uri)) {
        for (const childUri of await getAsmFilesInDir(uri)) {
          fileDeletes.add(childUri);
        }
      } else if (isAsmExt(uri)) {
        fileDeletes.add(uri);
      }
    }
    return null;
  }

  async onDidDeleteFiles({ files }: lsp.DeleteFilesParams): Promise<null> {
    const processor = new DocumentProcessor(this.ctx);
    for (const { uri } of files) {
      // didDelete may arrive without willDelete (for example from another client).
      const deleted = new Set([
        uri,
        ...(this.fileDeletesMap.get(uri) ?? []),
        ...Array.from(
          new Set([
            ...this.ctx.store.keys(),
            ...this.ctx.documentUpdates.keys(),
          ]),
        ).filter((key) => key.startsWith(uri.replace(/\/$/, "") + "/")),
      ]);
      for (const deleteUri of deleted) {
        processor.remove(deleteUri, false);
        if (!isProcessed(this.ctx.store.get(deleteUri))) {
          this.ctx.connection.sendDiagnostics({
            uri: deleteUri,
            diagnostics: [],
          });
        }
      }
      this.fileDeletesMap.delete(uri);
    }
    this.ctx.connection.sendNotification(IndexChangedNotification);
    return null;
  }

  async onDidCreateFiles({ files }: lsp.CreateFilesParams): Promise<null> {
    await this.onDidChangeWatchedFiles({
      changes: files.map(({ uri }) => ({
        uri,
        type: lsp.FileChangeType.Created,
      })),
    });
    return null;
  }

  async onDidChangeWatchedFiles({
    changes,
  }: lsp.DidChangeWatchedFilesParams): Promise<void> {
    const processor = new DocumentProcessor(this.ctx);
    // Editors may report several events for one save; process the final state.
    const latest = new Map(changes.map((change) => [change.uri, change.type]));
    let changed = false;
    for (const [uri, type] of latest) {
      if (
        !this.ctx.store.has(uri) &&
        (!isAsmExt(uri) || isIndexExcluded(uri, this.ctx))
      ) {
        continue;
      }
      changed = true;
      if (type === lsp.FileChangeType.Deleted) {
        processor.remove(uri);
        if (!isProcessed(this.ctx.store.get(uri))) {
          this.ctx.connection.sendDiagnostics({ uri, diagnostics: [] });
        }
      } else {
        await processor.index(uri);
      }
    }
    if (changed) {
      await processor.refreshIncludes();
      this.ctx.connection.sendNotification(IndexChangedNotification);
    }
  }

  async onDidRenameFiles({ files }: lsp.RenameFilesParams): Promise<null> {
    const fileRenames = await this.adaptFolderRenames(files);

    for (const file of fileRenames) {
      this.ctx.logger.info(`renaming ${file.oldUri} to ${file.newUri}`);
      this.ctx.documentUpdates.delete(file.oldUri);
      const processed = this.ctx.store.get(file.oldUri);
      if (processed) {
        this.ctx.documentUpdates.set(file.newUri, Symbol());
        processed.uri = file.newUri;
        relocateSymbols(processed.symbols, file.newUri);
        this.ctx.store.set(file.newUri, processed);
        this.ctx.store.delete(file.oldUri);
        // Replace TextDocument with correct uri
        if (isProcessed(processed)) {
          const { languageId, version } = processed.document;
          processed.document = TextDocument.create(
            file.newUri,
            languageId,
            version,
            processed.document.getText(),
          );
        }
      }

      // Update referenced URIs
      for (const processedDoc of this.ctx.store.values()) {
        const refIndex = processedDoc.referencedUris.indexOf(file.oldUri);
        if (refIndex !== -1) {
          processedDoc.referencedUris[refIndex] = file.newUri;
          // TODO: update include directives in referencing file
        }
      }
    }

    return null;
  }

  /**
   * Adapt folder renames to file renames
   */
  async adaptFolderRenames(files: lsp.FileRename[]): Promise<lsp.FileRename[]> {
    const renames = await Promise.all(
      files.map(async ({ oldUri, newUri }) => {
        if (await isDir(newUri)) {
          const filesInDir = await getAsmFilesInDir(newUri);
          return filesInDir.map((fileUrl) => {
            const oldPrefix = oldUri.replace(/\/$/, "");
            const newPrefix = newUri.replace(/\/$/, "");
            return {
              oldUri: oldPrefix + fileUrl.slice(newPrefix.length),
              newUri: fileUrl.toString(),
            };
          });
        }

        return { oldUri, newUri };
      }),
    );
    return renames.flat().filter(({ newUri }) => isAsmExt(newUri));
  }

  register(connection: lsp.Connection): lsp.ServerCapabilities {
    connection.workspace.onWillDeleteFiles(this.onWillDeleteFiles.bind(this));
    connection.workspace.onDidDeleteFiles(this.onDidDeleteFiles.bind(this));
    connection.workspace.onDidRenameFiles(this.onDidRenameFiles.bind(this));
    connection.workspace.onDidCreateFiles(this.onDidCreateFiles.bind(this));
    connection.onDidChangeWatchedFiles(this.onDidChangeWatchedFiles.bind(this));

    const fileOperationFilter: FileOperationFilter = {
      pattern: {
        glob: "**/*.{s,i,asm}",
        options: { ignoreCase: true },
      },
    };

    const folderOperationFilter: FileOperationFilter = {
      pattern: {
        glob: "**/*",
      },
    };

    return {
      workspace: {
        fileOperations: {
          willDelete: {
            filters: [fileOperationFilter, folderOperationFilter],
          },
          didDelete: {
            filters: [fileOperationFilter, folderOperationFilter],
          },
          didCreate: {
            filters: [fileOperationFilter],
          },
          didRename: {
            filters: [fileOperationFilter, folderOperationFilter],
          },
        },
      },
    };
  }
}

/** Symbol ranges stay valid across a rename, including unsaved editor text. */
function relocateSymbols(symbols: Symbols, uri: string): void {
  const relocateDefinition = (definition: Definition) => {
    definition.location.uri = uri;
    for (const local of definition.locals?.values() ?? []) {
      relocateDefinition(local);
    }
  };
  for (const definition of symbols.definitions.values()) {
    relocateDefinition(definition);
  }
  for (const references of symbols.references.values()) {
    for (const reference of references) {
      reference.location.uri = uri;
    }
  }
  for (const literal of [...symbols.includes, ...symbols.incDirs]) {
    literal.location.uri = uri;
  }
}
